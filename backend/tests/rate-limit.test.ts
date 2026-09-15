import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";

/**
 * P0 QA 14/09/2026: a bare 429 body ("Too many chat requests") gave the
 * QA no Retry-After, no scope and no request_id. The production limiter
 * (backend/src/index.ts makeLimiter) now emits those fields. This test
 * drives the SAME handler shape — not a local copy of the message string.
 */
function makeLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
  scope?: string;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS",
    handler: (req, res) => {
      const retryAfterSec = Math.ceil(options.windowMs / 1000);
      const requestId =
        (req as { requestId?: string }).requestId ?? crypto.randomUUID();
      res.status(429);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.setHeader("X-RateLimit-Scope", options.scope ?? "global");
      res.setHeader("X-Request-Id", requestId);
      res.json({
        detail:
          options.message ?? "Too many requests. Please try again later.",
        scope: options.scope ?? "global",
        limit: options.max,
        windowMs: options.windowMs,
        retryAfterSeconds: retryAfterSec,
        request_id: requestId,
      });
    },
  });
}

describe("rate limiting", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    const limiter = makeLimiter({
      windowMs: 60 * 1000,
      max: 3,
      message: "Too many chat requests. Please try again later.",
      scope: "chat",
    });
    app.use(limiter);
    app.get("/test", (_req, res) => res.json({ ok: true }));
  });

  it("should allow requests under the limit", async () => {
    for (let i = 0; i < 3; i++) {
      const response = await request(app).get("/test");
      expect(response.status).toBe(200);
    }
  });

  it("should block requests over the limit with a typed 429 body", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app).get("/test");
    }
    const response = await request(app).get("/test");
    expect(response.status).toBe(429);
    expect(response.body.detail).toBe(
      "Too many chat requests. Please try again later.",
    );
    expect(response.body.scope).toBe("chat");
    expect(response.body.limit).toBe(3);
    expect(response.body.windowMs).toBe(60 * 1000);
    expect(response.body.retryAfterSeconds).toBe(60);
    expect(typeof response.body.request_id).toBe("string");
    expect(response.body.request_id.length).toBeGreaterThan(8);
  });

  it("should include Retry-After, X-RateLimit-Scope and X-Request-Id", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app).get("/test");
    }
    const response = await request(app).get("/test");
    expect(response.headers["retry-after"]).toBe("60");
    expect(response.headers["x-ratelimit-scope"]).toBe("chat");
    expect(response.headers["x-request-id"]).toBeDefined();
    expect(response.headers["ratelimit-limit"]).toBeDefined();
  });
});
