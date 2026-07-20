/**
 * OCR fallback for scanned PDFs.
 *
 * Uses system-level `tesseract` + `pdftoppm` (poppler-utils) to extract
 * text from PDFs that have no text layer (e.g., scanned documents).
 *
 * If the tools are not installed (e.g., local dev without the Docker
 * image), all functions gracefully return empty strings — the caller
 * falls through to the original (empty) extraction result.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm, writeFile, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const execAsync = promisify(exec);

const isDev = process.env.NODE_ENV !== "production";
function devLog(...args: Parameters<typeof console.log>) {
  if (isDev) console.log(...args);
}

/** Minimum text length (chars) below which we try OCR as a fallback. */
const MIN_TEXT_LENGTH_FOR_OCR = 10;

/** OCR language pack. English + Portuguese covers Atlas legal docs. */
const OCR_LANG = process.env.OCR_LANG ?? "eng+por";

/** Render DPI — 300 is the sweet spot for OCR accuracy vs. speed. */
const OCR_DPI = 300;

/** Max pages to OCR — prevents runaway processing on huge documents. */
const OCR_MAX_PAGES = 50;

let toolsAvailable: boolean | null = null;

/**
 * Check whether `tesseract` and `pdftoppm` are installed on the system.
 * The result is cached for the lifetime of the process.
 */
async function checkOcrTools(): Promise<boolean> {
  if (toolsAvailable !== null) return toolsAvailable;
  try {
    await execAsync("which tesseract && which pdftoppm");
    toolsAvailable = true;
  } catch {
    toolsAvailable = false;
  }
  return toolsAvailable;
}

/**
 * Run OCR on a PDF buffer. Converts each page to a PNG image using
 * `pdftoppm`, then recognises text on each image using `tesseract`.
 *
 * Returns the extracted text (with `[Page N (OCR)]` markers), or an
 * empty string if the tools are unavailable or OCR fails.
 */
export async function ocrPdfBuffer(buf: ArrayBuffer): Promise<string> {
  if (!(await checkOcrTools())) {
    devLog("[ocr] tesseract/pdftoppm not available — skipping OCR");
    return "";
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "mike-ocr-"));
  try {
    const pdfPath = join(tmpDir, "input.pdf");
    await writeFile(pdfPath, Buffer.from(buf));

    // Convert PDF to PNG images at the configured DPI.
    const imgPrefix = join(tmpDir, "page");
    await execAsync(
      `pdftoppm -png -r ${OCR_DPI} "${pdfPath}" "${imgPrefix}"`,
    );

    const files = (await readdir(tmpDir))
      .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
      .sort();

    if (files.length === 0) {
      devLog("[ocr] pdftoppm produced no images");
      return "";
    }

    const pagesToProcess = Math.min(files.length, OCR_MAX_PAGES);
    if (files.length > OCR_MAX_PAGES) {
      devLog(
        `[ocr] PDF has ${files.length} pages, processing first ${OCR_MAX_PAGES} only`,
      );
    }

    const parts: string[] = [];
    for (let i = 0; i < pagesToProcess; i++) {
      const imgPath = join(tmpDir, files[i]);
      try {
        const { stdout } = await execAsync(
          `tesseract "${imgPath}" - -l ${OCR_LANG} 2>/dev/null`,
        );
        parts.push(`[Page ${i + 1}]\n${stdout.trim()}`);
      } catch {
        devLog(`[ocr] tesseract failed on page ${i + 1}, skipping`);
      }
    }

    return parts.join("\n\n");
  } catch (err) {
    devLog(`[ocr] failed: ${err}`);
    return "";
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Returns true if the extracted text is too sparse to be useful and
 * OCR should be attempted as a fallback.
 */
export function shouldTryOcr(text: string): boolean {
  return text.trim().length < MIN_TEXT_LENGTH_FOR_OCR;
}
