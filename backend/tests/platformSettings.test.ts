import { describe, it, expect } from "vitest";
import { parseAvailableModels } from "../src/lib/platformSettings";

/**
 * MIKE-07 — platform available-models validation.
 *
 * Admin input is hostile: the parser must reject anything that is not an
 * array of at most 5 well-shaped models (id/name/context_length/pricing),
 * including duplicates.
 */

const valid = (over: Record<string, unknown> = {}) => ({
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    context_length: 1048576,
    pricing: { prompt: "0.00000008246", completion: "0.00000016492" },
    ...over,
});

describe("parseAvailableModels", () => {
    it("accepts a valid list of models", () => {
        const out = parseAvailableModels([valid(), valid({ id: "z-ai/glm-5.3", name: "GLM 5.3" })]);
        expect(out).toEqual([
            {
                id: "deepseek/deepseek-v4-flash",
                name: "DeepSeek V4 Flash",
                context_length: 1048576,
                pricing: { prompt: "0.00000008246", completion: "0.00000016492" },
            },
            { id: "z-ai/glm-5.3", name: "GLM 5.3", context_length: 1048576, pricing: { prompt: "0.00000008246", completion: "0.00000016492" } },
        ]);
    });

    it("rejects more than 5 models", () => {
        const six = Array.from({ length: 6 }, (_, i) => valid({ id: `m/${i}` }));
        expect(parseAvailableModels(six)).toBeNull();
    });

    it("rejects non-array payloads", () => {
        expect(parseAvailableModels(null)).toBeNull();
        expect(parseAvailableModels("models")).toBeNull();
        expect(parseAvailableModels({})).toBeNull();
    });

    it("rejects a model missing pricing", () => {
        expect(parseAvailableModels([{ id: "a/b", name: "A", context_length: 1 }])).toBeNull();
    });

    it("rejects a model with wrong-typed context_length", () => {
        expect(
            parseAvailableModels([valid({ context_length: "huge" })]),
        ).toBeNull();
    });

    it("rejects duplicate model ids", () => {
        expect(parseAvailableModels([valid(), valid()])).toBeNull();
    });

    it("accepts null context_length", () => {
        const out = parseAvailableModels([valid({ context_length: null })]);
        expect(out?.[0].context_length).toBeNull();
    });

    it("accepts an empty list (platform falls back to built-ins)", () => {
        expect(parseAvailableModels([])).toEqual([]);
    });
});
