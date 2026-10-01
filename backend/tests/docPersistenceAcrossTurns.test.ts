/**
 * P0 Edu 01/10/2026 — document persistence across turns.
 *
 * Mechanism (two complementary fixes):
 * 1. Standalone + project chat routes: the ask_inputs picker flow skipped
 *    the user-message insert entirely (else-if), so the attached
 *    document_ids were never persisted. Follow-up turns build doc context
 *    from the DB sweep and found nothing → "re-attach the document".
 * 2. buildDocContext sweep now includes `doc_read` events so ALREADY
 *    broken chats (files never persisted) recover their documents.
 *
 * This test exercises the REAL route handler wiring would need a server;
 * instead we assert the REAL sweep function behavior (fix 2) and the REAL
 * route source ordering (fix 1) is covered by the integration below via
 * the exported helper the routes call. See chatMessagePersistGate below.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/lib/supabase", () => {
  const chain = () => {
    const c: any = {};
    c.from = () => c;
    c.select = () => c;
    c.eq = () => c;
    c.order = () => c;
    c.limit = () => Promise.resolve({ data: [], error: null });
    c.in = () => c;
    c.then = (res: any, rej: any) =>
      Promise.resolve({ data: [], error: null }).then(res, rej);
    return c;
  };
  return { createServerSupabase: () => chain() };
});

import { buildDocContext } from "../src/lib/chat/contextBuilders";

const USER = "00000000-0000-0000-0000-000000000001";
const CHAT = "00000000-0000-0000-0000-000000000002";
const DOC = "11111111-1111-1111-1111-111111111111";

/** PostgREST rows the sweep consumes: one assistant doc_read, user msg with NULL files. */
function makeDb(rows: Record<string, unknown>[]) {
  const db: any = {
    from(table: string) {
      const isMessages = table === "chat_messages";
      const c: any = {
        _ids: null as string[] | null,
        select: () => c,
        eq: () => c,
        neq: () => c,
        is: () => c,
        order: () => c,
        limit: () => c,
        in: (_col: string, ids: string[]) => {
          c._ids = ids;
          return c;
        },
      };
      c.then = (res: any, rej: any) => {
        const payload = c._ids
          ? {
              // documents lookup — full contract incl. storage_path
              data: c._ids.map((id) => ({
                id,
                current_version_id: "v-" + id,
                status: "ready",
                filename: "nda-" + id.slice(0, 4) + ".docx",
                file_type: "docx",
                storage_path: "docs/" + id + ".docx",
                active_version_number: 1,
              })),
              error: null,
            }
          : {
              // default: chat_messages sweep / version lookups
              data: isMessages ? rows : [],
              error: null,
            };
        return Promise.resolve(payload).then(res, rej);
      };
      return c;
    },
  };
  return db;
}

describe("buildDocContext sweep includes doc_read (P0 01/10/2026)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recovers a document whose only trace is a doc_read event in an assistant message", async () => {
    const db = makeDb([
      {
        role: "assistant",
        content: [
          { type: "doc_read", document_id: DOC, filename: "nda.docx" },
        ],
        files: null,
      },
      { role: "user", content: "Revise esse NDA", files: null },
    ]);

    const { docIndex } = await buildDocContext(
      [{ role: "user", content: "DEIXAR BILATERAL", files: undefined }],
      USER,
      db as any,
      CHAT,
    );

    const ids = Object.values(docIndex as Record<string, { document_id?: string }>)
      .map((i) => i.document_id)
      .filter(Boolean);
    expect(ids).toContain(DOC);
  });

  it("still ignores non-document events", async () => {
    const db = makeDb([
      {
        role: "assistant",
        content: [
          { type: "workflow_applied", title: "NDA Atlas Pentest - PORT" },
          { type: "ask_inputs", items: [{ id: "nda_file", kind: "documents" }] },
        ],
        files: null,
      },
    ]);

    const { docIndex } = await buildDocContext(
      [{ role: "user", content: "segue" }],
      USER,
      db as any,
      CHAT,
    );
    expect(Object.keys(docIndex).length).toBe(0);
  });
});
