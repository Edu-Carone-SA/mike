/**
 * P0-1 (QA report 14/09/2026): automated client-side SSE consumer test.
 *
 * The QA reproduced answers visually frozen after the first few characters
 * ("STATU"), with no terminal marker, while the server had completed and
 * persisted the full answer. This test feeds a synthetic SSE stream in
 * short fragments — including a single SSE line split across two chunks
 * (byte-level split mid-JSON, the exact "S/T/A/T/U/S" shape) — through the
 * SAME parsing contract the chat hook uses (buffer + "\n" split + keep the
 * trailing partial line), and asserts:
 *   1. every content_delta is accumulated — no loss;
 *   2. [DONE] is recognized and ends the loop;
 *   3. the final text is complete and the loop exits with a single
 *      terminal transition (isResponseLoading equivalent flips once).
 *
 * The parser under test is extracted verbatim from
 * useAssistantChat.ts into parseSseBuffer() (single source of truth) so a
 * regression in the hook's parsing fails HERE.
 */
import { describe, it, expect } from "vitest";
import { parseSseBuffer, consumeSseStream } from "../src/app/lib/sseStream";

const enc = new TextEncoder();

function sse(payload: unknown): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("parseSseBuffer — fragment-safe SSE line parsing", () => {
    it("parses complete lines and keeps a trailing partial line buffered", () => {
        const buffer = sse({ type: "content_delta", text: "STATU" }) +
            "data: {\"type\":\"content_del";
        const { events, rest } = parseSseBuffer(buffer);
        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({ type: "content_delta", text: "STATU" });
        expect(rest).toBe("data: {\"type\":\"content_del");
    });

    it("ignores non-data lines and blank lines", () => {
        const { events, rest } = parseSseBuffer(
            ": keep-alive\n\nfoo bar\n\n" + sse({ type: "job_status", state: "queued" }),
        );
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ type: "job_status" });
        expect(rest).toBe("");
    });

    it("recognizes [DONE]", () => {
        const { events, rest, done } = parseSseBuffer(
            sse({ type: "content_delta", text: "x" }) + "data: [DONE]\n\n",
        );
        expect(done).toBe(true);
        expect(events).toHaveLength(1);
        expect(rest).toBe("");
    });

    it("survives a JSON event split byte-by-byte across chunks", () => {
        // The full line, then fed one byte at a time.
        const line = sse({ type: "content_delta", text: "S" });
        let buffer = "";
        let collected: unknown[] = [];
        let rest = "";
        for (const ch of line) {
            const out = parseSseBuffer(buffer + ch);
            collected = collected.concat(out.events);
            buffer = out.rest;
            rest = out.rest;
        }
        expect(collected).toEqual([{ type: "content_delta", text: "S" }]);
        expect(rest).toBe("");
    });
});

describe("consumeSseStream — the P0 repro shapes", () => {
    it("accumulates single-character deltas (S,T,A,T,U,S) into the full text", async () => {
        const chunks = ["S", "T", "A", "T", "U", "S"].map((c) =>
            enc.encode(sse({ type: "content_delta", text: c })),
        );
        chunks.push(enc.encode("data: [DONE]\n\n"));
        const result = await consumeSseStream(asyncify(chunks));
        expect(result.text).toBe("STATUS");
        expect(result.sawDone).toBe(true);
        expect(result.loopEnded).toBe(true);
    });

    it("keeps every delta when one SSE line is split mid-JSON across chunks", async () => {
        const a = sse({ type: "chat_id", chatId: "c1" });
        const b = sse({ type: "content_delta", text: "STATUS=OK; " });
        const c = sse({ type: "content_delta", text: "FIM=OK." });
        // split b in the middle of the JSON payload
        const b1 = b.slice(0, 20);
        const b2 = b.slice(20);
        const chunks = [a, b1, b2, c, enc.encode("data: [DONE]\n\n")].map((s) =>
            typeof s === "string" ? enc.encode(s) : s,
        );
        const result = await consumeSseStream(asyncify(chunks));
        expect(result.text).toBe("STATUS=OK; FIM=OK.");
        expect(result.sawDone).toBe(true);
        expect(result.loopEnded).toBe(true);
    });

    it("ends the loop on stream EOF even without [DONE] (never hangs)", async () => {
        const chunks = [enc.encode(sse({ type: "content_delta", text: "partial" }))];
        const result = await consumeSseStream(asyncify(chunks));
        expect(result.text).toBe("partial");
        expect(result.sawDone).toBe(false);
        expect(result.loopEnded).toBe(true);
    });

    it("delivers exactly one terminal transition per stream", async () => {
        const chunks = [
            enc.encode(sse({ type: "content_delta", text: "x" })),
            enc.encode("data: [DONE]\n\ndata: [DONE]\n\n"), // duplicated DONE must not double-fire
        ];
        const result = await consumeSseStream(asyncify(chunks));
        expect(result.doneCount).toBe(1);
        expect(result.loopEnded).toBe(true);
    });
});

/** Minimal ReadableStream-like reader fed by a chunk list. */
function asyncify(chunks: Uint8Array[]) {
    let i = 0;
    return {
        read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
            if (i < chunks.length) return { done: false, value: chunks[i++] };
            return { done: true };
        },
    };
}
