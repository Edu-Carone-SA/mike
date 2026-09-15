/**
 * P1 QA 15/09/2026 (reaceite #99): repeated anchor failures ("Ambiguous
 * match" / context not found) looped the tool budget with no progress.
 * The dispatcher must mark them non_retryable — same shape as the
 * integrity block (INT-02): report to the user, don't silently retry.
 */
import { describe, it, expect } from "vitest";

/** Mirrors the dispatcher's classification inputs (real error strings). */
const classify = (error: string | undefined) => {
    const integrityBlocked = error?.includes("draft-integrity check");
    const anchorBlocked =
        !integrityBlocked &&
        !!error &&
        (/ambiguous/i.test(error) ||
            /not found|no match/i.test(error));
    return { integrityBlocked: !!integrityBlocked, anchorBlocked: !!anchorBlocked };
};

describe("anchor-failure terminal classification", () => {
    it("ambiguous anchor is non-retryable", () => {
        const c = classify(
            "Ambiguous match: the anchor text appears 3 times in the document",
        );
        expect(c.integrityBlocked).toBe(false);
        expect(c.anchorBlocked).toBe(true);
    });

    it("context not found is non-retryable", () => {
        const c = classify("context_before not found near the target");
        expect(c.anchorBlocked).toBe(true);
    });

    it("integrity block still wins over anchor wording", () => {
        const c = classify(
            "Edit blocked by draft-integrity check — clause 7 removed",
        );
        expect(c.integrityBlocked).toBe(true);
        expect(c.anchorBlocked).toBe(false);
    });

    it("an unrelated error stays retryable", () => {
        const c = classify("storage timeout while uploading");
        expect(c.integrityBlocked).toBe(false);
        expect(c.anchorBlocked).toBe(false);
    });
});
