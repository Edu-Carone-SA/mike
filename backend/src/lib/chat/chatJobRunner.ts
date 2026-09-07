import crypto from "crypto";
import { createServerSupabase } from "../supabase";
import {
    createAnalysisJob,
    getAnalysisJob,
    listCheckpoints,
    logJobEvent,
    toJobStatusPayload,
    transitionAnalysisJob,
    type AnalysisJobRow,
} from "../analysisJobs";

type Db = ReturnType<typeof createServerSupabase>;
type JobPlanSection = {
    index: number;
    label: string;
    document_id: string | null;
    description: string;
};

/**
 * Sprint 1 job orchestration, extracted so BOTH chat routes run it.
 *
 * QA JOB-02 (NO-GO report, build e7d15fb): the project chat route
 * (`POST /projects/:projectId/chat`) had none of the Sprint 1
 * orchestration — no analysis job, no plan, no checkpoints, no typed
 * pause and no resume. A 13-document analysis ran for 11m55s, ended with
 * bare "Completed" wrappers, duplicated the generated XLSX five times
 * and offered the user no resume, because the tool loop exhausted with
 * no job to pause and no synthesis reserve to spend. This module is the
 * single implementation both routes now share.
 */

export interface TurnPlan {
    sections: JobPlanSection[];
    totalSections: number;
    synthesisReserve: boolean;
}

/**
 * Deterministic analysis plan: one section per attached document plus a
 * mandatory final synthesis section. Built BEFORE any tool fires and
 * enforced in the prompt.
 */
export function buildTurnPlan(
    attachedDocuments: { filename: string; document_id: string }[] | undefined,
): TurnPlan {
    const planSections: JobPlanSection[] = [
        ...(attachedDocuments ?? []).map((d, idx) => ({
            index: idx + 1,
            label: d.filename || `document-${idx + 1}`,
            document_id: d.document_id,
            description:
                "Analisar integralmente este documento (cláusulas, anexos e obrigações).",
        })),
        {
            index: (attachedDocuments?.length ?? 0) + 1,
            label: "Síntese final",
            document_id: null,
            description:
                "Consolidar os achados de todas as seções em um parecer final completo, com citações.",
        },
    ];
    return {
        sections: planSections,
        totalSections: planSections.length,
        synthesisReserve: true,
    };
}

/**
 * Create a fresh job for this turn (or resume a paused one) and emit the
 * initial SSE job_status event. Returns the active job row and the
 * number of checkpoint batches already completed by a resumed job.
 */
export async function startOrResumeJob(params: {
    db: Db;
    userId: string;
    chatId: string;
    projectId: string | null;
    model: string | null;
    kind: "chat_analysis";
    resumeJobId: string | null;
    analysisPlan: TurnPlan;
    write: (line: string) => void;
}): Promise<{
    job: AnalysisJobRow;
    resumed: boolean;
    priorBatches: number;
}> {
    const {
        db,
        userId,
        chatId,
        projectId,
        model,
        resumeJobId,
        analysisPlan,
        write,
    } = params;

    if (resumeJobId) {
        const pausedJob = await getAnalysisJob(db, resumeJobId);
        if (!pausedJob || pausedJob.chat_id !== chatId) {
            write(
                `data: ${JSON.stringify({
                    type: "error",
                    message: "Job de análise não encontrado neste chat.",
                })}\n\n`,
            );
            write("data: [DONE]\n\n");
            throw new JobAbortSignal("job_not_found");
        }
        if (pausedJob.state !== "paused") {
            write(
                `data: ${JSON.stringify({
                    type: "error",
                    message:
                        "Este job não está pausado e não pode ser retomado.",
                })}\n\n`,
            );
            write("data: [DONE]\n\n");
            throw new JobAbortSignal("job_not_paused");
        }
        const checkpoints = await listCheckpoints(db, resumeJobId);
        const job = await transitionAnalysisJob(db, resumeJobId, "running", {
            expectFrom: "paused",
            finalReason: null,
        });
        logJobEvent({
            event: "resumed",
            jobId: job.id,
            chatId,
            requestId: job.request_id,
            buildSha: job.build_sha,
            state: "running",
            toolCallsCount: job.tool_calls_count,
        });
        write(
            `data: ${JSON.stringify({
                type: "job_status",
                ...toJobStatusPayload(job),
            })}\n\n`,
        );
        return { job, resumed: true, priorBatches: checkpoints.length };
    }

    const job = await createAnalysisJob(db, {
        userId,
        chatId,
        projectId,
        kind: "chat_analysis",
        model,
        requestId: crypto.randomUUID(),
        buildSha: process.env.COMMIT_SHA ?? null,
    });
    write(
        `data: ${JSON.stringify({
            type: "job_status",
            ...toJobStatusPayload(job),
        })}\n\n`,
    );
    // PLAN BEFORE TOOLS: persist the deterministic plan via the planning
    // state before any tool fires.
    const plannedJob = await transitionAnalysisJob(db, job.id, "planning", {
        analysisPlan,
        expectFrom: "queued",
    });
    write(
        `data: ${JSON.stringify({
            type: "job_status",
            ...toJobStatusPayload(plannedJob),
            progress: {
                completedSections: 0,
                totalSections: analysisPlan.totalSections,
                currentLabel: analysisPlan.sections[0]?.label ?? "",
            },
        })}\n\n`,
    );
    return { job: plannedJob, resumed: false, priorBatches: 0 };
}

