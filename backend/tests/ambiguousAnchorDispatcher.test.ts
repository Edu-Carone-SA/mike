/**
 * P1 QA 15/09/2026 (reaceite #100, PARTIAL branch): the literal
 * `Ambiguous match` anchor failure could not be forced through the browser
 * (the model correctly refuses to choose between occurrences). This
 * harness injects the tool-layer failure and drives the REAL dispatcher,
 * asserting the non_retryable contract the QA asked to observe:
 * no silent retry instruction, anchor quoted, unique excerpt requested,
 * no version published.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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

const runEditDocument = vi.fn();

vi.mock("../src/lib/chat/tools/documentOps", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/lib/chat/tools/documentOps")>();
  return { ...original, runEditDocument: (...a: unknown[]) => runEditDocument(...a) };
});

import { runToolCalls } from "../src/lib/chat/tools/toolDispatcher";
import { uploadFile } from "../src/lib/storage";

function editCall(id: string, find: string) {
  return {
    id,
    type: "function" as const,
    function: {
      name: "edit_document",
      arguments: JSON.stringify({
        doc_id: "doc-0",
        edits: [{ find, replace: "TEXTO-NOVO-PR100", reason: "QA harness" }],
      }),
    },
  };
}

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

const DOC_STORE = new Map([
  ["doc-0", { storage_path: "documents/d/v1.docx", file_type: "docx", filename: "QA.docx" }],
]);
const DOC_INDEX = {
  "doc-0": { document_id: "doc-uuid-1", filename: "QA.docx", version_id: "v-1", version_number: 1 },
};

describe("ambiguous anchor through the real dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("literal 'Ambiguous match' result is non_retryable with anchor guidance", async () => {
    runEditDocument.mockResolvedValue({
      ok: false,
      error:
        'Ambiguous match: "pagamento" appears 3 times in the document — provide more context to disambiguate.',
    });
    const write = vi.fn();
    const result = await runToolCalls(
      [editCall("call-1", "pagamento")],
      DOC_STORE as any,
      "user-1",
      makeDb() as any,
      write,
      undefined,
      undefined,
      DOC_INDEX as any,
      undefined,
    );

    expect(result.toolResults).toHaveLength(1);
    const payload = parseToolResult(result.toolResults[0]);
    expect(payload.ok).toBe(false);
    expect(payload.non_retryable).toBe(true);
    expect(String(payload.next_required_action)).toContain("Do NOT retry");
    expect(String(payload.next_required_action)).toContain("unique excerpt");
    // nothing published: no edited-doc payload, no upload. The UI DOES
    // get the start→failed pair (the visible "Edit failed" block the QA
    // saw in the browser) — that is the correct surfacing, not a publish.
    expect(result.docsEdited).toHaveLength(0);
    expect(uploadFile).not.toHaveBeenCalled();
    const sse = write.mock.calls.map(([s]) => String(s));
    expect(sse.filter((s) => s.includes("doc_edited_start"))).toHaveLength(1);
    const failed = sse.find(
      (s) => s.includes("type: \"doc_edited\"") || s.includes('\"doc_edited\"'),
    );
    expect(failed).toBeTruthy();
    expect(String(failed)).toContain("error");
  });

  it("a transient storage error stays retryable (no non_retryable flag)", async () => {
    runEditDocument.mockResolvedValue({
      ok: false,
      error: "storage timeout while uploading the candidate version",
    });
    const result = await runToolCalls(
      [editCall("call-1", "pagamento")],
      DOC_STORE as any,
      "user-1",
      makeDb() as any,
      vi.fn(),
      undefined,
      undefined,
      DOC_INDEX as any,
      undefined,
    );
    const payload = parseToolResult(result.toolResults[0]);
    expect(payload.non_retryable).toBeUndefined();
  });

  it("integrity block still routes to its own terminal instruction", async () => {
    runEditDocument.mockResolvedValue({
      ok: false,
      error:
        "Edit blocked by draft-integrity check — clause 7 removed while descendants remain",
    });
    const result = await runToolCalls(
      [editCall("call-1", "7. RESCISÃO")],
      DOC_STORE as any,
      "user-1",
      makeDb() as any,
      vi.fn(),
      undefined,
      undefined,
      DOC_INDEX as any,
      undefined,
    );
    const payload = parseToolResult(result.toolResults[0]);
    expect(payload.non_retryable).toBe(true);
    expect(String(payload.next_required_action)).toContain(
      "draft-integrity",
    );
  });
});
