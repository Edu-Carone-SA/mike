import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { randomFillSync } from "crypto";
import { requireAuth, requireAdmin } from "../middleware/auth";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

/**
 * Create a Supabase admin client using service-role key.
 */
function createAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

/**
 * Log an admin action to the audit log.
 */
async function logAdminAction(
  admin: ReturnType<typeof createAdminClient>,
  actorId: string,
  actorEmail: string,
  action: string,
  targetId?: string,
  targetEmail?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("admin_audit_log").insert({
      actor_id: actorId,
      actor_email: actorEmail,
      action,
      target_id: targetId ?? null,
      target_email: targetEmail ?? null,
      details: details ?? null,
    });
  } catch {
    // Audit logging is best-effort; don't fail the request
  }
}

/**
 * Generate a strong temporary password.
 */
function generateTempPassword(): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  const length = 24;
  const random = new Uint8Array(length);
  randomFillSync(random);
  return Array.from(random)
    .map((b) => chars[b % chars.length])
    .join("");
}

// GET /admin/users — List all users
adminRouter.get("/users", async (req, res) => {
  const admin = createAdminClient();

  // Get users from GoTrue admin API
  const { data: authData, error: authError } =
    await admin.auth.admin.listUsers();

  if (authError) {
    return res.status(500).json({ detail: authError.message });
  }

  // Get profiles from user_profiles
  const { data: profiles, error: profileError } = await admin
    .from("user_profiles")
    .select(
      "user_id, email, role, status, created_at, updated_at, last_login_at, disabled_at",
    );

  if (profileError) {
    return res.status(500).json({ detail: profileError.message });
  }

  const profileMap = new Map(
    (profiles ?? []).map((p: { user_id: string }) => [p.user_id, p]),
  );

  const users = (authData.users ?? []).map((u) => {
    const profile = profileMap.get(u.id) as Record<string, unknown> | undefined;
    return {
      id: u.id,
      email: u.email ?? "",
      role: (profile?.role as string) ?? "member",
      status: (profile?.status as string) ?? "active",
      createdAt: u.created_at,
      lastLoginAt:
        (profile?.last_login_at as string) ?? u.last_sign_in_at ?? null,
      disabledAt: (profile?.disabled_at as string) ?? null,
    };
  });

  return res.json({ users });
});

// POST /admin/users — Create a new user
adminRouter.post("/users", async (req, res) => {
  const { email, role } = req.body as { email?: string; role?: string };

  if (!email || !email.includes("@")) {
    return res.status(400).json({ detail: "Valid email is required" });
  }

  if (role && !["admin", "member"].includes(role)) {
    return res.status(400).json({ detail: "Role must be 'admin' or 'member'" });
  }

  const admin = createAdminClient();
  const actorId = res.locals.userId as string;
  const actorEmail = res.locals.userEmail as string;
  const tempPassword = generateTempPassword();

  // Create user via GoTrue admin API
  const { data: newUser, error: createError } =
    await admin.auth.admin.createUser({
      email: email.toLowerCase(),
      password: tempPassword,
      email_confirm: true,
    });

  if (createError) {
    return res.status(400).json({
      detail: createError.message,
      code: createError.name,
    });
  }

  if (!newUser.user) {
    return res.status(500).json({ detail: "Failed to create user" });
  }

  // Create or update profile with role
  const { error: profileError } = await admin
    .from("user_profiles")
    .upsert(
      {
        user_id: newUser.user.id,
        email: email.toLowerCase(),
        role: role ?? "member",
        status: "active",
        created_by: actorId,
      },
      { onConflict: "user_id" },
    );

  if (profileError) {
    return res.status(500).json({
      detail: `User created but profile setup failed: ${profileError.message}`,
    });
  }

  await logAdminAction(
    admin,
    actorId,
    actorEmail,
    "create_user",
    newUser.user.id,
    email,
    { role: role ?? "member" },
  );

  return res.status(201).json({
    id: newUser.user.id,
    email: newUser.user.email,
    role: role ?? "member",
    status: "active",
    tempPassword,
  });
});

