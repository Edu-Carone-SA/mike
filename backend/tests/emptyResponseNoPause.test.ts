/**
 * P0 QA 14/09/2026: trivial one-line prompts paused with
 * final_reason=tool_budget while tool_calls=0 — a thinking-only model
 * response (reasoning_content, no visible content) fell into the
 * streaming gate's secondary safety net (!fullText && no content
 * events) and was mislabeled as a tool-budget pause.
 *
 * These tests drive the REAL runLLMStream gate against adapter results
 * shaped like the four failing QA turns (jobs af3a9a39 / 3d6b71e1 /
 * 803829d4 / cb0ce676: tool_calls=0, final_reason=tool_budget) and the
 * fixed behavior:
 *   - emptyResponse + no content events -> typed error, NEVER paused
 *   - exhaustedToolLoop (real tool work) -> paused, unchanged (JOB-02)
 *   - normal content -> completes, unchanged
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/llm", () => ({
  streamChatWithTools: vi.fn(),
  resolveModel: (m: string) => m ?? "z-ai/glm-5.3-flash",
  DEFAULT_MAIN_MODEL: "z-ai/glm-5.3-flash",
}));

// The tool machinery must not run in these tests (tool_calls=0 paths).
vi.mock("../src/lib/chat/tools/toolSchemas", () => ({
  TOOLS: [],
  WORKFLOW_TOOLS: [],
}));
vi.mock("../src/lib/chat/tools/courtlistenerTools", () => ({
  COURTLISTENER_TOOLS: [],
}));
vi.mock("../src/lib/mcpConnectors", () => ({
  buildUserMcpTools: vi.fn(async () => []),
}));
vi.mock("../src/lib/platformSettings", () => ({
  getPlatformSettings: vi.fn(async () => null),
}));

import { streamChatWithTools } from "../src/lib/llm";
import { runLLMStream } from "../src/lib/chat/streaming";

const writes: string[] = [];
const collect = (chunk: string) => {
  writes.push(chunk);
};

function writtenEvents(): { type: string; reason?: string }[] {
  return writes
    .join("")
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .map((payload) => {
      try {
        return JSON.parse(payload);
      } catch {
        return { type: payload }; // [DONE]
      }
    });
}

const baseParams = () => ({
  apiMessages: [{ role: "user", content: "Responda exatamente: X" }],
  docStore: {} as never,
  docIndex: {} as never,
  userId: "test-user",
  db: {} as never,
  write: collect,
  model: "z-ai/glm-5.3-flash",
  apiKeys: { openrouter: "k" } as never,
});

beforeEach(() => {
  writes.length = 0;
  vi.mocked(streamChatWithTools).mockReset();
});

describe("P0 14/09 — thinking-only empty response must not pause", () => {
  it("emptyResponse with tool_calls=0 surfaces a typed error, never a paused event", async () => {
    vi.mocked(streamChatWithTools).mockResolvedValue({
      fullText: "",
      emptyResponse: true,
      exhaustedToolLoop: false,
    } as never);

    const result = await runLLMStream(baseParams());

    const types = writtenEvents().map((e) => e.type);
    expect(types).not.toContain("paused");
    expect(types).toContain("error");
    expect(types[types.length - 1]).toBe("[DONE]");
    expect(result.fullText).toBe("");
    expect(result.paused ?? false).toBe(false);
    expect(result.events.some((e) => e.type === "error")).toBe(true);
  });

  it("a REAL exhausted tool loop still pauses (unchanged JOB-02 contract)", async () => {
    vi.mocked(streamChatWithTools).mockResolvedValue({
      fullText: "",
      exhaustedToolLoop: true,
    } as never);

    const result = await runLLMStream({
      ...baseParams(),
      job: {
        jobId: "job-1",
        checkpointId: () => "cp-1",
      } as never,
    });

    const paused = writtenEvents().find((e) => e.type === "paused");
    expect(paused).toBeDefined();
    expect(paused?.reason).toBe("tool_budget");
    expect(result.paused).toBe(true);
  });

  it("a normal content-bearing turn completes with [DONE]", async () => {
    vi.mocked(streamChatWithTools).mockImplementation(
      async (params: {
        callbacks?: { onContentDelta?: (t: string) => void };
      }) => {
        params.callbacks?.onContentDelta?.("STATUS=OK; FIM=OK.");
        return { fullText: "STATUS=OK; FIM=OK." } as never;
      },
    );

    const result = await runLLMStream(baseParams());

    // The visible-tail buffer holds back the last few chars until the
    // final flush — assert on the RESULT, and on the stream after it.
    expect(result.fullText).toContain("STATUS=OK; FIM=OK.");
    const types = writtenEvents().map((e) => e.type);
    expect(types[types.length - 1]).toBe("[DONE]");
    expect(result.paused ?? false).toBe(false);
  });
});
