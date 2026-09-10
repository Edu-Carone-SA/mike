import crypto from "crypto";
import { createServerSupabase } from "./supabase";

/**
 * MIKE-07: platform-wide settings managed by admins.
 *
 * - Admin-managed OpenRouter API key (encrypted at rest, AES-256-GCM with
 *   the same secret as user keys but a distinct salt label). Used as the
 *   server-side fallback key for every user without a per-user key.
 * - Up to 5 available models (id/name/context_length/pricing) picked from
 *   the OpenRouter catalog; the chat model selector and settings pages
 *   render exactly this list.
 */

export type AvailableModel = {
    id: string;
    name: string;
    context_length: number | null;
    pricing: { prompt: string; completion: string };
};

type PlatformSettingsRow = {
    openrouter_api_key_encrypted: string | null;
    openrouter_api_key_iv: string | null;
    openrouter_api_key_auth_tag: string | null;
    openrouter_api_key_updated_at: string | null;
    available_models: unknown;
    available_models_updated_at: string | null;
};

export type PlatformSettings = {
    hasOpenRouterKey: boolean;
    openRouterKeyUpdatedAt: string | null;
    availableModels: AvailableModel[];
    availableModelsUpdatedAt: string | null;
};

type Db = ReturnType<typeof createServerSupabase>;

// Short in-process cache: the chat path reads settings every turn; the
// admin UI updates them rarely. 30s keeps the admin edit near-instant
// without hammering PostgREST per message.
const CACHE_TTL_MS = 30_000;
let cache: { value: PlatformSettings; at: number } | null = null;

function encryptionKey(): Buffer {
    const secret = process.env.USER_API_KEYS_ENCRYPTION_SECRET;
    if (!secret) {
        throw new Error("USER_API_KEYS_ENCRYPTION_SECRET is not configured");
    }
    return crypto.scryptSync(secret, "mike-platform-settings-v1", 32);
}

function encryptKey(value: string): {
    encrypted: string;
    iv: string;
    authTag: string;
} {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
    ]);
    return {
        encrypted: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
    };
}

function decryptKey(row: {
    openrouter_api_key_encrypted: string | null;
    openrouter_api_key_iv: string | null;
    openrouter_api_key_auth_tag: string | null;
} | null): string | null {
    if (!row) return null;
    if (
        !row.openrouter_api_key_encrypted ||
        !row.openrouter_api_key_iv ||
        !row.openrouter_api_key_auth_tag
    ) {
        return null;
    }
    try {
        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            encryptionKey(),
            Buffer.from(row.openrouter_api_key_iv, "base64"),
        );
        decipher.setAuthTag(
            Buffer.from(row.openrouter_api_key_auth_tag, "base64"),
        );
        const decrypted = Buffer.concat([
            decipher.update(
                Buffer.from(row.openrouter_api_key_encrypted, "base64"),
            ),
            decipher.final(),
        ]);
        return decrypted.toString("utf8");
    } catch (err) {
        console.error("[platform-settings] failed to decrypt OpenRouter key", {
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

/** Shape-validates an available-models payload (admin input is hostile). */
export function parseAvailableModels(value: unknown): AvailableModel[] | null {
    if (!Array.isArray(value) || value.length > 5) return null;
    const models: AvailableModel[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
        if (!raw || typeof raw !== "object") return null;
        const m = raw as Record<string, unknown>;
        if (typeof m.id !== "string" || !m.id.trim()) return null;
        if (typeof m.name !== "string" || !m.name.trim()) return null;
        if (
            m.context_length !== null &&
            typeof m.context_length !== "number"
        ) {
            return null;
        }
        const pricing = m.pricing as Record<string, unknown> | undefined;
        if (
            !pricing ||
            typeof pricing.prompt !== "string" ||
            typeof pricing.completion !== "string"
        ) {
            return null;
        }
        const id = m.id.trim();
        if (seen.has(id)) return null;
        seen.add(id);
        models.push({
            id,
            name: m.name.trim(),
            context_length: m.context_length,
            pricing: { prompt: pricing.prompt, completion: pricing.completion },
        });
    }
    return models;
}

export async function getPlatformSettings(
    db: Db = createServerSupabase(),
    opts: { forceRefresh?: boolean } = {},
): Promise<PlatformSettings> {
    if (!opts.forceRefresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
        return cache.value;
    }
    const { data, error } = await db
        .from("platform_settings")
        .select(
            "openrouter_api_key_encrypted, openrouter_api_key_iv, openrouter_api_key_auth_tag, openrouter_api_key_updated_at, available_models, available_models_updated_at",
        )
        .eq("id", 1)
        .maybeSingle();

    if (error) {
        console.error("[platform-settings] read failed", {
            error: error.message,
        });
        // Fail open to defaults rather than 500-ing every chat turn.
        return {
            hasOpenRouterKey: false,
            openRouterKeyUpdatedAt: null,
            availableModels: [],
            availableModelsUpdatedAt: null,
        };
    }

    const row = (data ?? null) as PlatformSettingsRow | null;
    const parsedModels = parseAvailableModels(row?.available_models);
    const settings: PlatformSettings = {
        hasOpenRouterKey: !!decryptKey(row),
        openRouterKeyUpdatedAt: row?.openrouter_api_key_updated_at ?? null,
        availableModels: parsedModels ?? [],
        availableModelsUpdatedAt: row?.available_models_updated_at ?? null,
    };
    cache = { value: settings, at: Date.now() };
    return settings;
}

/** Decrypted admin key, or null when not set (caller falls back to env). */
export async function getPlatformOpenRouterKey(
    db: Db = createServerSupabase(),
): Promise<string | null> {
    const { data } = await db
        .from("platform_settings")
        .select(
            "openrouter_api_key_encrypted, openrouter_api_key_iv, openrouter_api_key_auth_tag",
        )
        .eq("id", 1)
        .maybeSingle();
    return decryptKey((data ?? null) as PlatformSettingsRow | null);
}

export async function setPlatformOpenRouterKey(
    actorUserId: string,
    value: string | null,
    db: Db = createServerSupabase(),
): Promise<void> {
    if (value !== null && !value.trim()) {
        throw new Error("API key must be non-empty");
    }
    const fields = value
        ? (() => {
              const enc = encryptKey(value.trim());
              return {
                  openrouter_api_key_encrypted: enc.encrypted,
                  openrouter_api_key_iv: enc.iv,
                  openrouter_api_key_auth_tag: enc.authTag,
                  openrouter_api_key_updated_at: new Date().toISOString(),
                  openrouter_api_key_updated_by: actorUserId,
              };
          })()
        : {
              openrouter_api_key_encrypted: null,
              openrouter_api_key_iv: null,
              openrouter_api_key_auth_tag: null,
              openrouter_api_key_updated_at: new Date().toISOString(),
              openrouter_api_key_updated_by: actorUserId,
          };
    const { error } = await db
        .from("platform_settings")
        .update(fields)
        .eq("id", 1);
    if (error) throw new Error(error.message);
    cache = null;
}

export async function setAvailableModels(
    actorUserId: string,
    models: AvailableModel[],
    db: Db = createServerSupabase(),
): Promise<void> {
    if (models.length > 5) {
        throw new Error("At most 5 models are allowed");
    }
    const { error } = await db
        .from("platform_settings")
        .update({
            available_models: models,
            available_models_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq("id", 1);
    if (error) throw new Error(error.message);
    cache = null;
}
