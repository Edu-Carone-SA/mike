/**
 * Sprint 2 — in-process document job worker.
 *
 * A periodic ticker claims queued document_jobs and drives them to a
 * terminal state via documentJobProcessor. One job at a time per
 * process (extraction/OCR are CPU-bound); horizontal scaling is safe
 * because the claim is guarded (state='queued' + locked_by).
 *
 * ENV (all optional):
 *   DOCUMENT_JOB_WORKER=off        → disable the worker (e.g. frontend-only
 *                                    containers or tests)
 *   DOCUMENT_JOB_POLL_MS=2000      → poll interval
 */
import crypto from "node:crypto";

import { createServerSupabase } from "./supabase";
import {
    claimNextDocumentJob,
    isDocumentJobTerminal,
    logDocumentJobEvent,
    transitionDocumentJob,
} from "./documentJobs";
import { processDocumentJob } from "./documentJobProcessor";

const POLL_MS = Number(process.env.DOCUMENT_JOB_POLL_MS ?? 2000);
const WORKER_ENABLED = process.env.DOCUMENT_JOB_WORKER !== "off";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;

export function startDocumentJobWorker(): void {
    if (!WORKER_ENABLED || timer) return;
    logDocumentJobEvent({ event: "worker_started", state: `worker_id=${workerId}` });
    timer = setInterval(tick, POLL_MS);
    // Don't keep the event loop alive just for the ticker.
    timer.unref?.();
}

async function tick(): Promise<void> {
    if (running) return; // previous tick still processing
    running = true;
    try {
        const db = createServerSupabase();
        const job = await claimNextDocumentJob(db, workerId);
        if (!job) return;
        logDocumentJobEvent({
            event: "claimed",
            jobId: job.id,
            documentId: job.document_id,
            projectId: job.project_id,
            requestId: job.request_id,
            buildSha: job.build_sha,
            state: job.state,
            attempt: job.attempt,
        });
        try {
            await processDocumentJob(db, job);
        } catch (err) {
            // processDocumentJob handles its own failures; this catch is
            // for crashes between transitions (e.g. the claim itself).
            const message = err instanceof Error ? err.message : String(err);
            logDocumentJobEvent({
                event: "crashed",
                jobId: job.id,
                documentId: job.document_id,
                failureReason: message.slice(0, 200),
                attempt: job.attempt,
            });
            try {
                // Re-queue if attempts remain, else fail with the reason.
                if (job.attempt < job.max_attempts) {
                    await transitionDocumentJob(db, job.id, "queued", {
                        expectFrom: "uploading",
                    });
                } else {
                    await transitionDocumentJob(db, job.id, "failed", {
                        failureReason: "worker_crash",
                    });
                }
            } catch {
                // already terminal — fine
            }
        }
    } catch (err) {
        // Ticker-level error (e.g. DB unreachable) — log and keep going.
        console.error(
            "[document-job] tick error:",
            err instanceof Error ? err.message : err,
        );
    } finally {
        running = false;
    }
}

/** Test hook: stop the ticker. */
export function stopDocumentJobWorker(): void {
    if (timer) clearInterval(timer);
    timer = null;
}

// Re-export for convenience.
export { isDocumentJobTerminal };
