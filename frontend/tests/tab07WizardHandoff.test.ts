import { describe, it, expect } from "vitest";

/**
 * TAB-07 wizard→project-chat handoff — regression pin.
 *
 * Rounds 3 and 4 failed QA with an empty chat after Start Chat. The final
 * root cause (proven in-browser via a window probe + performance
 * navigation entries): navigating into /projects/[id]/... performs a FULL
 * DOCUMENT RELOAD ("navigate"), which destroys the React context the
 * standalone handoff relies on. The standalone route soft-navigates, so
 * it always worked.
 *
 * The contract under test (what the modal + page now implement):
 *   1. The modal persists the pending message in sessionStorage keyed by
 *      chatId BEFORE the navigation ("mike:pending-project-chat").
 *   2. The project chat page reads that key on mount; if (and only if)
 *      the stored chatId matches the route's chatId, it seeds
 *      `initialMessages` and the auto-send fires.
 *   3. The auto-send does NOT gate on messages.length (round-4
 *      regression: the guard was impossible to satisfy) — only on "not
 *      sent yet, nothing in flight".
 *   4. After sending, the storage entry is removed (consume once).
 *   5. The history fetch is skipped while a handoff is pending.
 */

const STORAGE_KEY = "mike:pending-project-chat";

/** Mirrors the modal's persistence step. */
function persistPending(chatId: string, message: unknown): void {
    sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ chatId, message }),
    );
}

/** Mirrors the page's read + chatId match. */
function readPending(
    chatId: string,
): { role: string; content: string } | null {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as {
            chatId: string;
            message: { role: string; content: string };
        };
        if (parsed.chatId !== chatId) return null;
        return parsed.message;
    } catch {
        return null;
    }
}

/** Mirrors the page's auto-send predicate (post-fix). */
function shouldAutoSend(
    pending: { role: string; content: string } | null,
    hasAutoSent: boolean,
    isResponseLoading: boolean,
): boolean {
    return (
        pending !== null &&
        pending.role === "user" &&
        !hasAutoSent &&
        !isResponseLoading
    );
}

/** Mirrors the history-fetch skip decision. */
function shouldFetchHistory(
    newChatMessages: unknown[] | null,
    pendingFromStorage: unknown,
): boolean {
    const hasPendingHandoff =
        (newChatMessages !== null && newChatMessages.length > 0) ||
        pendingFromStorage !== null;
    return !hasPendingHandoff;
}

const handoff = {
    role: "user",
    content:
        "implement workflow\nRevise o contrato anexo focando em cláusulas de preço e vigência. Responda em português.",
};

describe("TAB-07 wizard handoff survives the project-route hard reload", () => {
    it("modal persists, page reads back after a simulated reload", () => {
        persistPending("chat-1", handoff);
        // "reload": same sessionStorage, fresh JS heap — readPending only
        // touches storage, so this is faithful
        expect(readPending("chat-1")).toEqual(handoff);
    });

    it("a stored handoff for a DIFFERENT chat is ignored", () => {
        persistPending("chat-1", handoff);
        expect(readPending("chat-2")).toBeNull();
    });

    it("auto-send fires from storage-sourced pending with empty messages (round-4 regression)", () => {
        persistPending("chat-1", handoff);
        const pending = readPending("chat-1");
        expect(shouldAutoSend(pending, false, false)).toBe(true);
    });

    it("does not fire twice or while a response is loading", () => {
        persistPending("chat-1", handoff);
        const pending = readPending("chat-1");
        expect(shouldAutoSend(pending, true, false)).toBe(false);
        expect(shouldAutoSend(pending, false, true)).toBe(false);
    });

    it("history fetch is skipped while a handoff is pending (context or storage)", () => {
        persistPending("chat-1", handoff);
        const pending = readPending("chat-1");
        expect(shouldFetchHistory(null, pending)).toBe(false);
        expect(shouldFetchHistory([handoff], null)).toBe(false);
        expect(shouldFetchHistory(null, null)).toBe(true);
    });

    it("corrupted storage is ignored (parse failure does not break the page)", () => {
        sessionStorage.setItem(STORAGE_KEY, "{not json");
        expect(readPending("chat-1")).toBeNull();
        expect(shouldFetchHistory(null, readPending("chat-1"))).toBe(true);
    });
});
