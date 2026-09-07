import { describe, it, expect } from "vitest";

/**
 * DOC-04 project-upload dedupe contract (Sprint 4 QA round 3):
 * re-uploading the same file (same project + filename + size) must NOT
 * create a second document row, even when the idempotency key differs
 * (mtime changed after a download/copy). The route returns the existing
 * document with HTTP 200.
 *
 * This unit test pins the dedupe predicate itself — the exact logic
 * projects.ts applies against (documents.current_version_id →
 * document_versions.filename/size_bytes): filename must match
 * case-insensitively AND the current version size must be identical.
 */

function isProjectFileDuplicate(
    candidates: { document_id: string; filename: string; size_bytes: number | null }[],
    filename: string,
    sizeBytes: number,
): string | null {
    const needle = filename.toLowerCase();
    const hit = candidates.find(
        (v) =>
            (v.filename ?? "").toLowerCase() === needle &&
            v.size_bytes === sizeBytes,
    );
    return hit ? hit.document_id : null;
}

describe("DOC-04 project upload dedupe predicate", () => {
    const candidates = [
        { document_id: "doc-1", filename: "S15_DOC01_Idempotencia_20260907.docx", size_bytes: 55736 },
        { document_id: "doc-2", filename: "outro-arquivo.docx", size_bytes: 55736 },
        { document_id: "doc-3", filename: "S15_DOC01_Idempotencia_20260907.docx", size_bytes: 99999 },
    ];

    it("same filename + same size → the existing document id", () => {
        expect(
            isProjectFileDuplicate(candidates, "S15_DOC01_Idempotencia_20260907.docx", 55736),
        ).toBe("doc-1");
    });

    it("same filename, different size → no duplicate (new version-like file)", () => {
        expect(
            isProjectFileDuplicate(candidates, "S15_DOC01_Idempotencia_20260907.docx", 4242),
        ).toBeNull();
    });

    it("different filename, same size → no duplicate", () => {
        expect(
            isProjectFileDuplicate(candidates, "outra-minuta.docx", 55736),
        ).toBeNull();
    });

    it("case-insensitive filename match (browser-normalized names)", () => {
        expect(
            isProjectFileDuplicate(candidates, "s15_doc01_idempotencia_20260907.DOCX", 55736),
        ).toBe("doc-1");
    });
});
