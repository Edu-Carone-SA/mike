import type {
  LlmMessage,
  NormalizedToolCall,
  NormalizedToolResult,
  OpenAIToolSchema,
  StreamChatParams,
  StreamChatResult,
} from "./types";
import { createRawLlmStreamRecorder, logRawLlmStream } from "./rawStreamLog";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_OUTPUT_TOKENS = 65536;

type ChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

// Chat Completions messages — the `tool` role and `tool_calls` field are
// standard OpenAI-compatible function calling extensions.
type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

type ChatCompletionTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

type ChatStreamDelta = {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }[];
};

type ChatStreamChoice = {
  delta?: ChatStreamDelta;
  finish_reason?: string | null;
};

type ChatStreamEvent = {
  choices?: ChatStreamChoice[];
};

type ChatCompletionResponse = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: ChatToolCall[];
    };
  }[];
};

function apiKey(override?: string | null): string {
  const key = override?.trim() || process.env.OPENROUTER_API_KEY?.trim() || "";
  if (!key) {
    throw new Error(
      "OpenRouter API key is not configured. Set OPENROUTER_API_KEY or add a user OpenRouter key.",
    );
  }
  return key;
}

function toChatMessages(
  systemPrompt: string,
  messages: LlmMessage[],
): ChatMessage[] {
  const result: ChatMessage[] = [
    { role: "system", content: systemPrompt },
  ];
  for (const msg of messages) {
    result.push({ role: msg.role, content: msg.content });
  }
  return result;
}

function toChatTools(tools: OpenAIToolSchema[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));
}

function extractSseJson(buffer: string): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  const chunks = buffer.split(/\n\n/);
  const rest = chunks.pop() ?? "";

  for (const chunk of chunks) {
    const dataLines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    for (const data of dataLines) {
      if (!data || data === "[DONE]") continue;
      try {
        events.push(JSON.parse(data));
      } catch {
        // Incomplete events stay buffered until the next read.
      }
    }
  }

  return { events, rest };
}

function abortError(): Error {
  const err = new Error("Stream aborted.");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

/**
 * Merge incremental tool_call deltas. OpenRouter streams tool calls in
 * fragments: the first chunk has { id, function: { name } }, subsequent
 * chunks append to function.arguments. We accumulate per-index.
 */
function accumulateToolCallDeltas(
  accumulators: Map<number, { id: string; name: string; args: string }>,
  deltas: NonNullable<ChatStreamDelta["tool_calls"]>,
): NormalizedToolCall[] {
  const newCalls: NormalizedToolCall[] = [];
  for (const delta of deltas) {
    const existing = accumulators.get(delta.index);
    const id = delta.id ?? existing?.id ?? `call_${delta.index}`;
    const name = delta.function?.name ?? existing?.name ?? "";
    const args = (existing?.args ?? "") + (delta.function?.arguments ?? "");

    accumulators.set(delta.index, { id, name, args });

    // Notify when a call first gets an id + name.
    if (name && !existing) {
      newCalls.push({ id, name, input: {} });
    }
  }
  return newCalls;
}

function parseAccumulatedToolCalls(
  accumulators: Map<number, { id: string; name: string; args: string }>,
): NormalizedToolCall[] {
  const calls: NormalizedToolCall[] = [];
  for (const { id, name, args } of accumulators.values()) {
    let input: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(args || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>;
      }
    } catch {
      input = {};
    }
    calls.push({ id, name, input });
  }
  return calls;
}

async function createChatCompletion(params: {
  model: string;
  messages: ChatMessage[];
  tools?: ChatCompletionTool[];
  stream?: boolean;
  maxTokens?: number;
  apiKey: string;
  signal?: AbortSignal;
  enableThinking?: boolean;
}): Promise<Response> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    stream: params.stream,
    max_tokens: params.maxTokens ?? MAX_OUTPUT_TOKENS,
  };

  if (params.tools?.length) {
    body.tools = params.tools;
  }

  if (params.enableThinking) {
    body.reasoning = { effort: "medium" };
  }

  // Retry with exponential backoff on transient upstream failures (429 rate
  // limit, 5xx, 408). OpenRouter routes models across providers (e.g.
  // deepseek/deepseek-chat via Deepinfra) — a 429 often means the specific
  // upstream engine is overloaded, and a short retry usually succeeds.
  const MAX_ATTEMPTS = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://mike.agov.app",
          "X-Title": "Mike Atlas",
        },
        body: JSON.stringify(body),
        signal: params.signal,
      });

      if (response.ok) return response;

      const text = await response.text().catch(() => "");
      const err = new Error(
        `OpenRouter request failed (${response.status}): ${text || response.statusText}`,
      );
      (err as { status?: number }).status = response.status;
      lastError = err;

      const retryable =
        response.status === 429 ||
        response.status === 408 ||
        response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) throw err;

      // OpenRouter sends Retry-After when available; fall back to
      // exponential backoff (2s, 4s).
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : NaN;
      const delayMs =
        Number.isFinite(retryAfterMs) && retryAfterMs > 0
          ? Math.min(retryAfterMs, 30_000)
          : 2_000 * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (err) {
      // Network-level errors (ECONNRESET, ETIMEDOUT, abort) — rethrow aborts
      // immediately, retry transient network errors once.
      if (err instanceof Error && err.name === "AbortError") throw err;
      if (attempt === MAX_ATTEMPTS || !lastError) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      lastError = err as Error;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }

  throw lastError ?? new Error("OpenRouter request failed after retries");
}

