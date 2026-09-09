import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  applyTrackedEdits,
  extractDocxBodyText,
} from "../src/lib/docxTrackedChanges";

/** Minimal DOCX with a financial value inside a table cell — the INT-01
 * shape reported by QA (R$ 180.000,00 → R$ 190.000,00 in a minuta). */
async function makeMinutaDocx(): Promise<Buffer> {
  const zip = new JSZip();
  const body = [
    `<w:p><w:r><w:t xml:space="preserve">ANEXO II — CONDIÇÕES COMERCIAIS</w:t></w:r></w:p>`,
    `<w:p><w:r><w:t xml:space="preserve">Cláusula 3 (Remuneração): valor anual aprovado conforme tabela abaixo.</w:t></w:r></w:p>`,
    `<w:tbl><w:tr><w:tc><w:p><w:r><w:t xml:space="preserve">Valor total: R$ 180.000,00</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    `<w:p><w:r><w:t xml:space="preserve">ASSINATURAS: ____</w:t></w:r></w:p>`,
  ].join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** The material-gate contract from publishTrackedEdits (documentOps.ts):
 * a candidate may only be published when, for every requested
 * substitution, (1) the replace text is present in the accepted view of
 * the candidate and (2) a free-standing occurrence of the find text was
 * consumed — occurrences nested inside a landed replace don't count
 * (FORM-04: insertion edits keep find inside replace). */
function materialGatePasses(
  beforeText: string,
  candidateText: string,
  edits: { find: string; replace: string }[],
): { ok: boolean; reason?: string } {
  const sq = (s: string) => s.replace(/\s+/g, " ");
  const cand = sq(candidateText);
  const before = sq(beforeText);
  const count = (h: string, n: string) => (n ? h.split(n).length - 1 : 0);
  for (const e of edits) {
    const find = sq(e.find);
    const replace = sq(e.replace);
    if (!replace || !find || find === replace) continue;
    if (!cand.includes(replace)) {
      return {
        ok: false,
        reason: `candidate lacks replacement "${replace.slice(0, 60)}"`,
      };
    }
    const isInsertion = replace.startsWith(find) && replace !== find;
    if (isInsertion) {
      if (count(cand, replace) <= count(before, replace)) {
        return {
          ok: false,
          reason: `candidate lacks insertion "${replace.slice(0, 60)}" (replace never landed)`,
        };
      }
    } else if (count(before, find) <= count(cand, find)) {
      return {
        ok: false,
        reason: `candidate still contains find "${find.slice(0, 60)}" (occurrence not consumed)`,
      };
    }
  }
  return { ok: true };
}

describe("INT-01 material composition of tracked edits", () => {
  it("correct substitution in a table cell composes the target value", async () => {
    const before = await makeMinutaDocx();
    const edits = [
      {
        find: "180.000,00",
        replace: "190.000,00",
        context_before: "Valor total: R$ ",
        context_after: "",
        reason: "adjust contract value",
      },
    ];
    const { bytes } = await applyTrackedEdits(before, edits, {
      author: "QA",
    });
    const beforeText = await extractDocxBodyText(before);
    const accepted = await extractDocxBodyText(bytes);
    expect(accepted).toContain("190.000,00");
    expect(accepted).not.toContain("180.000,00");
    expect(materialGatePasses(beforeText, accepted, edits).ok).toBe(true);
  });

  it("mis-anchored replace producing a doubled value fails the material gate", async () => {
    // Simulate the reported corruption: the LLM asked to replace
    // "80.000,00" with "980.000,00" (mis-anchored), which composes
    // "1" + "980.000,00" = "1980.000,00" in the published doc.
    const before = await makeMinutaDocx();
    const edits = [
      {
        find: "80.000,00",
        replace: "980.000,00",
        context_before: "R$ 1",
        context_after: "",
        reason: "bogus mis-anchored edit",
      },
    ];
    const { bytes } = await applyTrackedEdits(before, edits, {
      author: "QA",
    });
    const beforeText = await extractDocxBodyText(before);
    const accepted = await extractDocxBodyText(bytes);
    // The candidate accepted view composes the wrong value:
    expect(accepted).toContain("1980.000,00");
    // ...and the material gate blocks exactly this shape:
    const gate = materialGatePasses(beforeText, accepted, edits);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("occurrence not consumed");
  });

  it("FORM-04: suffix insertion in a table cell passes the material gate", async () => {
    // The QA scenario: append " (ret. QA)" after "Atendimento
    // Professional" in the Quadro Resumo table. The replace text
    // CONTAINS the find text, so the old count-based rule blocked
    // every insertion edit (job 1b6d7cbc — 4 attempts, no V3).
    const zip = new JSZip();
    const body = [
      `<w:p><w:r><w:t xml:space="preserve">QUADRO RESUMO</w:t></w:r></w:p>`,
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t xml:space="preserve">Atendimento Professional Horário comercial</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      `<w:p><w:r><w:t xml:space="preserve">ASSINATURAS: ____</w:t></w:r></w:p>`,
    ].join("");
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    );
    const before = await zip.generateAsync({ type: "nodebuffer" });
    const edits = [
      {
        find: "Atendimento Professional",
        replace: "Atendimento Professional (ret. QA)",
        context_before: "",
        context_after: " Horário",
        reason: "QA suffix insertion",
      },
    ];
    const { bytes } = await applyTrackedEdits(before, edits, {
      author: "QA",
    });
    const beforeText = await extractDocxBodyText(before);
    const accepted = await extractDocxBodyText(bytes);
    // The insertion landed in the accepted view:
    expect(accepted).toContain("Atendimento Professional (ret. QA)");
    // ...and the material gate now passes (find was consumed even
    // though it also appears inside the replacement):
    expect(materialGatePasses(beforeText, accepted, edits).ok).toBe(true);
  });

  it("FORM-04: insertion that never landed is still blocked", async () => {
    // Guard the guard: if the apply step failed silently and the
    // candidate kept the ORIGINAL free-standing find text (no replace
    // landed at the target site), the gate must still block.
    const beforeText = "Atendimento Professional Horário comercial";
    const candidateText = "Atendimento Professional Horário comercial"; // unchanged
    const edits = [
      {
        find: "Atendimento Professional",
        replace: "Atendimento Professional (ret. QA)",
      },
    ];
    const gate = materialGatePasses(beforeText, candidateText, edits);
    expect(gate.ok).toBe(false);
    // Check 1 fires first: the replace text never landed anywhere.
    expect(gate.reason).toContain("candidate lacks replacement");
  });
});
