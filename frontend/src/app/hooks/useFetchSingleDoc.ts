"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/app/lib/supabase";

/**
 * /display returns PDF bytes (when the active version has a PDF rendition),
 * raw spreadsheet bytes (xlsx/xlsm/xls — never converted to PDF), or raw DOCX
 * bytes otherwise. Reporting the type lets the caller swap between PdfView
 * (PDF.js), SpreadsheetView (Fortune-sheet), and DocxView (docx-preview).
 */
export type DocResult =
    | { type: "pdf"; buffer: ArrayBuffer }
    | { type: "spreadsheet"; buffer: ArrayBuffer }
    | { type: "docx" }
    | null;

/** Office spreadsheet content types served raw by /display. */
function isSpreadsheetContentType(contentType: string): boolean {
    return (
        contentType.includes("spreadsheetml") || // .xlsx
        contentType.includes("ms-excel") // .xls / .xlsm
    );
}

export function useFetchSingleDoc(
    documentId: string | null | undefined,
    versionId?: string | null,
) {
    const [result, setResult] = useState<DocResult>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const prevKeyRef = useRef<string | null>(null);
    // QA VIEW-LOAD-001: a 30 MB scanned PDF kept the viewer spinner for
    // 86+ seconds with no error and no retry. Give the byte fetch a hard
    // deadline; expose a typed error the viewer can retry.
    const LOAD_TIMEOUT_MS = 60_000;
    const [retryTick, setRetryTick] = useState(0);

    // QA VIEW-LOAD-001: after a timeout/error the user must be able to
    // retry the same document. Clears the dedup key so the effect below
    // re-runs the fetch.
    const retry = useCallback(() => {
        prevKeyRef.current = null;
        setRetryTick((t) => t + 1);
    }, []);

    useEffect(() => {
        if (!documentId) return;
        const requestKey = `${documentId}:${versionId ?? "current"}`;
        if (requestKey === prevKeyRef.current) return;
        prevKeyRef.current = requestKey;

        setLoading(true);
        setError(null);
        setResult(null);

        let cancelled = false;

        (async () => {
            try {
                const {
                    data: { session },
                } = await supabase.auth.getSession();
                const token = session?.access_token;
                if (cancelled) return;

                const apiBase =
                    process.env.NEXT_PUBLIC_API_BASE_URL ??
                    "http://localhost:3001";
                const qs = versionId
                    ? `?version_id=${encodeURIComponent(versionId)}`
                    : "";
                const response = await fetch(
                    `${apiBase}/single-documents/${documentId}/display${qs}`,
                    {
                        headers: token
                            ? { Authorization: `Bearer ${token}` }
                            : {},
                        // Abort the whole request — headers AND body —
                        // when the deadline passes, so arrayBuffer()
                        // below cannot hang on a stalled 30 MB download.
                        signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
                    },
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                if (cancelled) return;

                const contentType =
                    response.headers.get("content-type") ?? "";
                if (contentType.includes("application/pdf")) {
                    const buffer = await response.arrayBuffer();
                    if (!cancelled) setResult({ type: "pdf", buffer });
                } else if (isSpreadsheetContentType(contentType)) {
                    const buffer = await response.arrayBuffer();
                    if (!cancelled) setResult({ type: "spreadsheet", buffer });
                } else {
                    // Drain the body so the connection is reusable, but the
                    // bytes are useless to the PDF viewer — the caller will
                    // fall back to DocxView, which fetches `/docx` itself.
                    await response.arrayBuffer().catch(() => {});
                    if (!cancelled) setResult({ type: "docx" });
                }
            } catch (err) {
                if (!cancelled) {
                    if (
                        err instanceof DOMException &&
                        err.name === "TimeoutError"
                    ) {
                        setError(
                            "O download do documento excedeu 60 segundos e foi cancelado. Documentos escaneados muito grandes podem demorar — tente novamente.",
                        );
                    } else {
                        setError("Failed to load document.");
                    }
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
            prevKeyRef.current = null;
        };
    }, [documentId, versionId, retryTick]);

    return { result, loading, error, retry };
}
