import JSZip from "jszip";
import mammoth from "mammoth";

interface DocComment {
  id: string;
  author: string;
  text: string;
}

/**
 * Recursively collect all text values (from `w:t` elements and `#text` nodes)
 * within a parsed XML node. Attribute keys (`@_` prefixed) are skipped so we
 * only gather character data.
 */
function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");

  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    const parts: string[] = [];
    // When an element has attributes, fast-xml-parser puts its text in "#text".
    if (typeof record["#text"] === "string") {
      parts.push(record["#text"]);
    }
    for (const [key, value] of Object.entries(record)) {
      if (key.startsWith("@_") || key === "#text") continue;
      parts.push(collectText(value));
    }
    return parts.join("");
  }
  return "";
}

/**
 * Extract text from a single `<w:comment>` node, preserving paragraph breaks.
 *
 * Comment structure: `w:comment > w:p[] > w:r[] > w:t`
 */
function extractCommentText(node: Record<string, unknown>): string {
  const pNodes = node["w:p"];
  if (pNodes == null) return collectText(node).trim();

  const paragraphs = Array.isArray(pNodes) ? pNodes : [pNodes];
  return paragraphs
    .map((p) => collectText(p))
    .filter((t) => t.length > 0)
    .join("\n")
    .trim();
}

/**
 * Parse the contents of `word/comments.xml` and extract comment metadata.
 *
 * Uses `fast-xml-parser` (already a project dependency) with attribute
 * preservation enabled so we can read `w:id` and `w:author`.
 */
async function parseComments(commentsXml: string): Promise<DocComment[]> {
  const { XMLParser } = await import("fast-xml-parser");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const parsed = parser.parse(commentsXml);

  const commentsRoot = parsed["w:comments"] as
    | Record<string, unknown>
    | undefined;
  if (!commentsRoot) return [];

  const commentNodes = commentsRoot["w:comment"];
  if (commentNodes == null) return [];

  // fast-xml-parser returns a single object when there is one comment and an
  // array when there are several — normalise to an array.
  const nodes = Array.isArray(commentNodes) ? commentNodes : [commentNodes];
  return nodes.map((node) => {
    const record = node as Record<string, unknown>;
    return {
      id: String(record["@_w:id"] ?? ""),
      author: String(record["@_w:author"] ?? "Unknown"),
      text: extractCommentText(record),
    };
  });
}

/**
 * Extract body text **and** comments from a `.docx` file.
 *
 * - Body text is extracted using mammoth (`extractRawText`).
 * - Comments are parsed from `word/comments.xml` inside the docx zip archive.
 *
 * If `word/comments.xml` does not exist (or contains no comments), only the
 * mammoth body text is returned with `commentCount: 0`.
 *
 * When comments are present they are appended to the body text in a formatted
 * "## Comments" section:
 *
 * ```
 * [body text from mammoth]
 *
 * ---
 *
 * ## Comments
 *
 * 1. **[Author]**: [comment text]
 * 2. **[Author]**: [comment text]
 * ```
 */
export async function extractDocxWithComments(
  buffer: Buffer,
): Promise<{ text: string; commentCount: number }> {
  // Extract body text via mammoth.
  const mammothResult = await mammoth.extractRawText({ buffer });
  const bodyText = mammothResult.value;

  // Open the docx zip to look for comments.
  const zip = await JSZip.loadAsync(buffer);
  const commentsFile = zip.file("word/comments.xml");

  if (!commentsFile) {
    return { text: bodyText, commentCount: 0 };
  }

  const commentsXml = await commentsFile.async("string");
  const comments = await parseComments(commentsXml);

  if (comments.length === 0) {
    return { text: bodyText, commentCount: 0 };
  }

  const commentSection = [
    "",
    "",
    "---",
    "",
    "## Comments",
    "",
    ...comments.map(
      (c, i) => `${i + 1}. **[${c.author}]**: ${c.text}`,
    ),
  ].join("\n");

  return {
    text: bodyText + commentSection,
    commentCount: comments.length,
  };
}
