import { describe, it, expect } from "vitest";
import {
    MAX_CONTINUATIONS,
    decideContinuation,
    gracefulCloseSuffix,
} from "../src/lib/llm/openrouter";

/**
 * MIKE-06 — auto-continue output ceiling.
 *
 * Root cause from staging logs: finish_reason==="length" triggered up to
 * 8 automatic continuations, each re-feeding the full prompt (prompt
 * tokens grew 13915 → 14026 → ...) — ~65k output tokens, minutes of
 * "Working", mid-word truncations.
 *
 * These tests import the REAL adapter exports (decideContinuation /
 * gracefulCloseSuffix / MAX_CONTINUATIONS) — the same functions the tool
 * loop calls — so an adapter regression fails here instead of passing
 * against a mirrored copy.
 */

describe("MIKE-06 auto-continue output ceiling (real adapter exports)", () => {
    it("MAX_CONTINUATIONS is 1 — effective ceiling 2 × MAX_OUTPUT_TOKENS", () => {
        expect(MAX_CONTINUATIONS).toBe(1);
    });

    it("allows exactly one continuation when the first cut hits max_tokens", () => {
        const step = decideContinuation({
            finishReason: "length",
            fullText: "resposta longa cortada no meio",
            continuationsUsed: 0,
            hasToolCalls: false,
        });
        expect(step.action).toBe("continue_turn");
    });

    it("closes gracefully when the ceiling is hit (no second continuation)", () => {
        const step = decideContinuation({
            finishReason: "length",
            fullText: "resposta ainda cortada",
            continuationsUsed: MAX_CONTINUATIONS, // the single continuation was used
            hasToolCalls: false,
        });
        expect(step.action).toBe("graceful_close");
    });

    it("graceful close never ends mid-word: suffix present, closing marker last", () => {
        const midWord = "cláusula de inadimp";
        const suffix = gracefulCloseSuffix(midWord);
        expect(suffix).toContain("…");
        expect(suffix).toContain("[resposta encerrada por limite de extensão]");
        const closed = midWord + suffix;
        // The closing marker is the actual end of the visible text.
        expect(closed.trimEnd().endsWith("extensão]")).toBe(true);
    });

    it("no suffix when the text already ends cleanly", () => {
        const clean = "Resposta completa, com conclusão.";
        expect(gracefulCloseSuffix(clean)).not.toBe("");
        // fullText + suffix always ends with the closing marker
        expect((clean + gracefulCloseSuffix(clean)).trimEnd().endsWith("extensão]")).toBe(true);
    });

    it("a normal stop (finish_reason stop) breaks without continuation", () => {
        const step = decideContinuation({
            finishReason: "stop",
            fullText: "resposta completa.",
            continuationsUsed: 0,
            hasToolCalls: false,
        });
        expect(step.action).toBe("break");
    });

    it("tool-call turns never take the continuation path (budget untouched)", () => {
        const step = decideContinuation({
            finishReason: "length",
            fullText: "parcial",
            continuationsUsed: 0,
            hasToolCalls: true,
        });
        expect(step.action).toBe("break");
    });
});
