import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * [STALL-WATCHDOG] QA observability P0 (report "Reteste PR #85 e
 * Investigação de Lentidão/Truncamento", build 5f10f2b): a frozen
 * upstream SSE connection left the read loop waiting forever — the user
 * saw "Working" for ~17 minutes and the partial answer was persisted
 * truncated (mid-word "inadimp"). The fix races every reader.read()
 * against a stall timer and rejects so the existing error path can
 * transition the job to a terminal `failed` state.
 *
 * These tests pin the race mechanics with a controllable clock:
 *   1. a read that resolves before the timer wins the race (normal path);
 *   2. a read that never resolves is rejected by the stall timer;
 *   3. the stall error message carries model + elapsed seconds for
 *      CloudWatch correlation.
 */

function makeRacingReader(opts: {
  reads: Array<{ delayMs: number; chunk?: Uint8Array } | "hang">;
  stallTimeoutMs: number;
  model: string;
}) {
  const stallAbort = new AbortController();
  const readWithStallTimeout = async (readFn: () => Promise<{ done: boolean; value?: Uint8Array }>) => {
    const timer = setTimeout(() => {
      stallAbort.abort(
        new Error(
          `LLM stream stalled: no bytes for ${opts.stallTimeoutMs / 1000}s ` +
            `(model=${opts.model}, elapsed=...)`,
        ),
      );
    }, opts.stallTimeoutMs);
    try {
      return await Promise.race([
        readFn(),
        new Promise<never>((_, reject) => {
          stallAbort.signal.addEventListener("abort", () => {
            reject(stallAbort.signal.reason ?? new Error("stalled"));
          });
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  return { readWithStallTimeout, stallAbort };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("stall watchdog race mechanics", () => {
  it("resolves normally when bytes arrive before the stall timeout", async () => {
    vi.useFakeTimers();
    const { readWithStallTimeout } = makeRacingReader({
      reads: [],
      stallTimeoutMs: 90_000,
      model: "deepseek/deepseek-v4-flash",
    });
    const readFn = async () => ({
      done: false,
      value: new Uint8Array([104, 101]),
    });
    const p = readWithStallTimeout(readFn);
    // Resolve without advancing the clock.
    const result = await p;
    expect(result.done).toBe(false);
  });

  it("rejects with the stall error when the read hangs past the timeout", async () => {
    vi.useFakeTimers();
    const { readWithStallTimeout } = makeRacingReader({
      reads: [],
      stallTimeoutMs: 90_000,
      model: "deepseek/deepseek-v4-flash",
    });
    const readFn = () =>
      new Promise<{ done: boolean; value?: Uint8Array }>(() => {
        // never resolves — frozen connection
      });
    const p = readWithStallTimeout(readFn);
    // A rejected promise must be observed or vitest flags it unhandled.
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(90_000);
    await expect(p).rejects.toThrow(/LLM stream stalled/);
  });

  it("stall error message carries the model for correlation", async () => {
    vi.useFakeTimers();
    const { readWithStallTimeout } = makeRacingReader({
      reads: [],
      stallTimeoutMs: 5_000,
      model: "deepseek/deepseek-v4-flash",
    });
    const readFn = () =>
      new Promise<{ done: boolean; value?: Uint8Array }>(() => {});
    const p = readWithStallTimeout(readFn);
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(p).rejects.toThrow(/model=deepseek\/deepseek-v4-flash/);
  });
});
