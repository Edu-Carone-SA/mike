import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * QA JOB-02 (NO-GO report, build e7d15fb): in one exhausted tool loop the
 * model regenerated the same artifact ("Documento Gerado.xlsx") FIVE
 * times — five homonymous documents in the project tree. runToolCalls
 * now dedups generate_* calls by normalized title within a turn: the
 * second call reuses the artifact and returns an explicit "already
 * generated" message to the model.
 *
 * Strategy: drive the REAL dispatcher with the storage layer stubbed
 * (uploadFile no-ops) and a Postgrest-style DB stub, so generateExcel
 * runs its real code path end-to-end and we assert on the tool results
 * the model would see.
 */

process.env.DOWNLOAD_SIGNING_SECRET = "t".repeat(64);

vi.mock("../src/lib/storage", () => ({
  uploadFile: vi.fn(async () => undefined),
  downloadFile: vi.fn(async () => new ArrayBuffer(8)),
  deleteFile: vi.fn(async () => undefined),
  storageKey: (...parts: string[]) => parts.join("/"),
  generatedDocKey: (...parts: string[]) => parts.join("/"),
  convertedPdfKey: (...parts: string[]) => parts.join("/"),
  buildContentDisposition: () => "attachment",
  getSignedUrl: vi.fn(async () => "https://example.com/signed"),
}));

import { runToolCalls } from "../src/lib/chat/tools/toolDispatcher";

function excelCall(id: string, title: string) {
  return {
    id,
    type: "function" as const,
    function: {
      name: "generate_excel",
      arguments: JSON.stringify({
        title,
        sheets: [{ name: "Sheet1", columns: ["A"], rows: [["1"]] }],
      }),
    },
  };
}

/**
 * Supabase Postgrest builders are thenable AND chainable
 * (insert().select().single(), update().eq()). This builder resolves any
 * chain to { data, error } so the real documentOps code path runs.
 */
function makeDb() {
  let seq = 0;
  const result = () => ({ data: { id: `row-${++seq}` }, error: null });
  const chain = (value: unknown): any => {
    const target: Record<string, unknown> = {
      select: () => chain(value),
      single: () => chain(value),
      eq: () => chain(value),
      then: (res: any, rej: any) => Promise.resolve(value).then(res, rej),
    };
    return target as any;
  };
  return {
    from: () => ({
      insert: () => chain(result()),
      update: () => chain({ data: null, error: null }),
      select: () => chain(result()),
    }),
  } as any;
}

function parseToolResult(r: unknown): Record<string, unknown> {
  const c = (r as { content?: string }).content;
  try {
    return JSON.parse(c ?? "{}");
  } catch {
    return {};
  }
}

describe("turn-scoped generate_* dedup (QA JOB-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a second generate_excel with the same title reuses the artifact and does not create a duplicate document", async () => {
    const write = vi.fn();
    const result = await runToolCalls(
      [excelCall("call-1", "Documento Gerado"), excelCall("call-2", "Documento Gerado")],
      new Map() as any,
      "user-1",
      makeDb() as any,
      write,
    );

    expect(result.toolResults).toHaveLength(2);
    const second = parseToolResult(result.toolResults[1]);
    expect(second.message).toContain("already generated in this turn");
    // Only ONE doc_created event — the duplicate did not publish.
    const created = result.docsCreated.filter(
      (d) => d.filename === "Documento Gerado.xlsx",
    );
    expect(created).toHaveLength(1);
  });

  it("titles differing only by case/whitespace are the same artifact", async () => {
    const write = vi.fn();
    const result = await runToolCalls(
      [excelCall("call-1", "Documento Gerado"), excelCall("call-2", "  documento  GERADO ")],
      new Map() as any,
      "user-1",
      makeDb() as any,
      write,
    );
    const second = parseToolResult(result.toolResults[1]);
    expect(second.message).toContain("already generated in this turn");
  });

  it("a different title still generates a new document", async () => {
    const write = vi.fn();
    const result = await runToolCalls(
      [excelCall("call-1", "Documento Gerado"), excelCall("call-2", "Matriz Consolidada")],
      new Map() as any,
      "user-1",
      makeDb() as any,
      write,
    );
    const second = parseToolResult(result.toolResults[1]);
    expect(second.message).not.toContain("already generated in this turn");
    expect(result.docsCreated).toHaveLength(2);
  });
});
