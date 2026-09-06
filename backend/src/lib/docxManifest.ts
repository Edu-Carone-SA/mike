import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

/**
 * OOXML structural manifest (Sprint 4 — draft integrity).
 *
 * Built from the package BEFORE an edit is applied and from the candidate
 * output BEFORE a new version is published. The manifest is a factual
 * inventory of structural parts; comparing two manifests tells us whether
 * an authorized edit preserved everything it was not allowed to touch.
 */
export interface DocxManifest {
    paragraphs: number;
    tables: number;
    images: number;
    sections: number; // w:sectPr
    headers: number; // header parts referenced by the main document
    footers: number;
    comments: number;
    signatures: number; // signature lines/signature blocks (heuristic)
    /** 1-based clause numbers found in numbered headings, e.g. ["1", "2", "3.1"]. */
    clauseNumbers: string[];
    /** Exhibit/annex (anexo) headings verbatim (deduped, order preserved). */
    annexHeadings: string[];
}

function createParser() {
    return new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        preserveOrder: true,
        trimValues: false,
        parseAttributeValue: false,
        processEntities: true,
    });
}

function elName(n: unknown): string | null {
    if (!n || typeof n !== "object") return null;
    for (const k of Object.keys(n)) {
        if (k === ":@" || k === "#text" || k === "?xml") continue;
        return k;
    }
    return null;
}

/**
 * fast-xml-parser preserveOrder shape: an element is
 * `{ "w:p": [children...], ":@": {attrs} }`. Children live under the
 * element-name key; text nodes are plain `{ "#text": value }` objects.
 */
function elChildren(n: unknown): unknown[] {
    if (!n || typeof n !== "object") return [];
    for (const [k, v] of Object.entries(n)) {
        if (k === ":@" || k === "#text" || k === "?xml") continue;
        if (Array.isArray(v)) return v;
    }
    return [];
}

function textOf(nodes: unknown[]): string {
    let out = "";
    for (const n of nodes) {
        if (n && typeof n === "object" && "#text" in n) {
            out += String((n as Record<string, unknown>)["#text"] ?? "");
            continue;
        }
        const name = elName(n);
        if (name === "w:t") {
            out += textOf(elChildren(n));
        } else if (name !== null) {
            out += textOf(elChildren(n));
        }
    }
    return out;
}

const ANNEX_RE =
    /^\s*(anexo|annex|exhibit|apêndice|apendice|escritura pública|estatuto social)\b/i;
const CLAUSE_RE = /^\s*(\d+(?:\.\d+)*)[.)]?\s+\S/;

function collectParagraphInfo(
    nodes: unknown[],
    acc: {
        paragraphs: number;
        tables: number;
        sections: number;
        clauseNumbers: string[];
        annexHeadings: string[];
        signatures: number;
    },
): void {
    for (const n of nodes) {
        const name = elName(n);
        if (!name) continue;
        if (name === "w:p") {
            acc.paragraphs += 1;
            const text = textOf(elChildren(n)).trim();
            if (CLAUSE_RE.test(text)) {
                const m = CLAUSE_RE.exec(text);
                if (m) acc.clauseNumbers.push(m[1]);
            }
            if (ANNEX_RE.test(text)) acc.annexHeadings.push(text.slice(0, 120));
            if (/assinaturas?\b|signature block|\bBy:\s*$|\bBy:\b.*\bName:\b/i.test(text)) {
                acc.signatures += 1;
            }
        } else if (name === "w:tbl") {
            acc.tables += 1;
        } else if (name === "w:sectPr") {
            acc.sections += 1;
        } else if (
            name === "w:tr" ||
            name === "w:tc" ||
            name === "w:sdt" ||
            name === "w:sdtContent"
        ) {
            collectParagraphInfo(elChildren(n), acc);
        }
    }
}

async function countPartEntries(zip: JSZip, re: RegExp): Promise<number> {
    let count = 0;
    zip.forEach((path, file) => {
        // jszip reports directory entries too (e.g. "word/media/") — skip them.
        if (file.dir) return;
        if (re.test(path)) count += 1;
    });
    return count;
}

