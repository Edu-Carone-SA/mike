/**
 * P0 QA 15/09/2026 — bateria ampla, F02 (chat dd1af15e / job 080cc519):
 * a tool-less O1 turn on the PROJECT chat route delivered the full answer,
 * then failed the terminal transition because the job never left `planning`
 * (only onToolBatchEnd moved it to `running`). startOrResumeJob must move
 * planning -> running like the standalone route always did, and
 * finalizeJobAfterStream must finalize from the job's actual state.
 *
 * The fake db implements the real supabase postgrest chain used by
 * transitionAnalysisJob/createAnalysisJob: update().eq().eq().select().single()
 * and insert().select().single().
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/lib/supabase", () => ({
    createServerSupabase: () => ({ from: () => { throw new Error("not used"); } }),
}));

import {
    buildTurnPlan,
    startOrResumeJob,
    finalizeJobAfterStream,
} from "../src/lib/chat/chatJobRunner";

type Row = Record<string, unknown>;

function makeDb(initial: Row) {
    const rows = new Map<string, Row>([[initial.id as string, { ...initial }]]);
    let seq = 0;

    const updateChain = (patch: Row) => {
        const state = { jobId: null as string | null, expectFrom: null as string | null };
        const step = {
            eq: (col: string, val: unknown) => {
                if (col === "id") state.jobId = val as string;
                if (col === "state") state.expectFrom = val as string;
                return step;
            },
            select: () => ({
                single: async () => {
                    const row = state.jobId ? rows.get(state.jobId) : null;
                    if (
                        !row ||
                        (state.expectFrom && row.state !== state.expectFrom)
                    ) {
                        return {
                            data: null,
                            error: {
                                message:
                                    "JSON object requested, multiple (or no) rows returned",
                            },
                        };
                    }
                    const next = { ...row, ...patch, state: patch.state };
                    rows.set(state.jobId as string, next);
                    return { data: next, error: null };
                },
            }),
        };
        return step;
    };

    const insertChain = (payload: Row) => ({
        select: () => ({
            single: async () => {
                const row: Row = {
                    id: `job-${++seq}`,
                    request_id: "req-test",
                    build_sha: "sha-test",
                    tool_calls_count: 0,
                    ...payload,
                    state: "queued",
                };
                rows.set(row.id as string, row);
                return { data: row, error: null };
            },
        }),
    });

    const selectChain = (target: { id: string | null }) => ({
        eq: (col: string, val: unknown) => {
            if (col === "id") target.id = val as string;
            return selectChain(target);
        },
        maybeSingle: async () => ({
            data: target.id ? (rows.get(target.id) ?? null) : null,
            error: null,
        }),
        single: async () => ({
            data: target.id ? (rows.get(target.id) ?? null) : null,
            error: null,
        }),
    });

    return {
        db: {
            from: (table: string) => {
                if (table !== "analysis_jobs")
                    throw new Error(`unexpected table ${table}`);
                return {
                    insert: (payload: Row) => insertChain(payload),
                    update: (patch: Row) => updateChain(patch),
                    select: () => selectChain({ id: null }),
                };
            },
        } as never,
        rows,
    };
}

const PLAN = buildTurnPlan(undefined);

describe("F02 — tool-less project-chat turn must finalize as completed", () => {
    it("startOrResumeJob leaves the job in running (not planning)", async () => {
        const { db, rows } = makeDb({
            id: "job-1",
            state: "queued",
            chat_id: "chat-1",
            project_id: "proj-1",
            model: "z-ai/glm-5.3-flash",
            kind: "chat_analysis",
            user_id: "u1",
        });
        const { job } = await startOrResumeJob({
            db,
            userId: "u1",
            chatId: "chat-1",
            projectId: "proj-1",
            model: "z-ai/glm-5.3-flash",
            kind: "chat_analysis",
            resumeJobId: null,
            analysisPlan: PLAN,
            write: () => {},
        });
        expect(rows.get("job-1")?.state).toBe("running");
        expect(job.state).toBe("running");
    });

    it("finalizeJobAfterStream completes a job that never ran tools (planning)", async () => {
        const { db } = makeDb({
            id: "job-2",
            state: "planning",
            chat_id: "chat-2",
            request_id: "r2",
            build_sha: "sha",
            model: "z-ai/glm-5.3-flash",
            tool_calls_count: 0,
        });
        const result = await finalizeJobAfterStream({
            db,
            job: {
                id: "job-2",
                state: "planning",
                request_id: "r2",
                build_sha: "sha",
                model: "z-ai/glm-5.3-flash",
                model_effective: null,
                tool_calls_count: 0,
                started_at: null,
            } as never,
            chatId: "chat-2",
            paused: false,
            write: () => {},
        });
        expect(result).toBe("completed");
    });

    it("finalizeJobAfterStream still completes from running", async () => {
        const { db } = makeDb({
            id: "job-3",
            state: "running",
            chat_id: "chat-3",
            request_id: "r3",
            build_sha: "sha",
            tool_calls_count: 2,
        });
        const result = await finalizeJobAfterStream({
            db,
            job: {
                id: "job-3",
                state: "running",
                request_id: "r3",
                build_sha: "sha",
                model: "z-ai/glm-5.3-flash",
                model_effective: null,
                tool_calls_count: 2,
                started_at: new Date().toISOString(),
            } as never,
            chatId: "chat-3",
            paused: false,
            write: () => {},
        });
        expect(result).toBe("completed");
    });
});