/**
 * Persist the terminal state after the stream: `paused` is resumable
 * (never a failure), `completed` requires a delivered synthesis. Emits
 * the terminal SSE events exactly once.
 */
export async function finalizeJobAfterStream(params: {
    db: Db;
    job: AnalysisJobRow;
    chatId: string;
    paused: boolean;
    write: (line: string) => void;
}): Promise<"paused" | "completed"> {
    const { db, job, chatId, paused, write } = params;
    if (paused) {
        const pausedRow = await transitionAnalysisJob(
            db,
            job.id,
            "paused",
            {
                expectFrom: "running",
                finalReason: "tool_budget",
                errorMessage: "Tool budget exhausted; awaiting user action.",
            },
        );
        logJobEvent({
            event: "paused",
            jobId: job.id,
            chatId,
            requestId: pausedRow.request_id,
            buildSha: pausedRow.build_sha,
            state: "paused",
            finalReason: "tool_budget",
            model: pausedRow.model,
            modelEffective: pausedRow.model_effective,
            toolCallsCount: pausedRow.tool_calls_count,
        });
        return "paused";
    }
    const doneRow = await transitionAnalysisJob(db, job.id, "completed", {
        expectFrom: "running",
    });
    logJobEvent({
        event: "completed",
        jobId: job.id,
        chatId,
        requestId: doneRow.request_id,
        buildSha: doneRow.build_sha,
        state: "completed",
        model: doneRow.model,
        modelEffective: doneRow.model_effective,
        toolCallsCount: doneRow.tool_calls_count,
        durationMs: doneRow.started_at
            ? Date.now() - new Date(doneRow.started_at).getTime()
            : null,
    });
    return "completed";
}

/**
 * Safe transition for the catch path: never overwrite a state that
 * already moved on. `paused` here means "client disconnected mid-run"
 * (JOB-02) — resumable on the same job_id, unlike terminal states.
 */
export async function safeFailJob(
    db: Db,
    jobId: string,
    state: "failed" | "cancelled" | "paused",
    reason: "user_cancelled" | "client_disconnected" | null,
    message?: string,
): Promise<void> {
    try {
        const current = await getAnalysisJob(db, jobId);
        if (
            !current ||
            ["completed", "failed", "cancelled", "paused"].includes(
                current.state,
            )
        )
            return;
        await transitionAnalysisJob(db, jobId, state, {
            expectFrom: current.state as never,
            finalReason: reason,
            errorMessage: message?.slice(0, 500),
        });
        logJobEvent({
            event: state,
            jobId,
            state,
            finalReason: reason,
            errorMessage: message?.slice(0, 500),
        });
    } catch (err) {
        console.error(
            "[chatJobRunner] safeFailJob failed",
            safeErrorLogLite(err),
        );
    }
}

function safeErrorLogLite(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Thrown by startOrResumeJob when resume preconditions fail (SSE already written). */
export class JobAbortSignal extends Error {
    constructor(public readonly reason: "job_not_found" | "job_not_paused") {
        super(reason);
    }
}
