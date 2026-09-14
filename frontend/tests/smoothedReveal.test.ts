/**
 * P0 QA 14/09/2026 (re-acceptance of #94): short deterministic answers
 * froze at a mid-word prefix ("STA"/"STAT") under a "Completed in 1 step"
 * label. Root cause: useSmoothedReveal synced its ref but not its state
 * when `active` flipped false before the reveal animation caught up —
 * which is the norm when the final delta, citations and [DONE] arrive in
 * one TCP batch (see NET_LOG evidence in the QA report).
 *
 * These tests drive the real hook through the exact failing sequence.
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSmoothedReveal } from "../src/app/components/assistant/message/useSmoothedReveal";

describe("useSmoothedReveal — P0 freeze on final-batch completion", () => {
    it("reveals the full text when active flips false before the animation catches up", () => {
        // Frame timing: rAF ticks never advance far before [DONE] lands.
        let now = 0;
        const raf = (cb: FrameRequestCallback) => {
            now += 16;
            return window.setTimeout(() => cb(now), 0) as unknown as number;
        };
        vi.stubGlobal("requestAnimationFrame", raf);
        vi.stubGlobal("cancelAnimationFrame", (id: number) =>
            window.clearTimeout(id),
        );
        vi.stubGlobal("performance", { now: () => now });

        const { result, rerender } = renderHook(
            ({ text, active }) => useSmoothedReveal(text, active),
            { initialProps: { text: "STA", active: true } },
        );

        // First delta partially revealed.
        act(() => {
            rerender({ text: "STA", active: true });
        });
        expect(result.current.length).toBeLessThanOrEqual(3);

        // Final delta + citations + [DONE] land in ONE batch: text becomes
        // complete AND active flips false in the same render pass — the rAF
        // reveal never gets to catch up.
        act(() => {
            rerender({ text: "STATUS=OK; FIM=OK.", active: false });
        });

        // The reveal must snap to the full text immediately — this is the
        // exact assertion the QA oracle makes against the DOM.
        expect(result.current).toBe("STATUS=OK; FIM=OK.");

        vi.unstubAllGlobals();
    });

    it("inactive history replay always renders the full text", () => {
        const { result } = renderHook(() =>
            useSmoothedReveal("STATUS=OK; FIM=OK.", false),
        );
        expect(result.current).toBe("STATUS=OK; FIM=OK.");
    });

    it("active reveal never exposes characters beyond the target text", () => {
        let now = 0;
        const raf = (cb: FrameRequestCallback) => {
            now += 16;
            return window.setTimeout(() => cb(now), 0) as unknown as number;
        };
        vi.stubGlobal("requestAnimationFrame", raf);
        vi.stubGlobal("cancelAnimationFrame", (id: number) =>
            window.clearTimeout(id),
        );
        vi.stubGlobal("performance", { now: () => now });

        const { result, rerender } = renderHook(
            ({ text, active }) => useSmoothedReveal(text, active),
            { initialProps: { text: "STATUS=OK; FIM=OK.", active: true } },
        );

        act(() => {
            rerender({ text: "STATUS=OK; FIM=OK.", active: true });
        });
        expect(result.current.length).toBeLessThanOrEqual("STATUS=OK; FIM=OK.".length);
        expect("STATUS=OK; FIM=OK.".startsWith(result.current)).toBe(true);

        vi.unstubAllGlobals();
    });
});
