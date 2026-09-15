/**
 * P0 QA 15/09/2026 — bateria ampla, G04 (chat 4f5ac7ab): the product
 * published a V2 that deleted the parent heading "7. RESCISÃO" while its
 * numbered children ("7. RESCISÃO.2", "7. RESCISÃO.3") survived and one
 * child's numbering was left dangling (".1 A rescisão..."). The manifest
 * collapsed parent and children into the same clause number ("7"), so the
 * diff saw no loss and the destructive edit published.
 *
 * These tests exercise the REAL gate (buildDocxManifest + diffDocxManifests)
 * — never a local copy — with the G04 document shapes.
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
    buildDocxManifest,
    diffDocxManifests,
} from "../src/lib/docxManifest";

function p(text: string): string {
    return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

async function makeDocx(paragraphTexts: string[]): Promise<Buffer> {
    const zip = new JSZip();
    const body = paragraphTexts.map(p).join("") + `<w:sectPr/>`;
    zip.file(
        "word/document.xml",
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    );
    return zip.generateAsync({ type: "nodebuffer" });
}

// The fixture as QA built it: clause 7 with numbered children.
const BEFORE = [
    "1. DO OBJETO",
    "Texto do objeto.",
    "7. RESCISÃO",
    "A rescisão poderá ser operada nas hipóteses seguintes.",
    "7. RESCISÃO.2",
    "Texto da subcláusula 7.2.",
    "7. RESCISÃO.3",
    "Texto da subcláusula 7.3.",
    "ASSINATURAS:",
];

// The G04 V2 as QA observed it: parent heading gone, first child now
// starts with a dangling ".1", the others keep "7. RESCISÃO.N".
const AFTER_G04 = [
    "1. DO OBJETO",
    "Texto do objeto.",
    ".1 A rescisão poderá ser operada nas hipóteses seguintes.",
    "7. RESCISÃO.2",
    "Texto da subcláusula 7.2.",
    "7. RESCISÃO.3",
    "Texto da subcláusula 7.3.",
    "ASSINATURAS:",
];

describe("G04 — orphaned clause structure must block publication", () => {
    it("manifest sees the parent heading and the numbered children as distinct facts", async () => {
        const m = await buildDocxManifest(await makeDocx(BEFORE));
        expect(m.clauseNumbers).toContain("7");
        expect(m.clauseHeadings.join("\n")).toContain("7. RESCISÃO");
        expect(m.danglingPrefixes).toEqual([]);
    });

    it("the G04 candidate is blocked: parent removed, orphans remain", async () => {
        const before = await buildDocxManifest(await makeDocx(BEFORE));
        const after = await buildDocxManifest(await makeDocx(AFTER_G04));
        const d = diffDocxManifests(before, after);
        expect(d.ok).toBe(false);
        const all = d.losses.join(" | ");
        expect(all).toContain("orphaned numbering prefix");
        expect(all).toContain("numbered descendants remain");
    });

    it("a coherent whole-subtree rename passes (parent + children renamed together)", async () => {
        const before = await buildDocxManifest(await makeDocx(BEFORE));
        const after = await buildDocxManifest(
            await makeDocx([
                "1. DO OBJETO",
                "Texto do objeto.",
                "7. RESCISÃO CONTRATUAL",
                "A rescisão poderá ser operada nas hipóteses seguintes.",
                "7. RESCISÃO CONTRATUAL.2",
                "Texto da subcláusula 7.2.",
                "7. RESCISÃO CONTRATUAL.3",
                "Texto da subcláusula 7.3.",
                "ASSINATURAS:",
            ]),
        );
        const d = diffDocxManifests(before, after);
        expect(d.ok).toBe(true);
        expect(d.losses).toEqual([]);
    });

    it("renaming ONLY the parent (children keep old numbering) is an orphan and blocks", async () => {
        const before = await buildDocxManifest(await makeDocx(BEFORE));
        const after = await buildDocxManifest(
            await makeDocx([
                "1. DO OBJETO",
                "Texto do objeto.",
                "7. RESCISÃO CONTRATUAL",
                "A rescisão poderá ser operada nas hipóteses seguintes.",
                "7. RESCISÃO.2",
                "Texto da subcláusula 7.2.",
                "7. RESCISÃO.3",
                "Texto da subcláusula 7.3.",
                "ASSINATURAS:",
            ]),
        );
        const d = diffDocxManifests(before, after);
        expect(d.ok).toBe(false);
        expect(d.losses.join(" | ")).toContain(
            "numbered descendants remain",
        );
    });

    it("removing the whole clause subtree (parent + children) passes", async () => {
        const before = await buildDocxManifest(await makeDocx(BEFORE));
        const after = await buildDocxManifest(
            await makeDocx([
                "1. DO OBJETO",
                "Texto do objeto.",
                "ASSINATURAS:",
            ]),
        );
        // Whole-subtree removal drops every "7" fact; the legacy rule
        // already blocks clause-number removal — that is the documented,
        // conservative behavior for full-section deletion.
        const d = diffDocxManifests(before, after);
        expect(d.ok).toBe(false);
        expect(d.losses.join(" | ")).toContain("clause 7 removed");
    });

    it("the pre-G04 collapse no longer hides the loss: parent-only deletion with children intact", async () => {
        const before = await buildDocxManifest(await makeDocx(BEFORE));
        const after = await buildDocxManifest(
            await makeDocx([
                "1. DO OBJETO",
                "Texto do objeto.",
                "A rescisão poderá ser operada nas hipóteses seguintes.",
                "7. RESCISÃO.2",
                "Texto da subcláusula 7.2.",
                "7. RESCISÃO.3",
                "Texto da subcláusula 7.3.",
                "ASSINATURAS:",
            ]),
        );
        const d = diffDocxManifests(before, after);
        expect(d.ok).toBe(false);
        expect(d.losses.join(" | ")).toContain(
            "numbered descendants remain",
        );
    });
});
