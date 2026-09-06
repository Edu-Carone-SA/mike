import { describe, expect, it } from "vitest";

import {
    canDocumentJobTransition,
    isDocumentJobTerminal,
    assertDocumentJobTransition,
    InvalidDocumentJobTransition,
} from "../src/lib/documentJobs";

describe("document job state machine", () => {
    it("walks the happy path queued → ready", () => {
        const path = [
            "queued",
            "uploading",
            "extracting",
            "ocr",
            "indexing",
            "ready",
        ];
        for (let i = 0; i < path.length - 1; i++) {
            expect(canDocumentJobTransition(path[i], path[i + 1])).toBe(true);
        }
    });

    it("can skip ocr for text-layer documents", () => {
        expect(canDocumentJobTransition("extracting", "indexing")).toBe(true);
    });

    it("allows failure/cancel from every active state", () => {
        for (const from of ["queued", "uploading", "extracting", "ocr", "indexing"]) {
            expect(canDocumentJobTransition(from, "failed")).toBe(true);
            expect(canDocumentJobTransition(from, "cancelled")).toBe(true);
        }
    });

    it("terminal states are terminal", () => {
        for (const t of ["ready", "failed", "cancelled"]) {
            expect(isDocumentJobTerminal(t)).toBe(true);
            for (const to of ["queued", "uploading", "extracting", "ready"]) {
                if (t === "failed" && to === "queued") continue; // retry allowed
                expect(canDocumentJobTransition(t, to)).toBe(false);
            }
        }
    });

    it("failed → queued is the only retry path", () => {
        expect(canDocumentJobTransition("failed", "queued")).toBe(true);
        expect(canDocumentJobTransition("cancelled", "queued")).toBe(false);
    });

    it("assertDocumentJobTransition throws typed error on invalid", () => {
        expect(() => assertDocumentJobTransition("ready", "uploading")).toThrow(
            InvalidDocumentJobTransition,
        );
        try {
            assertDocumentJobTransition("ready", "uploading");
        } catch (err) {
            expect(err).toBeInstanceOf(InvalidDocumentJobTransition);
            const e = err as InvalidDocumentJobTransition;
            expect(e.from).toBe("ready");
            expect(e.to).toBe("uploading");
        }
    });
});
