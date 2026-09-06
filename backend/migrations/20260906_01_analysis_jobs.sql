-- Sprint 1: Orquestração confiável de análises longas
-- Job entity with an explicit state machine. State is never derived from
-- tool-step wrappers: queued|planning|running|waiting_retry are active
-- states; completed|failed|cancelled|paused are terminal, except paused
-- which can be resumed (running again) or finalized.
CREATE TABLE IF NOT EXISTS public.analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id uuid REFERENCES public.chats(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'chat_analysis'
    CHECK (kind IN ('chat_analysis', 'workflow', 'tabular')),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'planning', 'running', 'waiting_retry',
                     'completed', 'failed', 'cancelled', 'paused')),
  -- Why the job reached its current state:
  -- tool_budget | timeout | upstream_rate_limit | user_cancelled |
  -- validation_failed | resumed | null (normal completion)
  final_reason text
    CHECK (final_reason IN ('tool_budget', 'timeout', 'upstream_rate_limit',
                           'user_cancelled', 'validation_failed')),
  progress jsonb NOT NULL DEFAULT '{"completedSections":0,"totalSections":0,"currentLabel":""}'::jsonb,
  -- Deterministic processing plan built before tools fire:
  -- document ids, sections, attachments, questions, per-step budget.
  analysis_plan jsonb,
  -- Latest checkpoint id (row in analysis_job_checkpoints).
  checkpoint_id uuid,
  model text,
  model_effective text,
  build_sha text,
  request_id text,
  tokens_in integer,
  tokens_out integer,
  tool_calls_count integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_user
  ON public.analysis_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_chat
  ON public.analysis_jobs(chat_id);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_state
  ON public.analysis_jobs(state);

-- Per-section checkpoint: result, citations, tools used, tokens, duration
-- and the next cursor. A resumed job skips completed sections.
CREATE TABLE IF NOT EXISTS public.analysis_job_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.analysis_jobs(id) ON DELETE CASCADE,
  section_index integer NOT NULL,
  section_label text NOT NULL,
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'failed')),
  result jsonb,
  citations jsonb,
  tools_used jsonb,
  tokens_in integer,
  tokens_out integer,
  duration_ms integer,
  next_cursor jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, section_index)
);

CREATE INDEX IF NOT EXISTS idx_analysis_job_checkpoints_job
  ON public.analysis_job_checkpoints(job_id, section_index);

-- RLS: backend (service_role) only — jobs are server-orchestrated state.
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_job_checkpoints ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.analysis_jobs FROM anon, authenticated;
REVOKE ALL ON public.analysis_job_checkpoints FROM anon, authenticated;

GRANT ALL ON public.analysis_jobs TO service_role;
GRANT ALL ON public.analysis_job_checkpoints TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

CREATE OR REPLACE FUNCTION public.touch_analysis_jobs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

CREATE TRIGGER trg_analysis_jobs_touch_updated_at
  BEFORE UPDATE ON public.analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_analysis_jobs_updated_at();
