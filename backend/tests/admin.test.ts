import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock state
let mockProfileData: { role: string; status: string } | null = null;
let mockProfileError: { message: string } | null = null;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
      admin: {
        listUsers: vi.fn(),
        createUser: vi.fn(),
        updateUserById: vi.fn(),
        signOut: vi.fn(),
      },
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockImplementation(async () => ({
            data: mockProfileData,
            error: mockProfileError,
          })),
        })),
      })),
    })),
  })),
}));

import { requireAdmin } from "../src/middleware/auth";

describe("requireAdmin middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SECRET_KEY = "test-service-key";
    mockProfileData = null;
    mockProfileError = null;
  });

  it("should return 403 if user is not admin", async () => {
    mockProfileData = { role: "member", status: "active" };

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
    mockProfileData = { role: "admin", status: "active" };

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
    mockProfileData = { role: "admin", status: "disabled" };

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
    mockProfileData = null;
    mockProfileError = null;

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
    mockProfileError = { message: "Connection refused" };

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
});
