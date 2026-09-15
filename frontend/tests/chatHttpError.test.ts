/**
 * P0 QA 15/09/2026 (#96 reaceite): a 429 on POST /chat must never render
 * as "Análise pausada" or a fake Completed. formatChatHttpError is the
 * real UI formatter.
 */
import { describe, it, expect } from "vitest";
import { formatChatHttpError } from "../src/app/lib/chatHttpError";

describe("formatChatHttpError — typed 429", () => {
    it("renders scope, limit, retry and request_id from the typed body", () => {
        const msg = formatChatHttpError(
            429,
            JSON.stringify({
                detail: "Too many chat requests. Please try again later.",
                scope: "chat",
                limit: 120,
                windowMs: 900000,
                retryAfterSeconds: 900,
                request_id: "req-abc-123",
            }),
        );
        expect(msg).toContain("Limite de solicitações de chat atingido");
        expect(msg).toContain("900 segundos");
        expect(msg).toContain("Escopo: chat");
        expect(msg).toContain("Limite: 120");
        expect(msg).toContain("request_id: req-abc-123");
        expect(msg.toLowerCase()).not.toContain("análise pausada");
        expect(msg.toLowerCase()).not.toContain("completed");
    });

    it("falls back to Retry-After / X-Request-Id headers", () => {
        const headers = new Headers({
            "Retry-After": "60",
            "X-Request-Id": "hdr-id",
            "X-RateLimit-Scope": "chat",
        });
        const msg = formatChatHttpError(429, "Too many chat requests", headers);
        expect(msg).toContain("60 segundos");
        expect(msg).toContain("request_id: hdr-id");
        expect(msg).toContain("Escopo: chat");
    });

    it("does not wrap non-429 JSON detail", () => {
        const msg = formatChatHttpError(400, JSON.stringify({ detail: "Chat not found" }));
        expect(msg).toBe("Chat not found");
    });
});
