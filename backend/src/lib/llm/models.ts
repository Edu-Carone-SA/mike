import type { Provider } from "./types";

// ---------------------------------------------------------------------------
// Canonical model IDs — OpenRouter ONLY (MIKE-06)
// ---------------------------------------------------------------------------
// The platform runs exclusively through OpenRouter: the admin (or a user
// with a per-user key) provides an OpenRouter API key and picks models
// from the OpenRouter catalog. Legacy direct providers (claude, gemini,
// openai, deepseek native) were removed.

// Main-chat tier (top-end) — user picks one of these per message.
export const OPENROUTER_MAIN_MODELS = [
    "deepseek/deepseek-v4-flash",
    "z-ai/glm-5.3",
] as const;

// Mid-tier (used for tabular review) — user picks one in account settings.
export const OPENROUTER_MID_MODELS = ["deepseek/deepseek-v4-flash"] as const;

// Low-tier (used for title generation, lightweight extractions) — user picks
// one in account settings.
export const OPENROUTER_LOW_MODELS = ["deepseek/deepseek-v4-flash"] as const;

export const DEFAULT_MAIN_MODEL = "deepseek/deepseek-v4-flash";
export const DEFAULT_TITLE_MODEL = "deepseek/deepseek-v4-flash";
export const DEFAULT_TABULAR_MODEL = "deepseek/deepseek-v4-flash";

// Fallback map for OpenRouter models: when the primary model exhausts retries
// (429/5xx upstream overload), the adapter retries once with the fallback.
export const OPENROUTER_FALLBACK: Record<string, string> = {
    "deepseek/deepseek-v4-flash": "z-ai/glm-5.3",
    "deepseek/deepseek-chat": "z-ai/glm-5.3",
    "z-ai/glm-5.3": "deepseek/deepseek-v4-flash",
};

const ALL_MODELS = new Set<string>([
    ...OPENROUTER_MAIN_MODELS,
    ...OPENROUTER_MID_MODELS,
    ...OPENROUTER_LOW_MODELS,
]);

// ---------------------------------------------------------------------------
// Provider inference
// ---------------------------------------------------------------------------

/** MIKE-06: OpenRouter-only — every known model routes through OpenRouter.
 * Unrecognized legacy IDs (claude-*, gpt-*, gemini-*, deepseek-* without
 * a slash) fall back to openrouter instead of throwing, so stored user
 * preferences referencing removed models keep working (resolveModel maps
 * them to a default before they ever get here). */
export function providerForModel(model: string): Provider {
    void model;
    return "openrouter";
}

export function resolveModel(id: string | null | undefined, fallback: string): string {
    if (id && ALL_MODELS.has(id)) return id;
    return fallback;
}
