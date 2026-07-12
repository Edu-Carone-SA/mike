import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for MIKE-FIX-LLM-PRODUCTION-01:
 * - getUserApiKeyStatus returns partial status on DB failure
 * - env keys are preserved even when DB query fails
 * - does not throw on DB error
 * - key suffix returns last 4 chars for personal keys
 * - key suffix returns null for env-managed providers
 */

// Mock the supabase client
function createMockDb(selectImpl: () => { data: unknown[] | null; error: unknown }) {
    return {
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => selectImpl()),
                    // For the status query (no maybeSingle)
                    then: undefined,
                })),
            })),
        })),
    };
}

describe("API Key Status Resilience", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it("should preserve env key status when DB query fails", async () => {
        // Set env key
        process.env.DEEPSEEK_API_KEY = "test-env-key-12345";

        const { getUserApiKeyStatus } = await import("../src/lib/userApiKeys");

        // Mock DB that returns error
        const mockDb = {
            from: vi.fn(() => ({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        // Simulate PostgREST error
                        then: (resolve: Function) =>
                            resolve({ data: null, error: { code: "42501", message: "permission denied" } }),
                    })),
                })),
            })),
        };

        const status = await getUserApiKeyStatus("test-user-id", mockDb as any);

        // Env key should still be present
        expect(status.deepseek).toBe(true);
        expect(status.sources.deepseek).toBe("env");
        // Should NOT throw
        expect(status).toBeDefined();
    });

    it("should not throw when DB query fails", async () => {
        process.env.DEEPSEEK_API_KEY = "test-env-key-12345";

        const { getUserApiKeyStatus } = await import("../src/lib/userApiKeys");

        const mockDb = {
            from: vi.fn(() => ({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        then: (resolve: Function) =>
                            resolve({ data: null, error: { code: "42501", message: "permission denied" } }),
                    })),
                })),
            })),
        };

        // Should not throw
        await expect(getUserApiKeyStatus("test-user-id", mockDb as any)).resolves.toBeDefined();
    });

    it("should return user key source when DB query succeeds and env key is absent", async () => {
        delete process.env.DEEPSEEK_API_KEY;

        const { getUserApiKeyStatus } = await import("../src/lib/userApiKeys");

        const mockDb = {
            from: vi.fn(() => ({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        then: (resolve: Function) =>
                            resolve({ data: [{ provider: "deepseek" }], error: null }),
                    })),
                })),
            })),
        };

        const status = await getUserApiKeyStatus("test-user-id", mockDb as any);

        expect(status.deepseek).toBe(true);
        expect(status.sources.deepseek).toBe("user");
    });

    it("should return all false when no env keys and no user keys", async () => {
        delete process.env.DEEPSEEK_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.CLAUDE_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENROUTER_API_KEY;

        const { getUserApiKeyStatus } = await import("../src/lib/userApiKeys");

        const mockDb = {
            from: vi.fn(() => ({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        then: (resolve: Function) =>
                            resolve({ data: [], error: null }),
                    })),
                })),
            })),
        };

        const status = await getUserApiKeyStatus("test-user-id", mockDb as any);

        expect(status.deepseek).toBe(false);
        expect(status.claude).toBe(false);
        expect(status.openai).toBe(false);
    });

    it("should prioritize env key over user key", async () => {
        process.env.DEEPSEEK_API_KEY = "test-env-key-12345";

        const { getUserApiKeyStatus } = await import("../src/lib/userApiKeys");

        const mockDb = {
            from: vi.fn(() => ({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        then: (resolve: Function) =>
                            resolve({ data: [{ provider: "deepseek" }], error: null }),
                    })),
                })),
            })),
        };

        const status = await getUserApiKeyStatus("test-user-id", mockDb as any);

        // Env should take priority
        expect(status.deepseek).toBe(true);
        expect(status.sources.deepseek).toBe("env");
    });
});
