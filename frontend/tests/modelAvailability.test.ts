/**
 * QA re-acceptance block (14/09/2026): admin-configured models showed
 * "API key missing for selected model" and an inert send — because
 * getModelProvider() only recognized the hardcoded built-in catalog ids.
 * Every model goes through OpenRouter (MIKE-06): availability must be
 * the OpenRouter key status for ANY model id, built-in or admin list.
 */
import { describe, it, expect } from "vitest";
import {
    getModelProvider,
    isModelAvailable,
    isProviderAvailable,
} from "../src/app/lib/modelAvailability";

const KEYS_OK = { openrouter: { configured: true } } as never;
const KEYS_MISSING = { openrouter: { configured: false } } as never;

describe("modelAvailability — OpenRouter-only, any catalog id", () => {
    it("resolves the provider for a built-in catalog id", () => {
        expect(getModelProvider("deepseek/deepseek-v4-flash")).toBe("openrouter");
    });

    it("resolves the provider for an admin-configured platform model (the QA block)", () => {
        expect(getModelProvider("z-ai/glm-5.3-flash")).toBe("openrouter");
        expect(getModelProvider("deepseek/deepseek-v4.1-flash")).toBe("openrouter");
    });

    it("resolves the provider for an arbitrary unknown id — everything is OpenRouter", () => {
        expect(getModelProvider("whatever/model-id")).toBe("openrouter");
    });

    it("a model is available exactly when the OpenRouter key is configured", () => {
        expect(isModelAvailable("z-ai/glm-5.3-flash", KEYS_OK)).toBe(true);
        expect(isModelAvailable("z-ai/glm-5.3-flash", KEYS_MISSING)).toBe(false);
    });

    it("isProviderAvailable reflects the key status", () => {
        expect(isProviderAvailable("openrouter", KEYS_OK)).toBe(true);
        expect(isProviderAvailable("openrouter", KEYS_MISSING)).toBe(false);
    });
});
