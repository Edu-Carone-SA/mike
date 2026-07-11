import type {
  LlmMessage,
  NormalizedToolCall,
  NormalizedToolResult,
  OpenAIToolSchema,
  StreamChatParams,
  StreamChatResult,
} from "./types";
import { createRawLlmStreamRecorder, logRawLlmStream } from "./rawStreamLog";

const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/v1/chat/completions";
const MAX_OUTPUT_TOKENS = 16384;

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
  const key = override?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || "";
  if (!key) {
    throw new Error(
      "DeepSeek API key is not configured. Set DEEPSEEK_API_KEY or add a user DeepSeek key.",
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
 * Merge incremental tool_call deltas. DeepSeek streams tool calls in fragments:
 * the first chunk has { id, function: { name } }, subsequent chunks append to
 * function.arguments. We accumulate per-index.
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
    body.thinking = { type: "enabled" };
    body.reasoning_effort = "high";
  }

  const response = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(
      `DeepSeek request failed (${response.status}): ${text || response.statusText}`,
    );
    (err as { status?: number }).status = response.status;
    throw err;
  }

  return response;
}

export async function streamDeepSeek(
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
  const key = apiKey(apiKeys?.deepseek);
  const chatTools = toChatTools(tools);
  let fullText = "";
  const rawStreamRecorder = createRawLlmStreamRecorder({
    provider: "deepseek",
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
      if (!response.body) throw new Error("DeepSeek response had no body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const toolCallAccumulators = new Map<
        number,
        { id: string; name: string; args: string }
      >();
      let buffer = "";
      let sawReasoning = false;

      while (true) {
        throwIfAborted(params.abortSignal);
        const { done, value } = await reader.read();
        if (done) break;

        const decoded = decoder.decode(value, { stream: true });
        logRawLlmStream({
          provider: "deepseek",
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
            provider: "deepseek",
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

export async function completeDeepSeekText(params: {
  model: string;
  systemPrompt?: string;
  user: string;
  maxTokens?: number;
  apiKeys?: { deepseek?: string | null };
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
    apiKey: apiKey(params.apiKeys?.deepseek),
  });

  const json = (await response.json()) as ChatCompletionResponse;
  return json.choices?.[0]?.message?.content ?? "";
}

export type { NormalizedToolResult };
