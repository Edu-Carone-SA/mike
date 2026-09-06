import { createServerSupabase } from "./supabase";

/**
 * Sprint 1 — analysis job state machine.
 *
 * Single source of truth for job lifecycle. The terminal state is ALWAYS
 * set through this module, never derived from tool-step wrappers.
 *
 * Active:   queued -> planning -> running <-> waiting_retry
 * Terminal: completed | failed | cancelled
 * Paused:  running -> paused (tool budget exhausted, user can resume,
 *          reduce scope, or ask for a labelled partial). paused -> running
 *          on resume; paused -> completed/failed/cancelled to finalize.
 */

export type JobState =
  | "queued"
  | "planning"
  | "running"
  | "waiting_retry"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export type FinalReason =
  | "tool_budget"
  | "timeout"
  | "upstream_rate_limit"
  | "user_cancelled"
  | "validation_failed";

export type JobProgress = {
  completedSections: number;
  totalSections: number;
  currentLabel: string;
};

export type JobStatusPayload = {
  jobId: string;
  state: JobState;
  progress: JobProgress;
  checkpointId?: string;
  finalReason?: FinalReason | null;
};

const TERMINAL_STATES: ReadonlySet<JobState> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

/** Allowed transitions. Key: from, values: to. */
const TRANSITIONS: Readonly<Record<JobState, ReadonlySet<JobState>>> = {
  queued: new Set(["planning", "running", "failed", "cancelled"]),
  planning: new Set(["running", "failed", "cancelled"]),
  running: new Set([
    "waiting_retry",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ]),
  waiting_retry: new Set(["running", "failed", "cancelled"]),
  paused: new Set(["running", "completed", "failed", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export type AnalysisJobRow = {
  id: string;
  user_id: string;
  chat_id: string | null;
  project_id: string | null;
  kind: "chat_analysis" | "workflow" | "tabular";
  state: JobState;
  final_reason: FinalReason | null;
  progress: JobProgress;
  analysis_plan: unknown;
  checkpoint_id: string | null;
  model: string | null;
  model_effective: string | null;
  build_sha: string | null;
  request_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tool_calls_count: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type Db = ReturnType<typeof createServerSupabase>;

export class InvalidTransitionError extends Error {
  constructor(from: JobState, to: JobState) {
    super(`Invalid analysis job transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].has(to);
}

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.has(state);
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export async function createAnalysisJob(
  db: Db,
  params: {
    userId: string;
    chatId?: string | null;
    projectId?: string | null;
    kind?: "chat_analysis" | "workflow" | "tabular";
    model?: string | null;
    requestId?: string | null;
    buildSha?: string | null;
  },
): Promise<AnalysisJobRow> {
  const { data, error } = await db
    .from("analysis_jobs")
    .insert({
      user_id: params.userId,
      chat_id: params.chatId ?? null,
      project_id: params.projectId ?? null,
      kind: params.kind ?? "chat_analysis",
      model: params.model ?? null,
      request_id: params.requestId ?? null,
      build_sha: params.buildSha ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Failed to create analysis job: ${error?.message}`);
  return data as AnalysisJobRow;
}

export async function getAnalysisJob(
  db: Db,
  jobId: string,
): Promise<AnalysisJobRow | null> {
  const { data, error } = await db
    .from("analysis_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load analysis job: ${error.message}`);
  return (data as AnalysisJobRow) ?? null;
}

/**
 * Transition with optimistic-concurrency guard: the UPDATE only applies
 * when the row is still in `expectFrom`, so a stale worker cannot
 * overwrite a newer state (e.g. a cancelled job).
 */
export async function transitionAnalysisJob(
  db: Db,
  jobId: string,
  to: JobState,
  opts: {
    expectFrom?: JobState;
    finalReason?: FinalReason | null;
    progress?: JobProgress;
    errorMessage?: string | null;
    tokensIn?: number;
    tokensOut?: number;
    toolCallsCount?: number;
    modelEffective?: string | null;
    analysisPlan?: unknown;
    checkpointId?: string | null;
  } = {},
): Promise<AnalysisJobRow> {
  let query = db.from("analysis_jobs").update({
    state: to,
    final_reason: opts.finalReason ?? null,
    ...(opts.progress !== undefined
      ? { progress: opts.progress }
      : {}),
    ...(opts.errorMessage !== undefined
      ? { error_message: opts.errorMessage }
      : {}),
    ...(opts.tokensIn !== undefined ? { tokens_in: opts.tokensIn } : {}),
    ...(opts.tokensOut !== undefined ? { tokens_out: opts.tokensOut } : {}),
    ...(opts.toolCallsCount !== undefined
      ? { tool_calls_count: opts.toolCallsCount }
      : {}),
    ...(opts.modelEffective !== undefined
      ? { model_effective: opts.modelEffective }
      : {}),
    ...(opts.analysisPlan !== undefined
      ? { analysis_plan: opts.analysisPlan }
      : {}),
    ...(opts.checkpointId !== undefined
      ? { checkpoint_id: opts.checkpointId }
      : {}),
    started_at: to === "running" ? new Date().toISOString() : undefined,
    finished_at: isTerminal(to) ? new Date().toISOString() : undefined,
  });

  query = query.eq("id", jobId);
  if (opts.expectFrom) query = query.eq("state", opts.expectFrom);

  const { data, error } = await query.select("*").single();
  if (error || !data) {
    throw new Error(
      `Failed to transition analysis job ${jobId} to ${to}` +
        (opts.expectFrom ? ` (expected state ${opts.expectFrom})` : "") +
        `: ${error?.message ?? "row not found or state changed"}`,
    );
  }
  return data as AnalysisJobRow;
}

export type CheckpointRow = {
  id: string;
  job_id: string;
  section_index: number;
  section_label: string;
  status: "completed" | "failed";
  result: unknown;
  citations: unknown;
  tools_used: unknown;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number | null;
  next_cursor: unknown;
  created_at: string;
};

export async function saveCheckpoint(
  db: Db,
  params: {
    jobId: string;
    sectionIndex: number;
    sectionLabel: string;
    status?: "completed" | "failed";
    result?: unknown;
    citations?: unknown;
    toolsUsed?: unknown;
    tokensIn?: number;
    tokensOut?: number;
    durationMs?: number;
    nextCursor?: unknown;
  },
): Promise<CheckpointRow> {
  const { data, error } = await db
    .from("analysis_job_checkpoints")
    .upsert(
      {
        job_id: params.jobId,
        section_index: params.sectionIndex,
        section_label: params.sectionLabel,
        status: params.status ?? "completed",
        result: params.result ?? null,
        citations: params.citations ?? null,
        tools_used: params.toolsUsed ?? null,
        tokens_in: params.tokensIn ?? null,
        tokens_out: params.tokensOut ?? null,
        duration_ms: params.durationMs ?? null,
        next_cursor: params.nextCursor ?? null,
      },
      { onConflict: "job_id,section_index" },
    )
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`Failed to save checkpoint: ${error?.message}`);
  }
  return data as CheckpointRow;
}

export async function listCheckpoints(
  db: Db,
  jobId: string,
): Promise<CheckpointRow[]> {
  const { data, error } = await db
    .from("analysis_job_checkpoints")
    .select("*")
    .eq("job_id", jobId)
    .order("section_index", { ascending: true });
  if (error) throw new Error(`Failed to list checkpoints: ${error.message}`);
  return (data ?? []) as CheckpointRow[];
}

export function toJobStatusPayload(row: AnalysisJobRow): JobStatusPayload {
  return {
    jobId: row.id,
    state: row.state,
    progress: row.progress,
    checkpointId: row.checkpoint_id ?? undefined,
    finalReason: row.final_reason ?? undefined,
  };
}
