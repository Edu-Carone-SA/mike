import { describe, it, expect } from "vitest";
import { DsmlContentFilter } from "../src/lib/llm/openrouter";

// The leaked markup uses U+FF5C FULLWIDTH VERTICAL LINE: <｜DSML｜tool_calls>
const MARKER = "\uFF5CDSML\uFF5C";

describe("DsmlContentFilter", () => {
  it("passes clean text through untouched", () => {
    const f = new DsmlContentFilter();
    expect(f.push("Hello ")).toBe("Hello ");
    expect(f.push("world")).toBe("world");
    expect(f.flush()).toBe("");
  });

  it("suppresses leaked DSML markup", () => {
    const f = new DsmlContentFilter();
    const out =
      f.push("Answer before tool call. ") +
      f.push(`<${MARKER}`) +
      f.push(`tool_calls> <${MARKER}invoke name="generate_excel"> {...json...}`);
    expect(out).toBe("Answer before tool call. ");
    expect(f.push(" more leaked")).toBe("");
    expect(f.flush()).toBe("");
  });

  it("handles marker split mid-way across deltas", () => {
    const f = new DsmlContentFilter();
    expect(f.push("abc")).toBe("abc");
    // partial marker tail "｜DS" held back
    expect(f.push(`\uFF5CDS`)).toBe("");
    expect(f.push(`ML${MARKER}tool_calls> leaked`)).toBe("");
    expect(f.flush()).toBe("");
  });

  it("releases false-positive tail on flush", () => {
    const f = new DsmlContentFilter();
    // "｜D" looks like a marker prefix, so push holds it back and emits the
    // clean head; flush then releases the held tail (it never became a marker).
    expect(f.push(`final answer\uFF5CD`)).toBe("final answer");
    expect(f.flush()).toBe(`\uFF5CD`);
  });
});
