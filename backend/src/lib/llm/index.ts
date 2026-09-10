import { streamOpenRouter, completeOpenRouterText } from "./openrouter";
import type { StreamChatParams, StreamChatResult, UserApiKeys } from "./types";

export * from "./types";
export * from "./models";

// MIKE-06: OpenRouter-only. Every model routes through the OpenRouter
// adapter (see models.ts — providerForModel always returns "openrouter").
// The legacy direct adapters (claude/gemini/openai/deepseek) were removed
// from the dispatch path.
export async function streamChatWithTools(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    return streamOpenRouter(params);
}

export async function completeText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: UserApiKeys;
}): Promise<string> {
    return completeOpenRouterText(params);
}
