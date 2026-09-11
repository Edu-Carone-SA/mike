import { createServerSupabase } from "./supabase";
import {
    resolveModel,
    DEFAULT_TITLE_MODEL,
    DEFAULT_TABULAR_MODEL,
    OPENROUTER_LOW_MODELS,
    type UserApiKeys,
} from "./llm";
import { getUserApiKeys as getStoredUserApiKeys } from "./userApiKeys";
import {
    getPlatformSettings,
    getPlatformOpenRouterKey,
} from "./platformSettings";

export type UserModelSettings = {
    title_model: string;
    tabular_model: string;
    legal_research_us: boolean;
    api_keys: UserApiKeys;
};

// MIKE-06: OpenRouter-only — title generation uses the OpenRouter low-tier
// model whenever a key (user or server-side env) exists.
function resolveTitleModel(apiKeys: UserApiKeys): string {
    if (apiKeys.openrouter?.trim()) return OPENROUTER_LOW_MODELS[0];
    return DEFAULT_TITLE_MODEL;
}

export async function getUserModelSettings(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserModelSettings> {
    const client = db ?? createServerSupabase();
    const { data } = await client
        .from("user_profiles")
        .select("title_model, tabular_model, legal_research_us")
        .eq("user_id", userId)
        .single();
    const api_keys = await getStoredUserApiKeys(userId, client);

    // MIKE-07: with an admin-configured platform list, a stored preference
    // outside that list (e.g. a built-in id saved before the admin list
    // existed) resolves to the first admin model — the same rule the chat
    // dispatch applies.
    let allowed: string[] = [];
    try {
        const platform = await getPlatformSettings(client);
        allowed = platform.availableModels.map((m) => m.id);
    } catch {
        allowed = [];
    }
    const resolveAgainstList = (saved: string | null | undefined, fallback: string): string => {
        if (allowed.length === 0) return resolveModel(saved, fallback);
        return saved && allowed.includes(saved) ? saved : allowed[0];
    };

    return {
        title_model: resolveAgainstList(data?.title_model, resolveTitleModel(api_keys)),
        tabular_model: resolveAgainstList(data?.tabular_model, DEFAULT_TABULAR_MODEL),
        legal_research_us:
            (data as { legal_research_us?: boolean | null } | null)
                ?.legal_research_us !== false,
        api_keys,
    };
}

export async function getUserApiKeys(
    userId: string,
    db?: ReturnType<typeof createServerSupabase>,
): Promise<UserApiKeys> {
    const client = db ?? createServerSupabase();
    const apiKeys = await getStoredUserApiKeys(userId, client);
    // MIKE-07: key resolution order per user: per-user key → admin-managed
    // platform key (platform_settings) → env OPENROUTER_API_KEY (the
    // adapter's own fallback).
    if (!apiKeys.openrouter?.trim()) {
        try {
            const platformKey = await getPlatformOpenRouterKey(client);
            if (platformKey?.trim()) {
                apiKeys.openrouter = platformKey;
            }
        } catch (err) {
            console.error("[user-settings] platform key fallback failed", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return apiKeys;
}
