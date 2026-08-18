"use client";

import { useCallback, useState } from "react";
import {
    isSupportedDocumentFile,
    formatUnsupportedDocumentWarning,
} from "@/app/lib/documentUploadValidation";

interface UseFileDropZoneOptions {
    /** Called with the files that were dropped. */
    onFiles: (files: File[]) => void;
    /** When true (default), filters out unsupported document types and surfaces a warning. */
    validateDocuments?: boolean;
    /** Custom validator. When provided, overrides the default document validation. */
    isSupported?: (file: File) => boolean;
    /** When true, only accepts a single file (passes only the first). */
    single?: boolean;
}

interface UseFileDropZoneReturn {
    isDragOver: boolean;
    handlers: {
        onDragOver: (e: React.DragEvent) => void;
        onDragLeave: (e: React.DragEvent) => void;
        onDrop: (e: React.DragEvent) => void;
    };
    unsupportedWarning: string | null;
    clearWarning: () => void;
}

function hasFilePayload(dt: DataTransfer): boolean {
    return dt.types.includes("Files");
}

/**
 * Reusable hook for drag-and-drop of external files.
 *
 * Encapsulates detection of external file payloads (vs internal doc drag),
 * drag-over state for visual feedback, file validation (document types by
 * default, or custom), and unsupported file warning.
 */
export function useFileDropZone({
    onFiles,
    validateDocuments = true,
    isSupported,
    single = false,
}: UseFileDropZoneOptions): UseFileDropZoneReturn {
    const [isDragOver, setIsDragOver] = useState(false);
    const [unsupportedWarning, setUnsupportedWarning] = useState<
        string | null
    >(null);

    const checkSupported = useCallback(
        (file: File) => {
            if (isSupported) return isSupported(file);
            if (!validateDocuments) return true;
            return isSupportedDocumentFile(file);
        },
        [isSupported, validateDocuments],
    );

    const onDragOver = useCallback(
        (e: React.DragEvent) => {
            if (!hasFilePayload(e.dataTransfer)) return;
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(true);
        },
        [],
    );

    const onDragLeave = useCallback(
        (e: React.DragEvent) => {
            // Only clear when leaving the container, not when moving between children
            if (
                !e.currentTarget.contains(e.relatedTarget as Node)
            ) {
                setIsDragOver(false);
            }
        },
        [],
    );

    const onDrop = useCallback(
        (e: React.DragEvent) => {
            if (!hasFilePayload(e.dataTransfer)) return;
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);

            let files = Array.from(e.dataTransfer.files);
            if (single && files.length > 1) {
                files = [files[0]];
            }

            if (!validateDocuments && !isSupported) {
                onFiles(files);
                return;
            }

            const supported: File[] = [];
            const unsupported: File[] = [];
            for (const file of files) {
                if (checkSupported(file)) {
                    supported.push(file);
                } else {
                    unsupported.push(file);
                }
            }

            setUnsupportedWarning(
                formatUnsupportedDocumentWarning(unsupported),
            );

            if (supported.length > 0) {
                onFiles(supported);
            }
        },
        [onFiles, checkSupported, validateDocuments, isSupported, single],
    );

    const clearWarning = useCallback(() => {
        setUnsupportedWarning(null);
    }, []);

    return {
        isDragOver,
        handlers: { onDragOver, onDragLeave, onDrop },
        unsupportedWarning,
        clearWarning,
    };
}
