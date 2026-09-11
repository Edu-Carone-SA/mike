import { describe, it, expect } from "vitest";
import { resolveActiveModelId } from "../src/app/components/assistant/ModelToggle";

/**
 * MIKE-07 follow-up #2 (Edu's screenshot): Model Preferences showed
 * "Select a model" for both dropdowns. Root cause: the stored preference
 * (a built-in id like deepseek/deepseek-v4-flash) was not in the
 * admin-configured list and nothing resolved it to an active model.
 *
 * The contract: a stored preference outside the active list resolves to
 * the FIRST active model (same rule the backend chat dispatch applies).
 */

const ADMIN_LIST = [
    { id: "z-ai/glm-4.6v", name: "Z.ai: GLM 4.6V" },
    { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek: DeepSeek V4.1 Flash" },
    { id: "moonshotai/kimi-k2.7-code", name: "MoonshotAI: Kimi K2.7 Code" },
];

describe("resolveActiveModelId — stored preference vs active list", () => {
    it("keeps a stored preference that is in the admin list", () => {
        expect(
            resolveActiveModelId("deepseek/deepseek-v4.1-flash", ADMIN_LIST),
        ).toBe("deepseek/deepseek-v4.1-flash");
    });

    it("resolves a built-in id outside the admin list to the first admin model (the screenshot bug)", () => {
        expect(resolveActiveModelId("deepseek/deepseek-v4-flash", ADMIN_LIST)).toBe(
            "z-ai/glm-4.6v",
        );
        expect(resolveActiveModelId("z-ai/glm-5.3", ADMIN_LIST)).toBe("z-ai/glm-4.6v");
    });

    it("resolves missing/undefined to the first active model", () => {
        expect(resolveActiveModelId(undefined, ADMIN_LIST)).toBe("z-ai/glm-4.6v");
        expect(resolveActiveModelId(null, ADMIN_LIST)).toBe("z-ai/glm-4.6v");
    });

    it("falls back to the built-in default when there is no admin list", () => {
        expect(resolveActiveModelId("deepseek/deepseek-v4-flash", [])).toBe(
            "deepseek/deepseek-v4-flash",
        );
        expect(resolveActiveModelId(undefined, [])).toBe("deepseek/deepseek-v4-flash");
    });
});
