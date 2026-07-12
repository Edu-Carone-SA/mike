-- MIKE-05: User Administration
-- Add role, status, and audit fields to user_profiles
-- Add admin_audit_log table

-- Add columns to user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin', 'member')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create index on role for admin queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_role
  ON public.user_profiles(role);

-- Create index on status for admin queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_status
  ON public.user_profiles(status);

-- Admin audit log table
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_email text,
  action text NOT NULL,
  target_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_email text,
  previous_value text,
  new_value text,
  details jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor
  ON public.admin_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target
  ON public.admin_audit_log(target_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
  ON public.admin_audit_log(created_at DESC);

-- RLS on admin_audit_log
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Only service_role can access audit log (backend uses service_role)
-- No direct browser access
REVOKE ALL ON public.admin_audit_log FROM anon, authenticated;

-- Grant to service_role (backend)
GRANT ALL ON public.admin_audit_log TO service_role;

-- Sequence for audit log
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Update handle_new_user trigger to set default role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  insert into public.user_profiles (user_id, email)
  values (new.id, lower(new.email))
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;
