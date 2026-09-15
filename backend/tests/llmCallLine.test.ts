/**
 * P0 QA 15/09/2026 (#96 reaceite): `[llm]` lines did not carry chat_id /
 * job_id / request_id, so QA could not join a sentinel-mismatch turn to
 * the upstream call. formatLlmCallLine is the real formatter.
 */
import { describe, it, expect } from "vitest";
import { formatLlmCallLine } from "../src/lib/llm/openrouter";

describe("formatLlmCallLine — correlatable [llm] telemetry", () => {
    it("appends chat_id, job_id and request_id when present", () => {
        const line = formatLlmCallLine({
            model: "z-ai/glm-5.3-flash",
            status: 200,
            durationMs: 1200,
            attempt: 1,
            fallback: false,
            chatId: "ff71f5d6-7bdf-48c4-91e8-2cda696a2bdd",
            jobId: "98f20230-f64d-44b7-8459-2f8840ea8846",
            requestId: "dde10051-ddb2-44d8-bb6f-1607acec2bd5",
        });
        expect(line).toContain("[llm] model=z-ai/glm-5.3-flash");
        expect(line).toContain("chat_id=ff71f5d6-7bdf-48c4-91e8-2cda696a2bdd");
        expect(line).toContain("job_id=98f20230-f64d-44b7-8459-2f8840ea8846");
        expect(line).toContain("request_id=dde10051-ddb2-44d8-bb6f-1607acec2bd5");
    });

    it("omits empty join keys (no chat_id=undefined)", () => {
        const line = formatLlmCallLine({
            model: "deepseek/deepseek-v4.1-flash",
            status: 200,
            durationMs: 10,
            attempt: 1,
            fallback: false,
        });
        expect(line).not.toContain("chat_id=");
        expect(line).not.toContain("job_id=");
        expect(line).not.toContain("request_id=");
    });
});
