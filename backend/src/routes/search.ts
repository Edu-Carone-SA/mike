import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { listAccessibleProjectIds } from "../lib/access";

export const searchRouter = Router();

/**
 * GET /search?q=<query>
 * Global search across chats, projects, and documents.
 * Returns results grouped by type, scoped to the authenticated user's
 * accessible resources.
 */
searchRouter.get("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
        return res.json({ chats: [], projects: [], documents: [] });
    }

    const db = createServerSupabase();
    const accessibleProjectIds = await listAccessibleProjectIds(
        userId,
        userEmail,
        db,
    );

    // Search chats by title (ilike)
    const { data: chats } = await db
        .from("chats")
        .select("id, title, project_id, created_at, updated_at")
        .eq("user_id", userId)
        .ilike("title", `%${q}%`)
        .order("updated_at", { ascending: false })
        .limit(20);

    // Search projects by name (ilike) — only user's own + shared
    const projectFilter = accessibleProjectIds.length
        ? accessibleProjectIds
        : ["00000000-0000-0000-0000-000000000000"]; // no matches if empty

    const { data: projects } = await db
        .from("projects")
        .select("id, name, created_at, updated_at")
        .in("id", projectFilter)
        .ilike("name", `%${q}%`)
        .order("updated_at", { ascending: false })
        .limit(20);

    // Search documents by filename (ilike) — only in accessible projects
    // or standalone docs owned by the user
    const { data: projectDocs } = accessibleProjectIds.length
        ? await db
              .from("documents")
              .select("id, filename, project_id, created_at, updated_at")
              .in("project_id", accessibleProjectIds)
              .ilike("filename", `%${q}%`)
              .order("updated_at", { ascending: false })
              .limit(20)
        : { data: [] };

    const { data: standaloneDocs } = await db
        .from("documents")
        .select("id, filename, project_id, created_at, updated_at")
        .eq("user_id", userId)
        .is("project_id", null)
        .ilike("filename", `%${q}%`)
        .order("updated_at", { ascending: false })
        .limit(20);

    // Merge and deduplicate documents
    type DocRow = {
        id: string;
        filename: string;
        project_id: string | null;
        created_at: string;
        updated_at: string;
    };
    const docMap = new Map<string, DocRow>();
    for (const d of (projectDocs ?? []) as DocRow[]) docMap.set(d.id, d);
    for (const d of (standaloneDocs ?? []) as DocRow[]) docMap.set(d.id, d);
    const documents = [...docMap.values()]
        .sort(
            (a, b) =>
                Date.parse(b.updated_at || b.created_at) -
                Date.parse(a.updated_at || a.created_at),
        )
        .slice(0, 20);

    res.json({
        chats: chats ?? [],
        projects: projects ?? [],
        documents,
    });
});