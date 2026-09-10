-- MIKE-07: Platform settings (admin-managed OpenRouter key + available models)
-- Singleton row (id = 1) so the app has one source of truth per deployment.

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Admin-managed OpenRouter API key, encrypted at rest (same scheme as
  -- user_api_keys). NULL = fall back to the env OPENROUTER_API_KEY.
  openrouter_api_key_encrypted text,
  openrouter_api_key_iv text,
  openrouter_api_key_auth_tag text,
  openrouter_api_key_updated_at timestamptz,
  openrouter_api_key_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Up to 5 models made available platform-wide. Shape per entry:
  -- { id, name, context_length, pricing: { prompt, completion } }
  available_models jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(available_models) = 'array'
           AND jsonb_array_length(available_models) <= 5),
  available_models_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Backend (service_role) only — admins manage it through /admin routes.
REVOKE ALL ON public.platform_settings FROM anon, authenticated;
GRANT ALL ON public.platform_settings TO service_role;
