"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    AlertCircle,
    Check,
    Loader2,
    Plus,
    Search,
    Shield,
    Trash2,
} from "lucide-react";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import {
    getPlatformSettingsApi,
    searchOpenRouterCatalog,
    updatePlatformSettingsApi,
    type OpenRouterCatalogModel,
    type PlatformModel,
} from "@/app/lib/mikeApi";
import { accountGlassInputClassName } from "../accountStyles";
import { AccountSection } from "../AccountSection";

const MAX_MODELS = 5;

function formatContext(n: number | null): string {
    if (n === null) return "—";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M ctx`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K ctx`;
    return `${n} ctx`;
}

/** OpenRouter prices are USD per token — show per 1M tokens, readable. */
function formatPrice(perToken: string): string {
    const value = Number(perToken);
    if (!Number.isFinite(value)) return "—";
    const perMillion = value * 1_000_000;
    if (perMillion === 0) return "Free";
    if (perMillion < 1) return `$${perMillion.toFixed(2)}/M`;
    return `$${perMillion.toFixed(perMillion % 1 === 0 ? 0 : 2)}/M`;
}

export default function PlatformSettingsPage() {
    const { profile } = useUserProfile();

    const [hasKey, setHasKey] = useState(false);
    const [keyUpdatedAt, setKeyUpdatedAt] = useState<string | null>(null);
    const [keyInput, setKeyInput] = useState("");
    const [keySaving, setKeySaving] = useState(false);
    const [keySaved, setKeySaved] = useState(false);

    const [selected, setSelected] = useState<PlatformModel[]>([]);
    const [modelsSaving, setModelsSaving] = useState(false);
    const [modelsSaved, setModelsSaved] = useState(false);

    const [query, setQuery] = useState("");
    const [results, setResults] = useState<OpenRouterCatalogModel[]>([]);
    const [searching, setSearching] = useState(false);
    const [showResults, setShowResults] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isAdmin = profile?.role === "admin";

    const loadSettings = useCallback(async () => {
        try {
            const settings = await getPlatformSettingsApi();
            setHasKey(settings.hasOpenRouterKey);
            setKeyUpdatedAt(settings.openRouterKeyUpdatedAt);
            setSelected(settings.availableModels);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load settings");
        }
    }, []);

    useEffect(() => {
        if (isAdmin) loadSettings();
    }, [isAdmin, loadSettings]);

    useEffect(() => {
        return () => {
            if (searchTimer.current) clearTimeout(searchTimer.current);
        };
    }, []);

    // Debounced catalog search (admin-only endpoint)
    const runSearch = useCallback((q: string) => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        if (!q.trim()) {
            setResults([]);
            setShowResults(false);
            return;
        }
        searchTimer.current = setTimeout(async () => {
            setSearching(true);
            try {
                const resp = await searchOpenRouterCatalog(q.trim());
                setResults(resp.models);
                setShowResults(true);
            } catch (e) {
                setError(
                    e instanceof Error ? e.message : "Catalog search failed",
                );
            } finally {
                setSearching(false);
            }
        }, 300);
    }, []);

    const saveKey = async (value: string | null) => {
        setKeySaving(true);
        setKeySaved(false);
        setError(null);
        try {
            const resp = await updatePlatformSettingsApi({
                openrouter_api_key: value,
            });
            setHasKey(resp.hasOpenRouterKey);
            setKeyUpdatedAt(resp.openRouterKeyUpdatedAt);
            setKeyInput("");
            setKeySaved(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save key");
        } finally {
            setKeySaving(false);
        }
    };

    const saveModels = async (models: PlatformModel[]) => {
        setModelsSaving(true);
        setModelsSaved(false);
        setError(null);
        try {
            const resp = await updatePlatformSettingsApi({
                available_models: models,
            });
            setSelected(resp.availableModels);
            setModelsSaved(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save models");
        } finally {
            setModelsSaving(false);
        }
    };

    const addModel = (m: OpenRouterCatalogModel) => {
        if (selected.length >= MAX_MODELS) return;
        if (selected.some((s) => s.id === m.id)) return;
        const next = [
            ...selected,
            {
                id: m.id,
                name: m.name,
                context_length: m.context_length,
                pricing: { ...m.pricing },
            },
        ];
        saveModels(next);
        setShowResults(false);
        setQuery("");
    };

    const removeModel = (id: string) => {
        saveModels(selected.filter((s) => s.id !== id));
    };

    if (!isAdmin) {
        return (
            <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="h-4 w-4" />
                Admin access required.
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-center gap-2 mb-1">
                <Shield className="h-5 w-5 text-gray-500" />
                <h2 className="text-2xl font-medium font-serif text-gray-900">
                    Platform Settings
                </h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
                Admin-managed OpenRouter key and the models available to every
                user of this instance.
            </p>

            {error && (
                <div
                    role="alert"
                    className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                </div>
            )}

            {/* --- OpenRouter API key --- */}
            <AccountSection>
                <div className="px-4 py-5">
                    <label className="text-sm font-medium text-gray-700 block mb-2">
                        OpenRouter API key
                    </label>
                    <p className="text-xs text-gray-400 mb-3">
                        Used server-side for every user without their own key.
                        The key is encrypted at rest and never sent back to the
                        browser. When cleared, the instance falls back to the
                        environment key.
                    </p>
                    <div className="flex items-center gap-2">
                        <input
                            type="password"
                            value={keyInput}
                            onChange={(e) => setKeyInput(e.target.value)}
                            placeholder={
                                hasKey
                                    ? "•••••••• (a key is configured)"
                                    : "sk-or-..."
                            }
                            className={`flex-1 h-9 px-3 text-sm ${accountGlassInputClassName}`}
                            autoComplete="off"
                        />
                        <button
                            type="button"
                            disabled={keySaving || !keyInput.trim()}
                            onClick={() => saveKey(keyInput.trim())}
                            className="flex h-9 items-center gap-1.5 rounded-lg bg-neutral-800 px-3 text-sm text-white disabled:cursor-default disabled:opacity-50"
                        >
                            {keySaving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : keySaved ? (
                                <Check className="h-3.5 w-3.5" />
                            ) : (
                                <Plus className="h-3.5 w-3.5" />
                            )}
                            Save
                        </button>
                        {hasKey && (
                            <button
                                type="button"
                                disabled={keySaving}
                                onClick={() => saveKey(null)}
                                className="flex h-9 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                Clear
                            </button>
                        )}
                    </div>
                    {keyUpdatedAt && (
                        <p className="mt-2 text-xs text-gray-400">
                            Last updated{" "}
                            {new Date(keyUpdatedAt).toLocaleString("en-US")}
                        </p>
                    )}
                </div>
            </AccountSection>

            {/* --- Available models --- */}
            <AccountSection className="mt-8">
                <div className="px-4 py-5">
                    <label className="text-sm font-medium text-gray-700 block mb-2">
                        Available models ({selected.length}/{MAX_MODELS})
                    </label>
                    <p className="text-xs text-gray-400 mb-3">
                        Pick up to {MAX_MODELS} models from the OpenRouter
                        catalog. These are the models every user can choose in
                        the chat and in Model Preferences. With an empty list,
                        the built-in defaults remain active.
                    </p>

                    {/* search */}
                    <div className="relative mb-3">
                        <div className="flex items-center gap-2">
                            <Search className="h-4 w-4 text-gray-400 shrink-0 ml-1" />
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => {
                                    setQuery(e.target.value);
                                    runSearch(e.target.value);
                                }}
                                onFocus={() => {
                                    if (results.length > 0) setShowResults(true);
                                }}
                                placeholder="Search 400+ models (name or id)…"
                                className={`flex-1 h-9 px-3 text-sm ${accountGlassInputClassName}`}
                            />
                            {searching && (
                                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                            )}
                        </div>

                        {showResults && results.length > 0 && (
                            <div
                                className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg"
                                onMouseLeave={() => setShowResults(false)}
                            >
                                {results.map((m) => {
                                    const already =
                                        selected.some((s) => s.id === m.id);
                                    const full =
                                        selected.length >= MAX_MODELS;
                                    return (
                                        <button
                                            key={m.id}
                                            type="button"
                                            disabled={already || full}
                                            onClick={() => addModel(m)}
                                            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50 disabled:cursor-default disabled:opacity-40"
                                        >
                                            <div className="min-w-0">
                                                <div className="truncate text-sm text-gray-900">
                                                    {m.name}
                                                </div>
                                                <div className="truncate text-xs text-gray-400">
                                                    {m.id}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-3 text-xs text-gray-500">
                                                <span>
                                                    {formatContext(
                                                        m.context_length,
                                                    )}
                                                </span>
                                                <span title="Input / output price per 1M tokens">
                                                    {formatPrice(
                                                        m.pricing.prompt,
                                                    )}{" "}
                                                    /{" "}
                                                    {formatPrice(
                                                        m.pricing.completion,
                                                    )}
                                                </span>
                                                {already ? (
                                                    <Check className="h-3.5 w-3.5 text-green-600" />
                                                ) : (
                                                    <Plus className="h-3.5 w-3.5" />
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* selected models */}
                    <div className="space-y-2">
                        {selected.length === 0 && (
                            <p className="text-sm text-gray-400">
                                No models selected — the built-in defaults are
                                active.
                            </p>
                        )}
                        {selected.map((m) => (
                            <div
                                key={m.id}
                                data-testid={`platform-model-${m.id}`}
                                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white/60 px-3 py-2.5"
                            >
                                <div className="min-w-0">
                                    <div className="truncate text-sm text-gray-900">
                                        {m.name}
                                    </div>
                                    <div className="truncate text-xs text-gray-400">
                                        {m.id}
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-3 text-xs text-gray-500">
                                    <span>
                                        {formatContext(m.context_length)}
                                    </span>
                                    <span title="Input / output price per 1M tokens">
                                        {formatPrice(m.pricing.prompt)} /{" "}
                                        {formatPrice(m.pricing.completion)}
                                    </span>
                                    <button
                                        type="button"
                                        disabled={modelsSaving}
                                        onClick={() => removeModel(m.id)}
                                        className="rounded-md p-1 text-red-500 hover:bg-red-50 disabled:opacity-50"
                                        aria-label={`Remove ${m.name}`}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    {modelsSaving && (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Saving…
                        </p>
                    )}
                    {modelsSaved && !modelsSaving && (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-green-600">
                            <Check className="h-3 w-3" />
                            Saved — users see these models after their next
                            profile reload.
                        </p>
                    )}
                </div>
            </AccountSection>
        </div>
    );
}
