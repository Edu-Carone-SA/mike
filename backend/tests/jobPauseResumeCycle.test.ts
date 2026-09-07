/**
 * JOB-02 re-acceptance: the pause/resume cycle must be fully observable and
 * resumable on the same job_id:
 *  - a tool-budget pause persists a typed `job_paused` assistant message
 *    (with jobId) instead of evaporating with the SSE stream;
 *  - a client disconnect (reload) persists `job_paused/client_disconnected`
 *    (not `cancelled/user_cancelled`) so the reloaded page renders the
 *    Retomar análise button.
 */
import { describe, expect, it } from "vitest";

import {
  buildCancelledAssistantMessage,
} from "../src/lib/chat/contextBuilders";

describe("buildCancelledAssistantMessage: pauseOverride (JOB-02)", () => {
  const baseArgs = {
    fullText: "partial analysis text",
    events: [{ type: "reasoning", text: "thinking" }] as never[],
    buildCitations: () => [],
  };

  it("default terminal event remains cancelled/user_cancelled", () => {
    const out = buildCancelledAssistantMessage(baseArgs);
    const last = out.events[out.events.length - 1];
    expect(last).toEqual({
      type: "cancelled",
      reason: "user_cancelled",
      at: expect.any(String),
    });
  });

  it("pauseOverride replaces the terminal event with a resumable pause", () => {
    const out = buildCancelledAssistantMessage({
      ...baseArgs,
      pauseOverride: {
        type: "job_paused",
        reason: "client_disconnected",
        jobId: "job-123",
        message: "Análise pausada: a conexão foi interrompida.",
      },
    });
    const last = out.events[out.events.length - 1];
    expect(last).toEqual({
      type: "job_paused",
      reason: "client_disconnected",
      jobId: "job-123",
      message: "Análise pausada: a conexão foi interrompida.",
    });
    // exactly one terminal event, no cancelled mixed in
    expect(out.events.filter((e) => e.type === "cancelled")).toHaveLength(0);
    expect(out.events.filter((e) => e.type === "job_paused")).toHaveLength(1);
  });
});