export async function streamOpenRouter(
  params: StreamChatParams,
): Promise<StreamChatResult> {
  const {
    model,
    systemPrompt,
    tools = [],
    callbacks = {},
    runTools,
    apiKeys,
    enableThinking,
  } = params;
  const maxIter = params.maxIterations ?? 10;
  const key = apiKey(apiKeys?.openrouter);
  const chatTools = toChatTools(tools);
  let fullText = "";
  const rawStreamRecorder = createRawLlmStreamRecorder({
    provider: "openrouter",
    model,
  });

  try {
    let messages = toChatMessages(systemPrompt, params.messages);

    for (let iter = 0; iter < maxIter; iter++) {
      throwIfAborted(params.abortSignal);
      const response = await createChatCompletion({
        model,
        messages,
        tools: chatTools.length ? chatTools : undefined,
        stream: true,
        apiKey: key,
        signal: params.abortSignal,
        enableThinking: !!enableThinking,
      });
      if (!response.body) throw new Error("OpenRouter response had no body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const toolCallAccumulators = new Map<
        number,
        { id: string; name: string; args: string }
      >();
      let buffer = "";
      let sawReasoning = false;
      let finishReason: string | null = null;

      while (true) {
        throwIfAborted(params.abortSignal);
        const { done, value } = await reader.read();
        if (done) break;

        const decoded = decoder.decode(value, { stream: true });
        logRawLlmStream({
          provider: "openrouter",
          model,
          iteration: iter,
          label: "sse_chunk",
          payload: decoded,
        });
        rawStreamRecorder?.record({
          iteration: iter,
          label: "sse_chunk",
          payload: decoded,
        });
        buffer += decoded;
        const extracted = extractSseJson(buffer);
        buffer = extracted.rest;

        for (const event of extracted.events as ChatStreamEvent[]) {
          logRawLlmStream({
            provider: "openrouter",
            model,
            iteration: iter,
            label: "sse_event",
            payload: event,
          });
          rawStreamRecorder?.record({
            iteration: iter,
            label: "sse_event",
            payload: event,
          });

          const choice = event.choices?.[0];
          if (!choice?.delta) continue;

          // Capture finish_reason for auto-continue detection
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          // Reasoning content (thinking mode)
          if (
            typeof choice.delta.reasoning_content === "string" &&
            choice.delta.reasoning_content
          ) {
            sawReasoning = true;
            callbacks.onReasoningDelta?.(choice.delta.reasoning_content);
          }

          // Content delta
          if (typeof choice.delta.content === "string" && choice.delta.content) {
            fullText += choice.delta.content;
            callbacks.onContentDelta?.(choice.delta.content);
          }

          // Tool call deltas
          if (choice.delta.tool_calls?.length) {
            const newCalls = accumulateToolCallDeltas(
              toolCallAccumulators,
              choice.delta.tool_calls,
            );
            for (const call of newCalls) {
              callbacks.onToolCallStart?.(call);
            }
          }
        }
      }

      if (sawReasoning) callbacks.onReasoningBlockEnd?.();
      throwIfAborted(params.abortSignal);

      const toolCalls = parseAccumulatedToolCalls(toolCallAccumulators);

      if (!toolCalls.length || !runTools) {
        // Auto-continue: if the response was cut off by max_tokens,
        // append the partial assistant message and ask the model to
        // continue. This prevents truncated/incomplete sentences.
        if (finishReason === "length" && fullText) {
          messages = [
            ...messages,
            { role: "assistant" as const, content: fullText },
            { role: "user" as const, content: "Continue from where you left off. Do not repeat any text you already wrote — just complete the remaining content." },
          ];
          // Reset for next iteration — don't duplicate the text we
          // already streamed. We keep fullText as-is since new deltas
          // will append to it.
          continue;
        }
        break;
      }

      // Append assistant message with tool calls, then tool results
      messages = [
        ...messages,
        {
          role: "assistant" as const,
          content: null,
          tool_calls: toolCalls.map((c) => ({
            id: c.id,
            type: "function" as const,
            function: {
              name: c.name,
              arguments: JSON.stringify(c.input),
            },
          })),
        },
      ];

      const results: NormalizedToolResult[] = await runTools(toolCalls);
      throwIfAborted(params.abortSignal);

      for (const result of results) {
        messages.push({
          role: "tool",
          content: result.content,
          tool_call_id: result.tool_use_id,
        });
      }
    }

    await rawStreamRecorder?.flush("completed");
    return { fullText };
  } catch (error) {
    await rawStreamRecorder?.flush("error", error);
    throw error;
  }
}

export async function completeOpenRouterText(params: {
  model: string;
  systemPrompt?: string;
  user: string;
  maxTokens?: number;
  apiKeys?: { openrouter?: string | null };
}): Promise<string> {
  const messages: ChatMessage[] = [];
  if (params.systemPrompt) {
    messages.push({ role: "system", content: params.systemPrompt });
  }
  messages.push({ role: "user", content: params.user });

  const response = await createChatCompletion({
    model: params.model,
    messages,
    maxTokens: params.maxTokens ?? 512,
    apiKey: apiKey(params.apiKeys?.openrouter),
  });

  const json = (await response.json()) as ChatCompletionResponse;
  return json.choices?.[0]?.message?.content ?? "";
}

export type { NormalizedToolResult };