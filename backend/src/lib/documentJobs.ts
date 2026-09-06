/**
 * Sprint 2 — async document processing pipeline.
 *
 * document_jobs tracks each document through
 * queued → uploading → extracting → (ocr) → indexing → ready
 * with terminal failed/cancelled. Extraction (and OCR for scanned
 * PDFs) is persisted on document_versions.extracted_text so
 * read_document and the readiness contract stop re-running the whole
 * pipeline on every call.
 *
 * The worker runs in-process (same model as analysis jobs): a periodic
 * ticker claims queued jobs with an optimistic lock and drives them to
 * a terminal state. Jobs are idempotent: re-submitting the same
 * idempotency key returns the existing job.
 */
import crypto from "node:crypto";
import { createServerSupabase } from "./supabase";

type Db = ReturnType<typeof createServerSupabase>;

export const DOCUMENT_JOB_ACTIVE_STATES = new Set([
    "queued",
    "uploading",
    "extracting",
    "ocr",
    "indexing",
]);

/** Allowed transitions. Key: from, values: to. */
const TRANSITIONS: Record<string, string[]> = {
    queued: ["uploading", "extracting", "ocr", "indexing", "cancelled", "failed"],
    uploading: ["extracting", "cancelled", "failed"],
    extracting: ["ocr", "indexing", "ready", "cancelled", "failed"],
    ocr: ["indexing", "ready", "cancelled", "failed"],
    indexing: ["ready", "cancelled", "failed"],
    ready: [],
    failed: ["queued"], // retry restarts from the queue
    cancelled: [],
};

export const DOCUMENT_JOB_TERMINAL_STATES = new Set([
    "ready",
    "failed",
    "cancelled",
]);

export class InvalidDocumentJobTransition extends Error {
    constructor(public from: string, public to: string) {
        super(`Invalid document job transition: ${from} → ${to}`);
        this.name = "InvalidDocumentJobTransition";
    }
}

