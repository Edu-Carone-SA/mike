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

/**
 * Log to stdout in ALL environments (including production).
 * Used for OCR diagnostics that need to be visible in CloudWatch.
 */
function log(...args: Parameters<typeof console.log>) {
  console.log(...args);
}

/**
 * Minimum average chars per page below which we try OCR as a fallback.
 * A normal text page has 500+ chars. A scanned page with residual text
 * (page numbers, watermarks) typically has < 50 chars. 50 is a safe
 * threshold that catches scanned docs without triggering OCR on short
 * but legitimate text PDFs (e.g., a 1-page cover letter with 100 chars).
 */
const MIN_CHARS_PER_PAGE_FOR_OCR = 50;

/** OCR language pack. English + Portuguese covers Atlas legal docs. */
const OCR_LANG = process.env.OCR_LANG ?? "eng+por";

/** Render DPI — 150 is sufficient for OCR and ~2x faster than 300. */
const OCR_DPI = 150;

/** Max pages to OCR — prevents runaway processing on huge documents. */
const OCR_MAX_PAGES = 50;

/** Number of tesseract processes to run in parallel. */
const OCR_CONCURRENCY = 4;

let toolsAvailable: boolean | null = null;

/**
 * Check whether `tesseract` and `pdftoppm` are installed on the system.
 * Uses `command -v` (POSIX builtin) instead of `which` (which may not
 * be installed on slim Docker images). The result is cached for the
 * lifetime of the process.
 */
async function checkOcrTools(): Promise<boolean> {
  if (toolsAvailable !== null) return toolsAvailable;
  try {
    await execAsync("command -v tesseract && command -v pdftoppm");
    toolsAvailable = true;
    log("[ocr] tools check: tesseract and pdftoppm available");
  } catch (err) {
    toolsAvailable = false;
    log("[ocr] tools check FAILED — tesseract or pdftoppm not found:", String(err));
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
    proc.stderr.on("data", () => {}); // swallow stderr to avoid unhandled
    proc.on("error", (err) => {
      log("[ocr] tesseract spawn error:", String(err));
      resolve("");
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        log(`[ocr] tesseract exited with code ${code}`);
      }
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
  const startTime = Date.now();
  log(`[ocr] ocrPdfBuffer called, buffer size=${buf.byteLength} bytes`);

  if (!(await checkOcrTools())) {
    log("[ocr] tesseract/pdftoppm not available — skipping OCR");
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
    log(`[ocr] running pdftoppm at ${OCR_DPI} DPI...`);
    const ppmStart = Date.now();
    await execAsync(
      `pdftoppm -png -r ${OCR_DPI} "${pdfPath}" "${imgPrefix}"`,
      { maxBuffer: EXEC_MAX_BUFFER },
    );
    log(`[ocr] pdftoppm done in ${Date.now() - ppmStart}ms`);

    const files = (await readdir(tmpDir))
      .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
      .sort();

    if (files.length === 0) {
      log("[ocr] pdftoppm produced no images");
      return "";
    }

    log(`[ocr] pdftoppm produced ${files.length} page images`);

    const pagesToProcess = Math.min(files.length, OCR_MAX_PAGES);
    if (files.length > OCR_MAX_PAGES) {
      log(
        `[ocr] PDF has ${files.length} pages, processing first ${OCR_MAX_PAGES} only`,
      );
    }

    // Process pages in parallel batches for speed.
    // Sequential: 11 pages × ~7s = 77s. With 4 workers: ~20s.
    const pageFiles = files.slice(0, pagesToProcess);
    const results: { index: number; text: string }[] = [];
    const ocrStart = Date.now();

    for (let batch = 0; batch < pageFiles.length; batch += OCR_CONCURRENCY) {
      const batchFiles = pageFiles.slice(batch, batch + OCR_CONCURRENCY);
      const batchResults = await Promise.all(
        batchFiles.map(async (file, j) => {
          const pageIndex = batch + j;
          try {
            const imgBuf = await readFile(join(tmpDir, file));
            const pageStart = Date.now();
            const text = await tesseractStdin(imgBuf);
            const pageMs = Date.now() - pageStart;
            log(`[ocr] page ${pageIndex + 1}/${pagesToProcess}: ${text.trim().length} chars in ${pageMs}ms`);
            return { index: pageIndex, text: text.trim() };
          } catch (err) {
            log(`[ocr] tesseract failed on page ${pageIndex + 1}, skipping:`, String(err));
            return { index: pageIndex, text: "" };
          }
        }),
      );
      results.push(...batchResults);
    }

    log(`[ocr] tesseract phase done in ${Date.now() - ocrStart}ms (${pagesToProcess} pages, ${OCR_CONCURRENCY} parallel)`);

    // Sort by page index to maintain page order.
    results.sort((a, b) => a.index - b.index);
    const parts = results.map((r) => `[Page ${r.index + 1}]\n${r.text}`);

    const totalMs = Date.now() - startTime;
    const totalChars = parts.join("").length;
    log(`[ocr] complete: ${totalChars} chars from ${pagesToProcess} pages in ${totalMs}ms`);

    return parts.join("\n\n");
  } catch (err) {
    log(`[ocr] failed:`, String(err));
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
 * then applies a per-page threshold: if the average text per page is
 * below MIN_CHARS_PER_PAGE, the PDF is likely scanned (images with
 * residual text like page numbers or watermarks).
 *
 * A multi-page scanned PDF can produce 100+ chars of markers plus
 * 50-200 chars of residual text (page numbers, headers), which would
 * exceed a simple absolute threshold but still indicate a scanned doc.
 */
export function shouldTryOcr(text: string): boolean {
  // Count [Page N] markers to estimate page count.
  const pageMarkers = text.match(/\[Page \d+\]/g) ?? [];
  const pageCount = Math.max(pageMarkers.length, 1);
  // Strip markers to measure actual text content.
  const stripped = text.replace(/\[Page \d+\]\s*/g, "").trim();
  const avgCharsPerPage = stripped.length / pageCount;
  return avgCharsPerPage < MIN_CHARS_PER_PAGE_FOR_OCR;
}
