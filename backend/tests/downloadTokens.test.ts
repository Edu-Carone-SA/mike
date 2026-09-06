import { describe, it, expect, beforeAll } from "vitest";
import {
    signDownload,
    verifyDownload,
} from "../src/lib/downloadTokens";

process.env.DOWNLOAD_SIGNING_SECRET = "test-secret-sprint4";

describe("downloadTokens (Sprint 4)", () => {
    it("round-trips a token without expiry (legacy links keep working)", () => {
        const token = signDownload("documents/u1/d1/file.docx", "file.docx");
        const info = verifyDownload(token);
        expect(info).not.toBeNull();
        expect(info!.path).toBe("documents/u1/d1/file.docx");
        expect(info!.filename).toBe("file.docx");
        expect(info!.expired).toBeUndefined();
    });

    it("unexpired short-lived token verifies", () => {
        const token = signDownload("p", "f.docx", { expiresInSeconds: 300 });
        const info = verifyDownload(token);
        expect(info).not.toBeNull();
        expect(info!.expired).toBeUndefined();
    });

    it("expired token reports expired (route maps it to 410)", () => {
        const token = signDownload("p", "f.docx", { expiresInSeconds: -1 });
        const info = verifyDownload(token);
        expect(info).not.toBeNull();
        expect(info!.expired).toBe(true);
    });

    it("tampered token is rejected", () => {
        const token = signDownload("p", "f.docx");
        const parts = token.split(".");
        const tampered = `${parts[0].slice(0, -1)}x.${parts[1]}`;
        expect(verifyDownload(tampered)).toBeNull();
    });
});
