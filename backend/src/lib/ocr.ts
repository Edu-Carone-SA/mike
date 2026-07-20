/**
 * OCR fallback for scanned PDFs.
 *
 * Uses system-level `tesseract` + `pdftoppm` (poppler-utils) to extract
 * text from PDFs that have no text layer (e.g., scanned documents).
 *
 * Images are piped to tesseract via stdin rather than file paths — this
 * avoids Leptonica file-I/O issues on some platforms (notably macOS) and
 * is equally reliable on Linux/Docker.
 *
 * If the tools are not installed (e.g., local dev without the Docker
 * image), all functions gracefully return empty strings — the caller
 * falls through to the original (empty) extraction result.
 */

import { spawn } from "child_process";
import { exec } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm, writeFile, readdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const execAsync = promisify(exec);

/** Max buffer for exec commands (50 MB) — default 1 MB is too small for OCR output. */
const EXEC_MAX_BUFFER = 50 * 1024 * 1024;

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
 * Run tesseract on an image buffer, piping the image via stdin.
 * Returns the recognised text, or empty string on failure.
 */
function tesseractStdin(imageBuf: Buffer): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(
      "tesseract",
      ["stdin", "stdout", "-l", OCR_LANG],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.on("error", () => resolve(""));
    proc.on("close", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    proc.stdin.write(imageBuf);
    proc.stdin.end();
  });
}

/**
 * Run OCR on a PDF buffer. Converts each page to a PNG image using
 * `pdftoppm`, then recognises text on each image using `tesseract`
 * (piping via stdin for cross-platform compatibility).
 *
 * Returns the extracted text (with `[Page N]` markers), or an
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
    // pdftoppm writes files to disk (it doesn't support stdout for
    // multi-page output), but tesseract reads via stdin.
    const imgPrefix = join(tmpDir, "page");
    await execAsync(
      `pdftoppm -png -r ${OCR_DPI} "${pdfPath}" "${imgPrefix}"`,
      { maxBuffer: EXEC_MAX_BUFFER },
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
      try {
        const imgBuf = await readFile(join(tmpDir, files[i]));
        const text = await tesseractStdin(imgBuf);
        parts.push(`[Page ${i + 1}]\n${text.trim()}`);
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
 *
 * Strips `[Page N]` markers (added by extractPdfText) before measuring,
 * because a multi-page scanned PDF can produce 100+ chars of markers
 * with zero actual content, which would otherwise exceed the threshold
 * and prevent OCR from running.
 */
export function shouldTryOcr(text: string): boolean {
  const stripped = text.replace(/\[Page \d+\]\s*/g, "").trim();
  return stripped.length < MIN_TEXT_LENGTH_FOR_OCR;
}
