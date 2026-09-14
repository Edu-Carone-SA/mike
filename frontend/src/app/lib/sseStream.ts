/**
 * P0-1 (QA 14/09/2026): the SSE consumption contract shared by the chat
 * hooks, extracted so it is unit-testable. The hook previously inlined
 * this parsing; the logic here is the SAME (buffer + "\n" split + keep
 * the trailing partial line + data: prefix + [DONE] sentinel).
 *
 * Guarantees (each covered by tests/sseStreamConsumer.test.ts):
 *   - a JSON event split across network chunks is reassembled (the
 *     "S/T/A/T/U/S" single-character repro shape);
 *   - non-data lines (keep-alives) and blank lines are ignored;
 *   - [DONE] ends the loop exactly once;
 *   - stream EOF without [DONE] still ends the loop — never hangs.
 */

export type SseEvent = Record<string, unknown> & { type: string };

/**
 * Parses a text buffer containing zero or more complete SSE lines plus an
 * optional trailing partial line. Returns the parsed data events, the
 * remaining partial line to carry into the next chunk, and whether the
 * [DONE] sentinel was present.
 */
export function parseSseBuffer(buffer: string): {
    events: SseEvent[];
    rest: string;
    done: boolean;
} {
    const lines = buffer.split("\n");
    const rest = lines.pop() ?? "";
    const events: SseEvent[] = [];
    let done = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === "[DONE]") {
            done = true;
            continue;
        }
        try {
            const parsed = JSON.parse(dataStr);
            if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
                events.push(parsed as SseEvent);
            }
        } catch {
            // Malformed line mid-stream: skip, never abort the whole stream.
        }
    }
    return { events, rest, done };
}

/**
 * Consumes a byte-chunk reader (the same shape `response.body.getReader()`
 * returns) with a TextDecoder in streaming mode, applying the callback to
 * each event. Mirrors the hook loop: read → decode({stream:true}) →
 * parse → accumulate. `onDone` fires exactly once when [DONE] is seen or
 * the reader reports EOF.
 */
export async function consumeSseStream(
    reader: { read(): Promise<{ done: boolean; value?: Uint8Array }> },
    onEvent?: (event: SseEvent) => void,
): Promise<{
    text: string;
    sawDone: boolean;
    doneCount: number;
    loopEnded: boolean;
    events: SseEvent[];
}> {
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let sawDone = false;
    let doneCount = 0;
    const events: SseEvent[] = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseBuffer(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) {
            events.push(event);
            if (event.type === "content_delta" && typeof event.text === "string") {
                text += event.text;
            }
            onEvent?.(event);
        }
        if (parsed.done && !sawDone) {
            sawDone = true;
            doneCount = 1;
        }
    }
    // Final decode flush (multi-byte UTF-8 tail)
    buffer += decoder.decode();
    if (buffer) {
        const parsed = parseSseBuffer(buffer + "\n");
        for (const event of parsed.events) {
            events.push(event);
            if (event.type === "content_delta" && typeof event.text === "string") {
                text += event.text;
            }
            onEvent?.(event);
        }
    }

    return { text, sawDone, doneCount, loopEnded: true, events };
}
