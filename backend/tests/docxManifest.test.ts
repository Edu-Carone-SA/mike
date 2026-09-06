import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
    buildDocxManifest,
    diffDocxManifests,
} from "../src/lib/docxManifest";

/** Minimal but structurally rich DOCX built with jszip. */
async function makeDocx(opts?: {
    dropTable?: boolean;
    dropAnnex?: boolean;
    extraClause?: boolean;
}): Promise<Buffer> {
    const zip = new JSZip();
    const paragraphs = [
        p("ANEXO I — TERMOS E CONDIÇÕES GERAIS"),
        p("1. DAS DEFINIÇÕES"),
        p("Texto da cláusula primeira."),
        p("2. DO OBJETO"),
        p("Texto da cláusula segunda."),
        p("3.1 DA VIGÊNCIA"),
        p("Texto da subcláusula."),
        p("ASSINATURAS:"),
        p("By: ______  Name: Fulano  Title: Director  Date: ____"),
    ];
    if (opts?.extraClause) paragraphs.push(p("4. DO FORO"));
    if (!opts?.dropAnnex) {
        paragraphs.push(p("ANEXO II — POLÍTICA DE PRIVACIDADE"));
        paragraphs.push(p("Texto do anexo II."));
    }
    const tbl =
        !opts?.dropTable
            ? `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Célula</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
            : "";
    const body = paragraphs.join("") + tbl + `<w:sectPr/>`;
    zip.file(
        "word/document.xml",
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    );
    zip.file("word/header1.xml", "<x/>");
    zip.file("word/footer1.xml", "<x/>");
    zip.file("word/media/image1.png", Buffer.from([1, 2, 3]));
    zip.file("word/media/image2.png", Buffer.from([4, 5, 6]));
    zip.file(
        "word/comments.xml",
        `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="1"><w:p/></w:comment></w:comments>`,
    );
    const out = await zip.generateAsync({ type: "nodebuffer" });
    return out;
}

function p(text: string): string {
    return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

describe("docxManifest", () => {
    it("inventories structural parts of a docx", async () => {
        const m = await buildDocxManifest(await makeDocx());
        expect(m.paragraphs).toBeGreaterThanOrEqual(9);
        expect(m.tables).toBe(1);
        expect(m.images).toBe(2);
        expect(m.headers).toBe(1);
        expect(m.footers).toBe(1);
        expect(m.comments).toBe(1);
        expect(m.sections).toBe(1);
        expect(m.signatures).toBeGreaterThanOrEqual(1);
        expect(m.clauseNumbers).toContain("1");
        expect(m.clauseNumbers).toContain("2");
        expect(m.clauseNumbers).toContain("3.1");
        expect(m.annexHeadings.length).toBeGreaterThanOrEqual(2);
        expect(m.annexHeadings[0]).toContain("ANEXO I");
        expect(
            m.annexHeadings.some((h) => h.includes("ANEXO II")),
        ).toBe(true);
    });

    it("identical document passes diff", async () => {
        const buf = await makeDocx();
        const d = diffDocxManifests(
            await buildDocxManifest(buf),
            await buildDocxManifest(buf),
        );
        expect(d.ok).toBe(true);
        expect(d.losses).toEqual([]);
    });

    it("dropped table/annex are blocked losses", async () => {
        const before = await buildDocxManifest(await makeDocx());
        const after = await buildDocxManifest(
            await makeDocx({ dropTable: true, dropAnnex: true }),
        );
        const d = diffDocxManifests(before, after);
        expect(d.ok).toBe(false);
        expect(d.losses.join("\n")).toContain("tables: 1 -> 0");
        expect(d.losses.join("\n")).toContain("ANEXO II");
    });

    it("adding a clause is an addition, not a loss", async () => {
        const before = await buildDocxManifest(await makeDocx());
        const after = await buildDocxManifest(
            await makeDocx({ extraClause: true }),
        );
        const d = diffDocxManifests(before, after);
        expect(d.ok).toBe(true);
        // additions report structural growth; paragraph-only growth is not a
        // structural diff dimension, so an added clause must not appear as a loss.
        expect(d.losses).toEqual([]);
    });

    it("allowedClauseRemovals whitelist works", async () => {
        // Simulate removal of clause "2" by removing its heading only.
        const before = await buildDocxManifest(await makeDocx());
        // Same document without the clause-2 heading line.
        const zip = new JSZip();
        const paragraphs = [
            p("ANEXO I — TERMOS E CONDIÇÕES GERAIS"),
            p("1. DAS DEFINIÇÕES"),
            p("Texto da cláusula primeira."),
            p("Texto da cláusula segunda (heading 2 removida)."),
            p("3.1 DA VIGÊNCIA"),
            p("Texto da subcláusula."),
            p("ASSINATURAS:"),
            p("By: ______  Name: Fulano  Title: Director  Date: ____"),
            p("ANEXO II — POLÍTICA DE PRIVACIDADE"),
            p("Texto do anexo II."),
        ];
        zip.file(
            "word/document.xml",
            `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Célula</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`,
        );
        zip.file("word/header1.xml", "<x/>");
        zip.file("word/footer1.xml", "<x/>");
        zip.file("word/media/image1.png", Buffer.from([1, 2, 3]));
        zip.file("word/media/image2.png", Buffer.from([4, 5, 6]));
        zip.file(
            "word/comments.xml",
            `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="1"><w:p/></w:comment></w:comments>`,
        );
        const after = await buildDocxManifest(
            await zip.generateAsync({ type: "nodebuffer" }),
        );
        const blocked = diffDocxManifests(before, after);
        expect(blocked.ok).toBe(false);
        expect(blocked.losses.join("\n")).toContain("clause 2 removed");
        const allowed = diffDocxManifests(before, after, {
            allowedClauseRemovals: ["2"],
        });
        expect(allowed.ok).toBe(true);
    });
});
