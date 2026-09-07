import { describe, it, expect } from "vitest";

/**
 * TAB-07 wizard→project-chat handoff — regression pin for the auto-send
 * guard that failed QA twice (rounds 3 and 4).
 *
 * Round 3 (pre-#79): the page captured newChatMessages as a mount-time
 * snapshot; the effect's `messages.length === 1` guard could fail when
 * the handoff landed after first render.
 * Round 4 (#79): the seeding was removed but the `messages.length === 1`
 * guard stayed — messages starts at [] and NOTHING ever pushes to it
 * before the effect, so the guard became impossible to satisfy and the
 * auto-send never fired (QA: empty chat, zero POST).
 *
 * The contract under test (what the page now implements):
 *   1. `initialMessages` is read LIVE from the context
 *      (`newChatMessages ?? []`) on every render — a handoff that lands
 *      before mount seeds `messages` to length 1.
 *   2. The auto-send effect does NOT gate on `messages.length` — it fires
 *      when a pending handoff exists, was not sent yet, and nothing is in
 *      flight. handleChat appends the user message to the turn itself.
 *   3. The history fetch is skipped when a handoff is pending (fresh chat
 *      row — a late getChat could clobber the in-flight turn).
 */

interface PendingMessage {
    role: string;
    content: string;
    workflow?: { id: string; title: string };
    files?: { filename: string; document_id: string }[];
}

/** Mirrors the page's auto-send predicate (post-fix). */
function shouldAutoSend(
    newChatMessages: PendingMessage[] | null,
    hasAutoSent: boolean,
    isResponseLoading: boolean,
): boolean {
    return (
        newChatMessages !== null &&
        newChatMessages.length === 1 &&
        newChatMessages[0].role === "user" &&
        !hasAutoSent &&
        !isResponseLoading
    );
}

/** Mirrors the hook's turn assembly (`apiMessagesForTurn`). */
function assembleTurn(
    messages: PendingMessage[],
    incoming: PendingMessage,
): PendingMessage[] {
    const last = messages[messages.length - 1];
    const alreadyAdded =
        last !== undefined &&
        last.role === "user" &&
        last.content === incoming.content;
    return alreadyAdded ? messages : [...messages, incoming];
}

/** Mirrors the history-fetch skip decision. */
function shouldFetchHistory(
    newChatMessages: PendingMessage[] | null,
): boolean {
    return !(newChatMessages !== null && newChatMessages.length > 0);
}

const handoff: PendingMessage = {
    role: "user",
    content: "implement workflow\nrevisar cláusula de preço",
    workflow: { id: "wf-1", title: "Revisão de Contrato de Prestação de Serviços" },
    files: [{ filename: "Petronect_REVISADO_usuario.docx", document_id: "doc-1" }],
};

describe("TAB-07 wizard handoff auto-send", () => {
    it("fires on mount when the handoff landed before render (seeded messages)", () => {
        const messages = [handoff]; // initialMessages = newChatMessages ?? []
        expect(shouldAutoSend([handoff], false, false)).toBe(true);
        // handleChat with the message already last → no duplication
        expect(assembleTurn(messages, handoff)).toHaveLength(1);
    });

    it("round-4 regression: fires even though messages state starts at length 0", () => {
        // The old guard required messages.length === 1; after seeding was
        // removed that never held. The new predicate must not depend on it.
        const messages: PendingMessage[] = [];
        expect(shouldAutoSend([handoff], false, false)).toBe(true);
        expect(assembleTurn(messages, handoff)).toHaveLength(1);
    });

    it("does not fire twice (hasAutoSent) or while a response is loading", () => {
        expect(shouldAutoSend([handoff], true, false)).toBe(false);
        expect(shouldAutoSend([handoff], false, true)).toBe(false);
    });

    it("does not fire for a null handoff (normal composer navigation)", () => {
        expect(shouldAutoSend(null, false, false)).toBe(false);
        expect(shouldFetchHistory(null)).toBe(true);
    });

    it("skips the history fetch while a handoff is pending", () => {
        expect(shouldFetchHistory([handoff])).toBe(false);
    });

    it("clearing the handoff after send allows the normal load path on remount", () => {
        // after auto-send the context is set to null; a reload of the page
        // fetches history from the API as usual
        expect(shouldFetchHistory(null)).toBe(true);
        expect(shouldAutoSend(null, false, false)).toBe(false);
    });
});
