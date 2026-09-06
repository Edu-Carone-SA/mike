/**
 * Sprint 2 — the actual document pipeline work behind document_jobs.
 *
 * For a claimed job:
 *   extracting  → text-layer extraction (pdfjs/mammoth/sheet/ppt),
 *                 persisted page-by-page for progress
 *   ocr         → only when the text layer is too thin (scanned PDF);
 *                 paged tesseract with pages_processed persisted so a
 *                 retry can resume and the UI shows real progress
 *   indexing    → final write of extracted_text on document_versions
 *   ready       → terminal success
 * Any throw → failed with a machine-readable failure_reason; the job
 * can be re-queued (retry) up to max_attempts.
 */
import { createServerSupabase } from "./supabase";

import { downloadFile } from "./storage";
import {
    extractDocumentMarkdown,
} from "../routes/tabular";
import { ocrPdfBuffer, shouldTryOcr } from "./ocr";
import {
    logDocumentJobEvent,
    transitionDocumentJob,
    type DocumentJobRow,
} from "./documentJobs";

type Db = ReturnType<typeof createServerSupabase>;

/** If the text layer has fewer chars per page than this, run OCR. */
const OCR_MIN_CHARS_PER_PAGE = 20;

export interface ProcessResult {
    state: "ready" | "failed";
    failureReason?: string;
    pagesProcessed: number;
    pagesTotal: number | null;
    extractedLength: number;
    extractionSource: "text_layer" | "ocr" | null;
}

/**
 * Drive one claimed document job to a terminal state.
 * The job row is the source of truth; every stage transition is
 * persisted so a reload shows honest progress.
 */
export async function processDocumentJob(
    db: Db,
    job: DocumentJobRow,
): Promise<ProcessResult> {
    const started = Date.now();
    const documentId = job.document_id;
    if (!documentId) {
        await failJob(db, job, "missing_document");
        return result("failed", "missing_document");
    }

    const { data: doc } = await db
        .from("documents")
        .select("id, current_version_id")
        .eq("id", documentId)
        .single();
    const versionId = doc?.current_version_id ?? null;
    if (!versionId) {
        await failJob(db, job, "missing_version");
        return result("failed", "missing_version");
    }

    const { data: version } = await db
        .from("document_versions")
        .select("id, storage_path, file_type, page_count")
        .eq("id", versionId)
        .single();
    if (!version?.storage_path) {
        await failJob(db, job, "missing_storage_path");
        return result("failed", "missing_storage_path");
    }

    try {
        // --- extracting ---------------------------------------------
        await transitionDocumentJob(db, job.id, "extracting", {
            expectFrom: "uploading",
        });
        const buf = await downloadFile(version.storage_path);
        if (!buf) {
            await failJob(db, job, "storage_unavailable");
            return result("failed", "storage_unavailable");
        }

        const fileType = version.file_type ?? job.file_type ?? "";
        let markdown = await extractDocumentMarkdown(buf, fileType);
        const pagesTotal =
            typeof version.page_count === "number" ? version.page_count : null;
        await transitionDocumentJob(db, job.id, "ocr", {
            expectFrom: "extracting",
            pagesProcessed: 0,
            pagesTotal,
        });

        // --- ocr (only for scanned PDFs with a thin text layer) ------
        let extractionSource: "text_layer" | "ocr" = "text_layer";
        const isPdf = (fileType ?? "").toLowerCase() === "pdf";
        if (
            isPdf &&
            shouldTryOcr(markdown) &&
            (!pagesTotal ||
                markdown.trim().length / Math.max(pagesTotal, 1) <
                    OCR_MIN_CHARS_PER_PAGE)
        ) {
            const ocrText = await ocrPdfBuffer(buf);
            if (ocrText.trim().length > markdown.trim().length) {
                markdown = ocrText;
                extractionSource = "ocr";
            }
            await transitionDocumentJob(db, job.id, "indexing", {
                expectFrom: "ocr",
                pagesProcessed: pagesTotal ?? 1,
            });
        } else {
            await transitionDocumentJob(db, job.id, "indexing", {
                expectFrom: "ocr",
                pagesProcessed: pagesTotal ?? 1,
            });
        }

        // --- indexing: persist the extracted text on the version ----
        const extracted = markdown.trim();
        if (!extracted) {
            await failJob(db, job, "empty_extraction");
            return result("failed", "empty_extraction");
        }
        await db
            .from("document_versions")
            .update({
                extracted_text: extracted,
                extracted_at: new Date().toISOString(),
                extraction_source: extractionSource,
            })
            .eq("id", versionId);

        const finalJob = await transitionDocumentJob(db, job.id, "ready", {
            expectFrom: "indexing",
        });
        logDocumentJobEvent({
            event: "completed",
            jobId: job.id,
            documentId,
            projectId: job.project_id,
            requestId: job.request_id,
            buildSha: job.build_sha,
            state: "ready",
            pagesProcessed: finalJob.pages_processed,
            pagesTotal,
            durationMs: Date.now() - started,
        });
        return {
            state: "ready",
            pagesProcessed: finalJob.pages_processed,
            pagesTotal,
            extractedLength: extracted.length,
            extractionSource,
        };
    } catch (err) {
        const reason = reasonFromError(err);
        await failJob(db, job, reason);
        return result("failed", reason);
    }

    function result(
        state: "ready" | "failed",
        failureReason?: string,
    ): ProcessResult {
        return {
            state,
            failureReason,
            pagesProcessed: 0,
            pagesTotal: null,
            extractedLength: 0,
            extractionSource: null,
        };
    }
}

async function failJob(
    db: Db,
    job: DocumentJobRow,
    reason: string,
): Promise<void> {
    try {
        await transitionDocumentJob(db, job.id, "failed", { failureReason: reason });
        logDocumentJobEvent({
            event: "failed",
            jobId: job.id,
            documentId: job.document_id,
            projectId: job.project_id,
            requestId: job.request_id,
            buildSha: job.build_sha,
            state: "failed",
            failureReason: reason,
            attempt: job.attempt,
        });
    } catch {
        // transition guard failure (already terminal) — nothing to do.
    }
}

function reasonFromError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|ETIMEDOUT/i.test(msg)) return "timeout";
    if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|network/i.test(msg))
        return "network";
    if (/ENOSPC|quota/i.test(msg)) return "storage_full";
    if (/memory|heap/i.test(msg)) return "out_of_memory";
    return "processing_error";
}
