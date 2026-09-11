import { describe, it, expect } from "vitest";

/**
 * MIKE-07 follow-up (review finding): when the admin configures a model
 * list, it is the ONLY source of truth. The bug: resolveModel() accepted
 * built-in catalog ids (ALL_MODELS) even when the admin list was set, so
 * deepseek/deepseek-v4-flash (built-in, not in the admin list) ran in the
 * chat — violating "only the admin's models".
 *
 * The decision now lives in resolveChatModel() (exported from streaming.ts,
 * the same function the chat path calls) and is tested against the real
 * implementation — not a mirror.
 */
import { resolveChatModel } from "../src/lib/chat/streamingModel";

const ADMIN_LIST = [
    "z-ai/glm-4.6v",
    "deepseek/deepseek-v4.1-flash",
    "moonshotai/kimi-k2.7-code",
];

describe("resolveChatModel — admin list is the only source of truth", () => {
    it("passes a model that is in the admin list", () => {
        expect(resolveChatModel("z-ai/glm-4.6v", ADMIN_LIST)).toBe(
            "z-ai/glm-4.6v",
        );
    });

    it("REJECTS a built-in catalog id that is not in the admin list (the bug)", () => {
        // deepseek/deepseek-v4-flash is in the built-in ALL_MODELS but NOT
        // in the admin list — it must fall back to the first admin model.
        expect(resolveChatModel("deepseek/deepseek-v4-flash", ADMIN_LIST)).toBe(
            "z-ai/glm-4.6v",
        );
        expect(resolveChatModel("z-ai/glm-5.3", ADMIN_LIST)).toBe(
            "z-ai/glm-4.6v",
        );
    });

    it("falls back to the first admin model for unknown/arbitrary ids", () => {
        expect(resolveChatModel("alguem/modelo-inexistente", ADMIN_LIST)).toBe(
            "z-ai/glm-4.6v",
        );
        expect(resolveChatModel(undefined, ADMIN_LIST)).toBe("z-ai/glm-4.6v");
        expect(resolveChatModel(null, ADMIN_LIST)).toBe("z-ai/glm-4.6v");
    });

    it("empty admin list falls back to the built-in catalog via resolveModel", () => {
        expect(resolveChatModel("deepseek/deepseek-v4-flash", [])).toBe(
            "deepseek/deepseek-v4-flash",
        );
        expect(resolveChatModel("z-ai/glm-5.3", [])).toBe("z-ai/glm-5.3");
    });

    it("empty admin list + unknown id falls back to DEFAULT_MAIN_MODEL", () => {
        expect(resolveChatModel("alguem/modelo-inexistente", [])).toBe(
            "deepseek/deepseek-v4-flash",
        );
        expect(resolveChatModel(undefined, [])).toBe(
            "deepseek/deepseek-v4-flash",
        );
    });
});
