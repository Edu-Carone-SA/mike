import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * QA FORM-02 (P0, build 5a7c58e — "perda de formatação na minuta Aziral e
 * Portinho"): when the model is asked to REVISE an attached minuta, it
 * sometimes fulfilled the request by calling generate_docx — rebuilding the
 * contract from extracted text. The generated package loses the source
 * template (843 KB → 19 KB: no media, no headers/footers, no tables).
 *
 * Contract under test (FORM-REG-02):
 *   1. generate_docx is BLOCKED when the turn has read source documents
 *      (turnReadState non-empty) — the tool result must be a terminal,
 *      readable error directing the model to edit_document.
 *   2. No artifact is published in that case (no doc_created, no upload).
 *   3. generate_docx remains ALLOWED when no source document was read
 *      (the legitimate "draft a brand-new document from scratch" path).
 *
 * Strategy: drive the REAL dispatcher with the storage layer stubbed and a
 * Postgrest-style DB stub (same harness as generateArtifactDedup.test.ts).
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
import { uploadFile } from "../src/lib/storage";

function docxCall(id: string, title: string) {
  return {
    id,
    type: "function" as const,
    function: {
      name: "generate_docx",
      arguments: JSON.stringify({
        title,
        sections: [
          {
            heading: "Cláusula 4.5 — Reajuste",
            content: "O reajuste anual será pelo IPCA.",
          },
          {
            heading: "Assinaturas",
            content: "By, Name, Title, Date",
            pageBreak: true,
          },
        ],
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

/** A turnReadState as the dispatcher receives it after read_document ran. */
function readStateWith(minuta: string) {
  return new Map([
    [
      "doc-0|v-1",
      {
        docLabel: "doc-0",
        filename: minuta,
        documentId: "doc-uuid-1",
        versionId: "v-1",
        storagePath: "documents/doc-uuid-1/v-1.docx",
      },
    ],
  ]) as any;
}

describe("FORM-REG-02: generate_docx blocked during revision of a source minuta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks generate_docx when a source document was read this turn and directs the model to edit_document", async () => {
    const write = vi.fn();
    const result = await runToolCalls(
      [docxCall("call-1", "Contrato Revisado")],
      new Map() as any,
      "user-1",
      makeDb() as any,
      write,
      undefined, // workflowStore
      undefined, // tabularStore
      undefined, // docIndex
      undefined, // turnEditState
      readStateWith("20260617-LicenciamentoAtlasgov-AZIRALEPORTINHOS.docx"), // turnReadState
    );

    expect(result.toolResults).toHaveLength(1);
    const blocked = parseToolResult(result.toolResults[0]);
    expect(blocked.error).toBe(true);
    expect(blocked.blocked_reason).toBe("revision_requires_edit_existing");
    expect(blocked.message).toContain("edit_document");
    expect(blocked.message).toContain(
      "20260617-LicenciamentoAtlasgov-AZIRALEPORTINHOS.docx",
    );
    // Terminal instruction — the model must not retry the same call.
    expect(blocked.message).toContain("NÃO tente chamar generate_docx");
  });

  it("publishes nothing when blocked: no doc_created result and no upload", async () => {
    const write = vi.fn();
    const result = await runToolCalls(
      [docxCall("call-1", "Contrato Revisado")],
      new Map() as any,
      "user-1",
      makeDb() as any,
      write,
      undefined,
      undefined,
      undefined,
      undefined,
      readStateWith("minuta.docx"),
    );

    expect(result.docsCreated).toHaveLength(0);
    expect(uploadFile).not.toHaveBeenCalled();
    // No SSE doc_created_start event either — the UI must not show a
    // generating placeholder for a blocked artifact.
    const startedEvents = write.mock.calls.filter(([s]) =>
      String(s).includes("doc_created_start"),
    );
    expect(startedEvents).toHaveLength(0);
  });

  it("still allows generate_docx when NO source document was read (brand-new document)", async () => {
    const write = vi.fn();
    const result = await runToolCalls(
      [docxCall("call-1", "Contrato de Prestação de Serviços")],
      new Map() as any,
      "user-1",
      makeDb() as any,
      write,
      undefined,
      undefined,
      undefined,
      undefined,
      new Map() as any, // empty turnReadState — nothing read
    );

    expect(result.toolResults).toHaveLength(1);
    const created = parseToolResult(result.toolResults[0]);
    expect(created.error).toBeUndefined();
    expect(created.blocked_reason).toBeUndefined();
    expect(result.docsCreated).toHaveLength(1);
  });
});
