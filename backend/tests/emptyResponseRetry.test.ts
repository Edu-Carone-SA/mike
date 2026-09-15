/**
 * P0 QA 14/09/2026: a thinking-only first iteration (no visible content,
 * no tool calls) used to fall through with fullText="" and get
 * mislabeled as a tool-budget pause. shouldRetryEmptyVisible is the
 * gate for the one no-tools synthesis retry — imported from the real
 * adapter, never a local copy.
 */
import { describe, it, expect } from "vitest";
import { shouldRetryEmptyVisible } from "../src/lib/llm/openrouter";

describe("shouldRetryEmptyVisible — P0 14/09 thinking-only retry gate", () => {
    it("retries on the first iteration with empty visible text and no tools", () => {
        expect(
            shouldRetryEmptyVisible({
                fullText: "",
                iter: 0,
                toolCallCount: 0,
            }),
        ).toBe(true);
    });

    it("does not retry when visible content was produced", () => {
        expect(
            shouldRetryEmptyVisible({
                fullText: "STATUS=OK; FIM=OK.",
                iter: 0,
                toolCallCount: 0,
            }),
        ).toBe(false);
    });

    it("does not retry when tools ran (that path is the synthesis reserve)", () => {
        expect(
            shouldRetryEmptyVisible({
                fullText: "",
                iter: 0,
                toolCallCount: 2,
            }),
        ).toBe(false);
    });

    it("does not retry on later iterations (budget already spent)", () => {
        expect(
            shouldRetryEmptyVisible({
                fullText: "",
                iter: 1,
                toolCallCount: 0,
            }),
        ).toBe(false);
    });
});
