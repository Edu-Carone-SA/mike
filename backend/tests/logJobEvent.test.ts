import { describe, expect, it, vi } from "vitest";
import { logJobEvent } from "../src/lib/analysisJobs";

describe("logJobEvent", () => {
  it("emits a stable key=value line with correlation ids", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logJobEvent({
        event: "completed",
        jobId: "job-123",
        chatId: "chat-9",
        requestId: "req-1",
        buildSha: "abc123",
        state: "completed",
        model: "deepseek/deepseek-chat",
        toolCallsCount: 7,
        durationMs: 42000,
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const line = spy.mock.calls[0][0] as string;
      expect(line).toContain("[job] event=completed");
      expect(line).toContain("job_id=job-123");
      expect(line).toContain("chat_id=chat-9");
      expect(line).toContain("request_id=req-1");
      expect(line).toContain("build_sha=abc123");
      expect(line).toContain("state=completed");
      expect(line).toContain("tool_calls=7");
      expect(line).toContain("duration_ms=42000");
    } finally {
      spy.mockRestore();
    }
  });

  it("escapes quotes in error messages and quotes the value", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logJobEvent({
        event: "failed",
        jobId: "job-1",
        state: "failed",
        errorMessage: 'boom "now"',
      });
      const line = spy.mock.calls[0][0] as string;
      expect(line).toContain(`error="boom 'now'"`);
    } finally {
      spy.mockRestore();
    }
  });

  it("omits absent optional fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logJobEvent({ event: "paused", jobId: "job-1", state: "paused" });
      const line = spy.mock.calls[0][0] as string;
      expect(line).not.toContain("chat_id=");
      expect(line).not.toContain("final_reason=");
      expect(line).not.toContain("error=");
    } finally {
      spy.mockRestore();
    }
  });
});
