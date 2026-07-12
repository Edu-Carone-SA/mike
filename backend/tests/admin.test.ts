import { describe, it, expect, vi, beforeEach } from "vitest";

// Build a chainable mock that returns resolved data from maybeSingle
function makeMockClient(profileData: { role: string; status: string } | null, profileError: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: profileData, error: profileError });
  const chainable: any = {
    select: vi.fn(() => chainable),
    eq: vi.fn(() => chainable),
    maybeSingle,
    update: vi.fn(() => chainable),
    insert: vi.fn(() => chainable),
    upsert: vi.fn(() => chainable),
    or: vi.fn(() => chainable),
    order: vi.fn(() => chainable),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
  };
  return {
    auth: {
      getUser: vi.fn(),
      admin: {
        listUsers: vi.fn(),
        createUser: vi.fn(),
        updateUserById: vi.fn(),
        signOut: vi.fn(),
      },
    },
    from: vi.fn(() => chainable),
  };
}

let mockClient: ReturnType<typeof makeMockClient>;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockClient),
}));

import { requireAdmin } from "../src/middleware/auth";

describe("requireAdmin middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SECRET_KEY = "test-service-key";
  });

  it("should return 403 if user is not admin", async () => {
    mockClient = makeMockClient({ role: "member", status: "active" });

    const req = { headers: { authorization: "Bearer test" } } as any;
    const res = {
      locals: { userId: "user-123" },
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ detail: "Admin access required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("should call next() if user is admin", async () => {
    mockClient = makeMockClient({ role: "admin", status: "active" });

    const req = { headers: { authorization: "Bearer test" } } as any;
    const res = {
      locals: { userId: "admin-123" },
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.locals.userRole).toBe("admin");
  });

  it("should return 403 if user is disabled", async () => {
    mockClient = makeMockClient({ role: "admin", status: "disabled" });

    const req = { headers: { authorization: "Bearer test" } } as any;
    const res = {
      locals: { userId: "admin-123" },
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ detail: "Account is disabled" });
  });

  it("should return 403 if profile not found", async () => {
    mockClient = makeMockClient(null);

    const req = { headers: { authorization: "Bearer test" } } as any;
    const res = {
      locals: { userId: "unknown-123" },
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 500 if DB query fails", async () => {
    mockClient = makeMockClient(null, { message: "Connection refused" });

    const req = { headers: { authorization: "Bearer test" } } as any;
    const res = {
      locals: { userId: "user-123" },
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it("should reject if SUPABASE_URL is not set", async () => {
    delete process.env.SUPABASE_URL;

    const req = { headers: { authorization: "Bearer test" } } as any;
    const res = {
      locals: { userId: "user-123" },
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ detail: "Server auth is not configured" });
  });
});
