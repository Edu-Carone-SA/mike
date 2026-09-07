-- JOB-02 follow-up: allow final_reason = 'client_disconnected' on
-- analysis_jobs. PR #70 made a client abort (page reload) transition the
-- job to the resumable `paused` state with final_reason
-- 'client_disconnected', but the table-level CHECK constraint predates
-- that value, so the transition failed at the DB level and jobs stayed
-- stuck in `running` (staging evidence 2026-09-07: jobs 083d161d,
-- bc2bd482, 3f2fe3de stuck running after client aborts).
--
-- Reversible: drop and recreate the constraint without the new value.

ALTER TABLE public.analysis_jobs
  DROP CONSTRAINT analysis_jobs_final_reason_check;

ALTER TABLE public.analysis_jobs
  ADD CONSTRAINT analysis_jobs_final_reason_check
  CHECK (final_reason IN ('tool_budget', 'timeout', 'upstream_rate_limit',
                          'user_cancelled', 'client_disconnected',
                          'validation_failed'));