// PATCH /admin/users/:id/role — Change user role
adminRouter.patch("/users/:id/role", async (req, res) => {
  const { id } = req.params;
  const { role } = req.body as { role?: string };

  if (!role || !["admin", "member"].includes(role)) {
    return res.status(400).json({ detail: "Role must be 'admin' or 'member'" });
  }

  const admin = createAdminClient();
  const actorId = res.locals.userId as string;
  const actorEmail = res.locals.userEmail as string;

  // Prevent self-demotion (last admin safety)
  if (id === actorId && role === "member") {
    return res
      .status(400)
      .json({ detail: "Use another admin to demote yourself" });
  }

  const { data, error } = await admin
    .from("user_profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("user_id", id)
    .select("email")
    .maybeSingle();

  if (error) {
    return res.status(500).json({ detail: error.message });
  }

  await logAdminAction(admin, actorId, actorEmail, "change_role", id, data?.email, { role });

  return res.json({ id, role });
});

// PATCH /admin/users/:id/disable — Disable user
adminRouter.patch("/users/:id/disable", async (req, res) => {
  const { id } = req.params;
  const admin = createAdminClient();
  const actorId = res.locals.userId as string;
  const actorEmail = res.locals.userEmail as string;

  if (id === actorId) {
    return res.status(400).json({ detail: "Cannot disable your own account" });
  }

  const { data, error } = await admin
    .from("user_profiles")
    .update({
      status: "disabled",
      disabled_at: new Date().toISOString(),
      disabled_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", id)
    .select("email")
    .maybeSingle();

  if (error) {
    return res.status(500).json({ detail: error.message });
  }

  // Ban the user in GoTrue to prevent login
  await admin.auth.admin.updateUserById(id, { ban_duration: "87600h" });

  await logAdminAction(admin, actorId, actorEmail, "disable_user", id, data?.email);

  return res.json({ id, status: "disabled" });
});

// PATCH /admin/users/:id/enable — Enable user
adminRouter.patch("/users/:id/enable", async (req, res) => {
  const { id } = req.params;
  const admin = createAdminClient();
  const actorId = res.locals.userId as string;
  const actorEmail = res.locals.userEmail as string;

  const { data, error } = await admin
    .from("user_profiles")
    .update({
      status: "active",
      disabled_at: null,
      disabled_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", id)
    .select("email")
    .maybeSingle();

  if (error) {
    return res.status(500).json({ detail: error.message });
  }

  // Unban the user in GoTrue
  await admin.auth.admin.updateUserById(id, { ban_duration: "none" });

  await logAdminAction(admin, actorId, actorEmail, "enable_user", id, data?.email);

  return res.json({ id, status: "active" });
});

// POST /admin/users/:id/reset-password — Reset user password
adminRouter.post("/users/:id/reset-password", async (req, res) => {
  const { id } = req.params;
  const admin = createAdminClient();
  const actorId = res.locals.userId as string;
  const actorEmail = res.locals.userEmail as string;
  const tempPassword = generateTempPassword();

  const { error } = await admin.auth.admin.updateUserById(id, {
    password: tempPassword,
  });

  if (error) {
    return res.status(400).json({ detail: error.message });
  }

  const { data: profile } = await admin
    .from("user_profiles")
    .select("email")
    .eq("user_id", id)
    .maybeSingle();

  await logAdminAction(
    admin,
    actorId,
    actorEmail,
    "reset_password",
    id,
    profile?.email,
  );

  return res.json({ id, tempPassword });
});

// POST /admin/users/:id/revoke-sessions — Revoke all sessions
adminRouter.post("/users/:id/revoke-sessions", async (req, res) => {
  const { id } = req.params;
  const admin = createAdminClient();
  const actorId = res.locals.userId as string;
  const actorEmail = res.locals.userEmail as string;

  const { error } = await admin.auth.admin.signOut(id);

  if (error) {
    return res.status(400).json({ detail: error.message });
  }

  const { data: profile } = await admin
    .from("user_profiles")
    .select("email")
    .eq("user_id", id)
    .maybeSingle();

  await logAdminAction(
    admin,
    actorId,
    actorEmail,
    "revoke_sessions",
    id,
    profile?.email,
  );

  return res.json({ id, sessionsRevoked: true });
});

// GET /admin/users/:id/audit — Get audit log for a specific user
adminRouter.get("/users/:id/audit", async (req, res) => {
  const { id } = req.params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("admin_audit_log")
    .select(
      "action, actor_email, target_email, details, created_at",
    )
    .or(`target_id.eq.${id},actor_id.eq.${id}`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return res.status(500).json({ detail: error.message });
  }

  return res.json({ entries: data ?? [] });
});
