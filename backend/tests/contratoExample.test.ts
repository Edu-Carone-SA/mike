import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const DOCX_PATH = "/tmp/contrato_teste.docx";
const hasDoc = fs.existsSync(DOCX_PATH);
const maybe = hasDoc ? describe : describe.skip;

maybe("Contrato real com comentarios (exemplo do Edu)", () => {
  it("extractDocxWithComments extrai os 5 baloes", async () => {
    const { extractDocxWithComments } = await import("../src/lib/docxComments");
    const buf = fs.readFileSync(DOCX_PATH);
    const { text, commentCount } = await extractDocxWithComments(buf);
    expect(commentCount).toBe(5);
    expect(text).toContain("Ingrid Freitas");
    expect(text).toContain("Kenneda MOREIRA Andrade");
    expect(text).toContain("portal EVA");
  });
});