export function canDocumentJobTransition(from: string, to: string): boolean {
    return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertDocumentJobTransition(
    from: string,
    to: string,
): void {
    if (!canDocumentJobTransition(from, to))
        throw new InvalidDocumentJobTransition(from, to);
}

export function isDocumentJobTerminal(state: string): boolean {
    return DOCUMENT_JOB_TERMINAL_STATES.has(state);
}

export interface DocumentJobRow {
    id: string;
    user_id: string;
    document_id: string | null;
    project_id: string | null;
    idempotency_key: string;
    state: string;
    failure_reason: string | null;
    file_name: string | null;
    file_type: string | null;
    size_bytes: number | null;
    pages_total: number | null;
    pages_processed: number;
    locked_by: string | null;
    locked_at: string | null;
    attempt: number;
    max_attempts: number;
    build_sha: string | null;
    request_id: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    updated_at: string;
}

/** Stable log line per job lifecycle event (CloudWatch-friendly). */
export function logDocumentJobEvent(evt: {
    event: string;
    jobId?: string;
    documentId?: string | null;
    projectId?: string | null;
    chatId?: string | null;
    requestId?: string | null;
    buildSha?: string | null;
    state?: string;
    failureReason?: string | null;
    pagesProcessed?: number;
    pagesTotal?: number | null;
    attempt?: number;
    durationMs?: number;
}) {
    const parts: string[] = [`[document-job] event=${evt.event}`];
    if (evt.jobId) parts.push(`job_id=${evt.jobId}`);
    if (evt.documentId) parts.push(`document_id=${evt.documentId}`);
    if (evt.projectId) parts.push(`project_id=${evt.projectId}`);
    if (evt.requestId) parts.push(`request_id=${evt.requestId}`);
    if (evt.buildSha) parts.push(`build_sha=${evt.buildSha}`);
    if (evt.state) parts.push(`state=${evt.state}`);
    if (evt.failureReason)
        parts.push(
            `failure_reason="${evt.failureReason.replace(/"/g, "'")}"`,
        );
    if (evt.pagesProcessed !== undefined)
        parts.push(`pages_processed=${evt.pagesProcessed}`);
    if (evt.pagesTotal !== undefined && evt.pagesTotal !== null)
        parts.push(`pages_total=${evt.pagesTotal}`);
    if (evt.attempt !== undefined) parts.push(`attempt=${evt.attempt}`);
    if (evt.durationMs !== undefined)
        parts.push(`duration_ms=${evt.durationMs}`);
    console.log(parts.join(" "));
}

/**
 * Create (or return the existing) job for this idempotency key.
 * Same-key resubmission — e.g. the UI retrying after a reload —
 * must never produce a duplicate document.
 */
export async function createDocumentJob(
    db: Db,
    params: {
        userId: string;
        idempotencyKey: string;
        projectId?: string | null;
        documentId?: string | null;
        fileName?: string | null;
        fileType?: string | null;
        sizeBytes?: number | null;
        requestId?: string | null;
        buildSha?: string | null;
        maxAttempts?: number;
    },
): Promise<{ job: DocumentJobRow; created: boolean }> {
    const payload = {
        user_id: params.userId,
        idempotency_key: params.idempotencyKey,
        project_id: params.projectId ?? null,
        document_id: params.documentId ?? null,
        file_name: params.fileName ?? null,
        file_type: params.fileType ?? null,
        size_bytes: params.sizeBytes ?? null,
        request_id: params.requestId ?? null,
        build_sha: params.buildSha ?? null,
        max_attempts: params.maxAttempts ?? 3,
    };
    const { data: inserted, error } = await db
        .from("document_jobs")
        .insert(payload)
        .select("*")
        .single();
    if (!error && inserted) {
        return { job: inserted as DocumentJobRow, created: true };
    }
    // Unique violation on (user_id, idempotency_key) → return the existing row.
    const { data: existing } = await db
        .from("document_jobs")
        .select("*")
        .eq("user_id", params.userId)
        .eq("idempotency_key", params.idempotencyKey)
        .maybeSingle();
    if (!existing)
        throw new Error(
            `Failed to create document job: ${error?.message ?? "unknown"}`,
        );
    return { job: existing as DocumentJobRow, created: false };
}

export async function getDocumentJobByIdempotencyKey(
    db: Db,
    userId: string,
    idempotencyKey: string,
): Promise<DocumentJobRow | null> {
    const { data } = await db
        .from("document_jobs")
        .select("*")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
    return (data as DocumentJobRow) ?? null;
}

export async function getDocumentJob(
    db: Db,
    jobId: string,
): Promise<DocumentJobRow | null> {
    const { data, error } = await db
        .from("document_jobs")
        .select("*")
        .eq("id", jobId)
        .maybeSingle();
    if (error) throw new Error(`Failed to load document job: ${error.message}`);
    return (data as DocumentJobRow) ?? null;
}

export async function getDocumentJobByDocument(
    db: Db,
    documentId: string,
): Promise<DocumentJobRow | null> {
    const { data } = await db
        .from("document_jobs")
        .select("*")
        .eq("document_id", documentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    return (data as DocumentJobRow) ?? null;
}

/**
 * Transition with optimistic guard: the UPDATE only applies when the
 * row is still in `expectFrom`, and the claim lock is released on
 * terminal states.
 */
export async function transitionDocumentJob(
    db: Db,
    jobId: string,
    to: string,
    opts: {
        expectFrom?: string;
        failureReason?: string | null;
        pagesProcessed?: number;
        pagesTotal?: number | null;
    } = {},
): Promise<DocumentJobRow> {
    let query = db
        .from("document_jobs")
        .update({
            state: to,
            failure_reason: opts.failureReason ?? null,
            ...(opts.pagesProcessed !== undefined
                ? { pages_processed: opts.pagesProcessed }
                : {}),
            ...(opts.pagesTotal !== undefined
                ? { pages_total: opts.pagesTotal }
                : {}),
            ...(isDocumentJobTerminal(to) || to === "queued"
                ? { locked_by: null, locked_at: null }
                : {}),
            ...(to === "ready" || to === "failed" || to === "cancelled"
                ? { finished_at: new Date().toISOString() }
                : {}),
        })
        .eq("id", jobId);
    if (opts.expectFrom) query = query.eq("state", opts.expectFrom);
    const { data, error } = await query.select("*").single();
    if (error || !data)
        throw new Error(
            `Document job ${jobId} transition to ${to} failed: ` +
                (error?.message ?? "row not in expected state"),
        );
    return data as DocumentJobRow;
}

export interface DocumentJobStatusPayload {
    jobId: string;
    documentId: string | null;
    projectId: string | null;
    state: string;
    processingState: string;
    failureReason: string | null;
    fileName: string | null;
    pagesProcessed: number;
    pagesTotal: number | null;
    attempt: number;
    maxAttempts: number;
    startedAt: string | null;
    finishedAt: string | null;
    updatedAt: string;
}

export function toDocumentJobStatusPayload(
    job: DocumentJobRow,
): DocumentJobStatusPayload {
    return {
        jobId: job.id,
        documentId: job.document_id,
        projectId: job.project_id,
        state: job.state,
        processingState: job.state,
        failureReason: job.failure_reason,
        fileName: job.file_name,
        pagesProcessed: job.pages_processed,
        pagesTotal: job.pages_total,
        attempt: job.attempt,
        maxAttempts: job.max_attempts,
        startedAt: job.started_at,
        finishedAt: job.finished_at,
        updatedAt: job.updated_at,
    };
}

/**
 * Worker claim: atomically take one queued (or stale-locked) job.
 * Uses UPDATE ... WHERE state='queued' semantics via the optimistic
 * guard; a race between two workers resolves to exactly one winner.
 */
export async function claimNextDocumentJob(
    db: Db,
    workerId: string,
): Promise<DocumentJobRow | null> {
    const { data: candidates } = await db
        .from("document_jobs")
        .select("id")
        .eq("state", "queued")
        .order("created_at", { ascending: true })
        .limit(1);
    const candidate = (candidates ?? [])[0];
    if (!candidate) return null;

    const { data: claimed, error } = await db
        .from("document_jobs")
        .update({
            state: "uploading",
            locked_by: workerId,
            locked_at: new Date().toISOString(),
            started_at: new Date().toISOString(),
        })
        .eq("id", candidate.id)
        .eq("state", "queued")
        .select("*")
        .single();
    if (error || !claimed) return null; // lost the race — try again next tick
    // Bump attempt separately (typed client can't express attempt+1 in one
    // update with the same select).
    const { data: bumped } = await db
        .from("document_jobs")
        .update({ attempt: (claimed as DocumentJobRow).attempt + 1 })
        .eq("id", candidate.id)
        .select("*")
        .single();
    return (bumped ?? claimed) as DocumentJobRow;
}
