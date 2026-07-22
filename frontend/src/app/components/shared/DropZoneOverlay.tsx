"use client";

import { UploadCloud } from "lucide-react";

interface DropZoneOverlayProps {
    /** When true, renders the overlay. */
    isDragOver: boolean;
    /** Optional label text. Defaults to "Drop to upload". */
    label?: string;
    /** Extra className for the overlay container. */
    className?: string;
}

/**
 * Visual overlay for drag-and-drop zones.
 *
 * Renders a semi-transparent blue overlay with a border and a centered
 * "Drop to upload" label when `isDragOver` is true.
 *
 * The parent must have `position: relative` for the overlay to fill
 * the container correctly.
 */
export function DropZoneOverlay({
    isDragOver,
    label = "Drop to upload",
    className = "",
}: DropZoneOverlayProps) {
    if (!isDragOver) return null;

    return (
        <div
            className={`pointer-events-none absolute inset-0 z-[90] flex items-center justify-center border-2 border-blue-400 bg-blue-50/40 ${className}`}
        >
            <div className="flex flex-col items-center gap-1.5">
                <UploadCloud className="h-6 w-6 text-blue-500" />
                <span className="text-sm font-medium text-blue-600">
                    {label}
                </span>
            </div>
        </div>
    );
}
