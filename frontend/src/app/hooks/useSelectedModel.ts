"use client";

import { useCallback, useEffect, useState } from "react";
import {
    ALLOWED_MODEL_IDS,
    DEFAULT_MODEL_ID,
    allowedModelIds,
} from "../components/assistant/ModelToggle";

const STORAGE_KEY = "mike.selectedModel";

function readStored(allowed: Set<string>): string {
    if (typeof window === "undefined") return DEFAULT_MODEL_ID;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && allowed.has(raw)) return raw;
    return DEFAULT_MODEL_ID;
}

/**
 * MIKE-07: the allowed set follows the admin-configured platform list when
 * one exists (falling back to the built-in catalog). A stored selection
 * that is no longer allowed resets to the default instead of sending an
 * invalid model to the backend.
 */
export function useSelectedModel(
    availableModels?: Array<{ id: string; name?: string }> | null,
): [string, (id: string) => void] {
    const [model, setModelState] = useState<string>(DEFAULT_MODEL_ID);

    useEffect(() => {
        setModelState(readStored(allowedModelIds(availableModels)));
    }, [availableModels]);

    const setModel = useCallback(
        (id: string) => {
            const allowed = allowedModelIds(availableModels);
            const next = allowed.has(id)
                ? id
                : // First allowed model when the default is not in the admin list.
                  ([...allowed][0] ?? DEFAULT_MODEL_ID);
            setModelState(next);
            if (typeof window !== "undefined") {
                window.localStorage.setItem(STORAGE_KEY, next);
            }
        },
        [availableModels],
    );

    return [model, setModel];
}
