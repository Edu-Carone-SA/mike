import { SETTINGS_MODELS, type ModelOption } from "../components/assistant/ModelToggle";
import type { ApiKeyState } from "@/app/lib/mikeApi";

// MIKE-06: OpenRouter-only.
export type ModelProvider = "openrouter";

/**
 * MIKE-06/07: every runnable model goes through OpenRouter — built-in
 * catalog ids AND admin-configured platform models alike. The provider of
 * a model id is therefore "openrouter" regardless of which catalog it
 * comes from; availability is the OpenRouter key status (per-user,
 * platform/admin key, or env — resolved server-side in apiKeyStatus).
 */
export function getModelProvider(modelId: string): ModelProvider | null {
    void modelId;
    return "openrouter";
}

export function isModelAvailable(
    modelId: string,
    apiKeys: ApiKeyState,
): boolean {
    const provider = getModelProvider(modelId);
    if (!provider) return false;
    return isProviderAvailable(provider, apiKeys);
}

export function isProviderAvailable(
    provider: ModelProvider,
    apiKeys: ApiKeyState,
): boolean {
    return !!apiKeys[provider]?.configured;
}

export function providerLabel(provider: ModelProvider): string {
    void provider;
    return "OpenRouter";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider {
    void group;
    return "openrouter";
}
