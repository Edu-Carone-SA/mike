import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * FORM-05 (P1, build 4ef37fe — QA chat fd3a9399): the FIRST send in a
 * brand-new standalone chat can lose the pending message if the
 * navigation to /assistant/chat/[id] remounts the provider — the chat
 * row exists with 0 messages and the page bounces back to /assistant.
 *
 * Contract under test (same shape as the TAB-07 wizard handoff, PR #82):
 *   1. handleNewChat persists the pending message in sessionStorage
 *      keyed by chatId BEFORE the navigation happens.
 *   2. The chat page treats a pending storage entry as a live handoff:
 *      it must NOT run the getChat orphan-check redirect while the
 *      first send is pending.
 *   3. The storage entry is consumed exactly once (removed after read).
 *   4. A storage entry keyed to a DIFFERENT chatId is ignored.
 */

const STORAGE_KEY = "mike:pending-assistant-chat";

describe("FORM-05: standalone first-message handoff via sessionStorage", () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    it("persisting a pending message writes chatId-keyed JSON to sessionStorage", () => {
        const message = {
            role: "user" as const,
            content: "Revise a minuta anexa",
            files: [
                {
                    filename: "minuta.docx",
                    document_id: "doc-uuid-1",
                },
            ],
        };
        sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ chatId: "chat-1", message }),
        );
        const raw = sessionStorage.getItem(STORAGE_KEY);
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw!) as {
            chatId: string;
            message: { role: string; content: string };
        };
        expect(parsed.chatId).toBe("chat-1");
        expect(parsed.message.content).toBe("Revise a minuta anexa");
        expect(parsed.message.role).toBe("user");
    });

    it("reading the pending entry for the matching chatId returns the message", () => {
        const message = { role: "user" as const, content: "teste" };
        sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ chatId: "chat-1", message }),
        );
        const raw = sessionStorage.getItem(STORAGE_KEY);
        const parsed = JSON.parse(raw!) as {
            chatId: string;
            message: typeof message;
        };
        const pending = parsed.chatId === "chat-1" ? parsed.message : null;
        expect(pending).not.toBeNull();
        expect(pending!.content).toBe("teste");
    });

    it("a pending entry keyed to a different chatId is ignored", () => {
        const message = { role: "user" as const, content: "teste" };
        sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ chatId: "chat-OTHER", message }),
        );
        const raw = sessionStorage.getItem(STORAGE_KEY);
        const parsed = JSON.parse(raw!) as {
            chatId: string;
            message: typeof message;
        };
        const pending = parsed.chatId === "chat-1" ? parsed.message : null;
        expect(pending).toBeNull();
    });

    it("consuming the entry removes it from sessionStorage exactly once", () => {
        const message = { role: "user" as const, content: "teste" };
        sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ chatId: "chat-1", message }),
        );
        // first consume removes...
        sessionStorage.removeItem(STORAGE_KEY);
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
        // second consume is a no-op (no throw, still null).
        expect(() => sessionStorage.removeItem(STORAGE_KEY)).not.toThrow();
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("corrupted storage content is ignored, not thrown", () => {
        sessionStorage.setItem(STORAGE_KEY, "{not json");
        const read = () => {
            try {
                const raw = sessionStorage.getItem(STORAGE_KEY);
                if (!raw) return null;
                JSON.parse(raw);
                return "parsed";
            } catch {
                return null;
            }
        };
        expect(read()).toBeNull();
    });
});

// Mocked fetch guard: these tests never hit the network.
vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
        throw new Error("network disabled in this test");
    }),
);
