import { Router } from "express";
import { optionalAuth, requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { buildContentDisposition, downloadFile } from "../lib/storage";
import { verifyDownload } from "../lib/downloadTokens";
import { ensureDocAccess } from "../lib/access";
import { contentTypeForDocumentType } from "../lib/documentTypes";

export const downloadsRouter = Router();

function contentTypeFor(filename: string): string {
    const suffix = filename.includes(".")
        ? filename.split(".").pop()?.toLowerCase()
        : "";
    return contentTypeForDocumentType(suffix);
}

// GET /download/:token
// QA DL-01 (NO-GO report): browser anchors and the UI Download menu cannot
// attach an Authorization header, so requireAuth made every handed-out
// link 401 ("Failed — Needs authorization"). The short-lived HMAC token
// is itself the authorization for this route: when the header IS present
// it is still validated (optionalAuth) so authenticated callers keep
// per-request authorization + audit; when absent the token must be valid
// and unexpired. Legacy non-expiring tokens (old chat history) keep
// working exactly as before.
downloadsRouter.get("/:token", optionalAuth, async (req, res) => {
    const userId = (res.locals.userId as string | undefined) ?? null;
    const userEmail = (res.locals.userEmail as string | undefined) ?? null;
    const info = verifyDownload(req.params.token);
    if (!info)
        return void res.status(404).json({ detail: "Invalid link" });
    // Sprint 4 — coherent status codes: an expired short-lived token is
    // 410 Gone (client should request a fresh link), never a bare 404.
    if (info.expired)
        return void res.status(410).json({ detail: "Link expired" });

    const db = createServerSupabase();
    let version:
        | {
              id: string;
              document_id: string;
          }
        | null = null;

    const { data: byStoragePath } = await db
        .from("document_versions")
        .select("id, document_id")
        .eq("storage_path", info.path)
        .is("deleted_at", null)
        .maybeSingle();
    if (byStoragePath) {
        version = byStoragePath as { id: string; document_id: string };
    }

    if (!version)
        return void res.status(404).json({ detail: "File not found" });

    const { data: doc } = await db
        .from("documents")
        .select("id, user_id, project_id")
        .eq("id", version.document_id)
        .single();
    if (!doc)
        return void res.status(404).json({ detail: "File not found" });

    // Per-request authorization when the caller is authenticated (API
    // clients, curl, the QA harness). Anonymous navigation (browser
    // anchor / Download menu) is authorized by the token itself, which is
    // only minted by an authenticated, access-checked call to
    // /single-documents/:id/url and lives ~5 minutes.
    if (userId) {
        const access = await ensureDocAccess(doc, userId, userEmail, db);
        if (!access.ok) {
            // Sprint 4 — audit denied downloads; 403 for authenticated
            // users without access (coherent with the API's model).
            console.log(
                `[download] event=denied file=${info.path.slice(0, 80)}` +
                    ` user_id=${userId} reason=no_access`,
            );
            return void res.status(403).json({ detail: "Access denied" });
        }
    }

    const raw = await downloadFile(info.path);
    if (!raw)
        return void res.status(404).json({ detail: "File not found" });

    console.log(
        `[download] event=delivered file=${info.path.slice(0, 80)}` +
            ` user_id=${userId ?? "anonymous"} document_id=${version.document_id}` +
            ` version_id=${version.id} bytes=${raw.byteLength}` +
            `${userId ? "" : " auth=token"}`,
    );
    res.setHeader("Content-Type", contentTypeFor(info.filename));
    res.setHeader(
        "Content-Disposition",
        buildContentDisposition("attachment", info.filename),
    );
    res.send(Buffer.from(raw));
});
