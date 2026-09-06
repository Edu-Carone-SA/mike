import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express from "express";

/**
 * QA DL-01 (NO-GO report, build e7d15fb): browser anchors and the UI
 * Download menu cannot attach an Authorization header, so requireAuth on
 * GET /download/:token made every handed-out link 401
 * ("Failed — Needs authorization"). The fix: optionalAuth — the short-lived
 * HMAC token is itself the authorization when no header is present.
 *
 * These tests mount the REAL optionalAuth middleware (with the Supabase
 * client stubbed) plus a stub download route, and verify the three-party
 * contract:
 *   1. no Authorization header        -> route reached (anonymous, token-auth)
 *   2. valid Bearer header            -> route reached with user identity
 *   3. invalid Bearer header          -> 401 before the route (bad creds are
 *      never silently downgraded to anonymous)
 */

process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SECRET_KEY = "b".repeat(64);
process.env.DOWNLOAD_SIGNING_SECRET = "d".repeat(64);

describe("optionalAuth middleware (DL-01 fix)", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.resetModules();
    // Stub the Supabase client used inside requireAuth: a user token
    // "good-token" resolves to a user, anything else does not.
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => {
        // Postgrest-style chain builder covering auth.getUser and the
        // user_profiles lookups (status check + syncProfileEmail): every
        // select().eq().maybeSingle() resolves to an existing profile
        // whose email already matches (so no insert/update is attempted).
        const chain = {
          maybeSingle: () =>
            Promise.resolve({ data: { status: "active", email: "a@b.c" } }),
        };
        return {
          auth: {
            getUser: (token: string) =>
              Promise.resolve({
                data:
                  token === "good-token"
                    ? { user: { id: "u1", email: "a@b.c" } }
                    : { user: null },
              }),
          },
          from: () => ({
            select: () => ({
              eq: () => chain,
            }),
            insert: () => Promise.resolve({ error: null }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }),
        };
      },
    }));
    const { optionalAuth } = await import("../src/middleware/auth");
    app = express();
    app.get(
      "/download/:token",
      optionalAuth,
      (req: express.Request, res: express.Response) => {
        const userId = (res.locals.userId as string | undefined) ?? null;
        res.status(200).json({ reached: true, userId });
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("anonymous request (no Authorization header) reaches the route — token is the authorization", async () => {
    const res = await request(app).get("/download/abc.def");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true, userId: null });
  });

  it("valid Bearer header reaches the route with the user identity", async () => {
    const res = await request(app)
      .get("/download/abc.def")
      .set("Authorization", "Bearer good-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true, userId: "u1" });
  });

  it("invalid Bearer header is rejected with 401, never downgraded to anonymous", async () => {
    const res = await request(app)
      .get("/download/abc.def")
      .set("Authorization", "Bearer bad-token");
    expect(res.status).toBe(401);
    expect(res.body.reached).toBeUndefined();
  });

  it("malformed Authorization header (no Bearer prefix) is treated as anonymous", async () => {
    const res = await request(app)
      .get("/download/abc.def")
      .set("Authorization", "Basic dXNlcjpwYXNz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true, userId: null });
  });
});
