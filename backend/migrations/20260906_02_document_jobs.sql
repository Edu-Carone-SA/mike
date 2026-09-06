-- Sprint 2: async document processing pipeline.
-- document_jobs tracks upload → extract → (ocr) → index → ready with
-- idempotency, per-page progress and terminal failure reasons. The
-- worker runs in-process on the backend (same model as analysis jobs).
CREATE TABLE IF NOT EXISTS public.document_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  -- Client-generated idempotency key: re-submitting the same upload
  -- (e.g. UI retry after reload) returns the existing job instead of
  -- creating a duplicate document.
  idempotency_key text NOT NULL,
  kind text NOT NULL DEFAULT 'document_processing'
    CHECK (kind IN ('document_processing')),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'uploading', 'extracting', 'ocr',
                     'indexing', 'ready', 'failed', 'cancelled')),
  failure_reason text,
  file_name text,
  file_type text,
  size_bytes bigint,
  pages_total integer,
  pages_processed integer NOT NULL DEFAULT 0,
  -- Optimistic claim lock: worker id + timestamp; stale locks (>10 min)
  -- can be re-claimed by another worker.
  locked_by text,
  locked_at timestamptz,
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  build_sha text,
  request_id text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_document_jobs_state
  ON public.document_jobs(state, created_at);
CREATE INDEX IF NOT EXISTS idx_document_jobs_document
  ON public.document_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_document_jobs_project
  ON public.document_jobs(project_id);

-- Cache extracted text on the version row: read_document and
-- analysis_ready stop re-running extraction/OCR on every call.
ALTER TABLE public.document_versions
  ADD COLUMN IF NOT EXISTS extracted_text text;
ALTER TABLE public.document_versions
  ADD COLUMN IF NOT EXISTS extracted_at timestamptz;
ALTER TABLE public.document_versions
  ADD COLUMN IF NOT EXISTS extraction_source text
    CHECK (extraction_source IS NULL OR extraction_source IN ('text_layer', 'ocr'));

-- RLS: backend (service_role) only — jobs are server-orchestrated state.
ALTER TABLE public.document_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_jobs FROM anon, authenticated;
GRANT ALL ON public.document_jobs TO service_role;

-- Housekeeping trigger on updated_at.
CREATE OR REPLACE FUNCTION public.touch_document_jobs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

CREATE TRIGGER trg_document_jobs_touch_updated_at
  BEFORE UPDATE ON public.document_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_document_jobs_updated_at();