export async function buildDocxManifest(
    bytes: Buffer,
): Promise<DocxManifest> {
    const zip = await JSZip.loadAsync(bytes);
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) throw new Error("document.xml missing from docx");

    const parser = createParser();
    const tree = parser.parse(await docXmlFile.async("string")) as unknown[];
    // find w:body
    let body: unknown[] | null = null;
    for (const n of tree) {
        if (elName(n) === "w:document") {
            for (const c of elChildren(n)) {
                if (elName(c) === "w:body") {
                    body = elChildren(c);
                    break;
                }
            }
        }
    }
    const acc = {
        paragraphs: 0,
        tables: 0,
        sections: 0,
        clauseNumbers: [] as string[],
        annexHeadings: [] as string[],
        signatures: 0,
    };
    if (body) collectParagraphInfo(body, acc);

    const images = await countPartEntries(zip, /^word\/media\//);
    const headers = await countPartEntries(zip, /^word\/header\d*\.xml$/);
    const footers = await countPartEntries(zip, /^word\/footer\d*\.xml$/);
    const commentsFile = zip.file("word/comments.xml");
    let comments = 0;
    if (commentsFile) {
        const ctree = parser.parse(await commentsFile.async("string")) as unknown[];
        const countComments = (nodes: unknown[]) => {
            for (const n of nodes) {
                if (elName(n) === "w:comment") comments += 1;
                else countComments(elChildren(n));
            }
        };
        countComments(ctree);
    }

    return {
        paragraphs: acc.paragraphs,
        tables: acc.tables,
        images,
        sections: acc.sections,
        headers,
        footers,
        comments,
        signatures: acc.signatures,
        clauseNumbers: acc.clauseNumbers,
        annexHeadings: [...new Set(acc.annexHeadings)],
    };
}

export interface ManifestDiff {
    ok: boolean;
    losses: string[];
    additions: string[];
}

/**
 * Compare a pre-edit manifest with a post-edit candidate. Structural parts
 * that DISAPPEAR are losses (blocked); new content is reported but allowed
 * (authorized edits may add clauses).
 *
 * Formatting-only normalization: manifest counts never depend on run
 * splitting or whitespace, so a reflowed-but-equal document diffs clean.
 */
export function diffDocxManifests(
    before: DocxManifest,
    after: DocxManifest,
    opts?: { allowedClauseRemovals?: string[] },
): ManifestDiff {
    const allowed = new Set(opts?.allowedClauseRemovals ?? []);
    const losses: string[] = [];
    const additions: string[] = [];

    const checkCount = (
        label: string,
        b: number,
        a: number,
        protectedPart: boolean,
    ) => {
        if (a < b) {
            if (protectedPart) losses.push(`${label}: ${b} -> ${a}`);
            else if (a < b) additions.push(`${label}: ${b} -> ${a}`);
        } else if (a > b) {
            additions.push(`${label}: ${b} -> ${a}`);
        }
    };

    checkCount("tables", before.tables, after.tables, true);
    checkCount("images", before.images, after.images, true);
    checkCount("headers", before.headers, after.headers, true);
    checkCount("footers", before.footers, after.footers, true);
    checkCount("sections", before.sections, after.sections, true);
    checkCount("comments", before.comments, after.comments, false);
    checkCount("signature blocks", before.signatures, after.signatures, true);

    const beforeClauses = new Set(before.clauseNumbers);
    const afterClauses = new Set(after.clauseNumbers);
    for (const c of beforeClauses) {
        if (!afterClauses.has(c) && !allowed.has(c)) {
            losses.push(`clause ${c} removed`);
        }
    }
    const beforeAnnexes = new Set(before.annexHeadings);
    for (const a of beforeAnnexes) {
        if (!after.annexHeadings.includes(a)) {
            losses.push(`annex/exhibit removed: "${a.slice(0, 60)}"`);
        }
    }

    return { ok: losses.length === 0, losses, additions };
}
