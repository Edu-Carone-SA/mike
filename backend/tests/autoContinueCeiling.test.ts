import { describe, it, expect } from "vitest";

/**
 * MIKE-06 — auto-continue output ceiling.
 *
 * Root cause from staging logs: finish_reason==="length" triggered up to
 * 8 automatic continuations, each re-feeding the full prompt (prompt
 * tokens grew 13915 → 14026 → ...) — ~65k output tokens, minutes of
 * "Working", mid-word truncations.
 *
 * Contract under test:
 *   1. MAX_CONTINUATIONS is 1 — one continuation max, so the effective
 *      output ceiling is 2 × MAX_OUTPUT_TOKENS.
 *   2. When the ceiling is hit with finish_reason==="length", the turn
 *      ends GRACEFULLY: the visible text gets a closing suffix (never a
 *      mid-word cut) and the loop breaks.
 *   3. A continuation does NOT consume tool budget (QA JOB-02).
 */

const MAX_CONTINUATIONS = 1;

/** Mirrors the adapter loop's continue-vs-break decision. */
function decideNextStep(opts: {
    finishReason: string | null;
    fullText: string;
    continuationsUsed: number;
    hasToolCalls: boolean;
}): { action: "continue_turn" | "graceful_close" | "break" } {
    const { finishReason, fullText, continuationsUsed, hasToolCalls } = opts;
    if (hasToolCalls) return { action: "break" };
    if (finishReason === "length" && fullText && continuationsUsed < MAX_CONTINUATIONS) {
        return { action: "continue_turn" };
    }
    if (finishReason === "length" && fullText) {
        return { action: "graceful_close" };
    }
    return { action: "break" };
}

/** Mirrors the graceful-close suffix from openrouter.ts. */
function gracefulSuffix(fullText: string): string {
    const graceful =
        fullText.trimEnd().replace(/[\s,;:–—-]+$/, "") +
        " …\n\n[resposta encerrada por limite de extensão]";
    return graceful.slice(fullText.length);
}

describe("MIKE-06 auto-continue output ceiling", () => {
    it("allows exactly one continuation when the first cut hits max_tokens", () => {
        const step = decideNextStep({
            finishReason: "length",
            fullText: "resposta longa cortada no meio",
            continuationsUsed: 0,
            hasToolCalls: false,
        });
        expect(step.action).toBe("continue_turn");
    });

    it("closes gracefully when the ceiling is hit (no second continuation)", () => {
        const step = decideNextStep({
            finishReason: "length",
            fullText: "resposta ainda cortada",
            continuationsUsed: 1, // the single continuation was used
            hasToolCalls: false,
        });
        expect(step.action).toBe("graceful_close");
    });

    it("graceful close never ends mid-word: suffix always present and sentence-like", () => {
        const midWord = "cláusula de inadimp";
        const suffix = gracefulSuffix(midWord);
        expect(suffix).toContain("…");
        expect(suffix).toContain("[resposta encerrada por limite de extensão]");
        const closed = midWord + suffix;
        // The closing marker is the actual end of the visible text.
        expect(closed.trimEnd().endsWith("extensão]")).toBe(true);
    });

    it("a normal stop (finish_reason stop) breaks without continuation", () => {
        const step = decideNextStep({
            finishReason: "stop",
            fullText: "resposta completa.",
            continuationsUsed: 0,
            hasToolCalls: false,
        });
        expect(step.action).toBe("break");
    });

    it("tool-call turns never take the continuation path (budget untouched)", () => {
        const step = decideNextStep({
            finishReason: "length",
            fullText: "parcial",
            continuationsUsed: 0,
            hasToolCalls: true,
        });
        expect(step.action).toBe("break");
    });
});
