import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { randomFillSync } from "crypto";
import { requireAuth, requireAdmin } from "../middleware/auth";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

function createAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

async function logAdminAction(
  admin: any,
  actorId: string,
  actorEmail: string,
  action: string,
  targetId?: string,
  targetEmail?: string,
  previousValue?: string,
  newValue?: string,
): Promise<void> {
  try {
    await admin.from("admin_audit_log").insert({
      actor_id: actorId,
      actor_email: actorEmail,
      action,
      target_id: targetId ?? null,
      target_email: targetEmail ?? null,
      previous_value: previousValue ?? null,
      new_value: newValue ?? null,
    });
  } catch {
    // Best-effort
  }
}

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

/**
 * Count active admins. Used for last-admin protection.
 */
async function countActiveAdmins(admin: any): Promise<number> {
  const { count, error } = await admin
    .from("user_profiles")
    .select("user_id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("status", "active");

  if (error) return 0;
  return count ?? 0;
}

// GET /admin/users — List all users
adminRouter.get("/users", async (_req, res) => {
  const admin = createAdminClient();

  const { data: authData, error: authError } =
    await admin.auth.admin.listUsers();

  if (authError) {
    return res.status(500).json({ detail: authError.message });
  }

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
    "admin_user_created",
    newUser.user.id,
    email,
    undefined,
    role ?? "member",
  );

  // Return user object + temporaryPassword (one-time only)
  return res.status(201).json({
    user: {
      id: newUser.user.id,
      email: newUser.user.email,
      role: role ?? "member",
      status: "active",
    },
    temporaryPassword: tempPassword,
  });
});

// PATCH /admin/users/:userId/role — Change user role
adminRouter.patch("/users/:userId/role", async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body as { role?: string };

  if (!role || !["admin", "member"].includes(role)) {
    return res.status(400).json({ detail: "Role must be 'admin' or 'member'" });
  }

  const admin = createAdminClient();
  const actorId = res.locals.userId as string;
  const actorEmail = res.locals.userEmail as string;

  // Fetch current profile to get previous role
  const { data: currentProfile } = await admin
    .from("user_profiles")
    .select("role, status, email")
    .eq("user_id", userId)
    .maybeSingle();

  if (!currentProfile) {
    return res.status(404).json({ detail: "User not found" });
  }

  // Last admin protection: if demoting an admin, check there are other active admins
  if (currentProfile.role === "admin" && role === "member") {
    const adminCount = await countActiveAdmins(admin);
    if (adminCount <= 1) {
      return res.status(409).json({
        code: "LAST_ADMIN_REQUIRED",
        detail: "Cannot demote the last active admin",
      });
    }
  }

  const { error } = await admin
    .from("user_profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error) {
    return res.status(500).json({ detail: error.message });
  }

  await logAdminAction(
    admin,
    actorId,
    actorEmail,
    "admin_user_role_changed",
    userId,
    currentProfile.email,
    currentProfile.role,
    role,
  );

  return res.json({
    user: { id: userId, role },
  });
});

// POST /admin/users/:userId/disable — Block user
adminRouter.post("/users/:userId/disable", async (req, res) => {
  const { userId } = req.params;
  const admin = createAdminClient();
  const actorId = res.locals.userId as string;
  const actorEmail = res.locals.userEmail as string;

  // Self-disable protection
  if (userId === actorId) {
    return res.status(409).json({
      code: "CANNOT_DISABLE_SELF",
      detail: "Cannot disable your own account",
    });
  }

  // Fetch current profile
  const { data: currentProfile } = await admin
    .from("user_profiles")
    .select("role, status, email")
    .eq("user_id", userId)
    .maybeSingle();

  if (!currentProfile) {
    return res.status(404).json({ detail: "User not found" });
  }

  // Last admin protection
  if (currentProfile.role === "admin" && currentProfile.status === "active") {
    const adminCount = await countActiveAdmins(admin);
    if (adminCount <= 1) {
      return res.status(409).json({
        code: "LAST_ADMIN_REQUIRED",
        detail: "Cannot disable the last active admin",
      });
    }
  }

  const { error } = await admin
    .from("user_profiles")
    .update({
      status: "disabled",
      disabled_at: new Date().toISOString(),
      disabled_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    return res.status(500).json({ detail: error.message });
  }

  // Ban in GoTrue + revoke sessions
  await admin.auth.admin.updateUserById(userId, { ban_duration: "87600h" });
  try {
    await admin.auth.admin.signOut(userId);
  } catch {
    // Best-effort
  }

  await logAdminAction(
    admin,
    actorId,
    actorEmail,
    "admin_user_disabled",
    userId,
    currentProfile.email,
  );

  return res.json({
    user: { id: userId, status: "disabled" },
  });
});

// POST /admin/users/:userId/enable — Reactivate user
adminRouter.post("/users/:userId/enable", async (req, res) => {
  const { userId } = req.params;
  const admin = createAdminClient();
  const actorId = res.locals.userId as string;
  const actorEmail = res.locals.userEmail as string;

  const { data: currentProfile } = await admin
    .from("user_profiles")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();

  if (!currentProfile) {
    return res.status(404).json({ detail: "User not found" });
  }

  const { error } = await admin
    .from("user_profiles")
    .update({
      status: "active",
      disabled_at: null,
      disabled_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    return res.status(500).json({ detail: error.message });
  }

  // Unban in GoTrue
  await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });

  await logAdminAction(
    admin,
    actorId,
    actorEmail,
    "admin_user_enabled",
    userId,
    currentProfile.email,
  );

  return res.json({
    user: { id: userId, status: "active" },
  });
});

// POST /admin/users/:userId/revoke-sessions — Revoke all sessions
adminRouter.post("/users/:userId/revoke-sessions", async (req, res) => {
  const { userId } = req.params;
  const admin = createAdminClient();
  const actorId = res.locals.userId as string;
  const actorEmail = res.locals.userEmail as string;

  const { data: currentProfile } = await admin
    .from("user_profiles")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();

  if (!currentProfile) {
    return res.status(404).json({ detail: "User not found" });
  }

  const { error } = await admin.auth.admin.signOut(userId);

  if (error) {
    return res.status(400).json({ detail: error.message });
  }

  await logAdminAction(
    admin,
    actorId,
    actorEmail,
    "admin_user_sessions_revoked",
    userId,
    currentProfile.email,
  );

  return res.json({ revoked: true });
});

// POST /admin/users/:userId/reset-password — Reset password
adminRouter.post("/users/:userId/reset-password", async (req, res) => {
  const { userId } = req.params;
  const admin = createAdminClient();
  const actorId = res.locals.userId as string;
  const actorEmail = res.locals.userEmail as string;
  const tempPassword = generateTempPassword();

  const { data: currentProfile } = await admin
    .from("user_profiles")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();

  if (!currentProfile) {
    return res.status(404).json({ detail: "User not found" });
  }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });

  if (error) {
    return res.status(400).json({ detail: error.message });
  }

  // Revoke sessions so old tokens stop working
  try {
    await admin.auth.admin.signOut(userId);
  } catch {
    // Best-effort
  }

  await logAdminAction(
    admin,
    actorId,
    actorEmail,
    "admin_user_password_reset",
    userId,
    currentProfile.email,
  );

  // Return temp password one-time only
  return res.json({
    user: { id: userId, email: currentProfile.email },
    temporaryPassword: tempPassword,
  });
});

// GET /admin/users/:userId/audit — Get audit log for a user
adminRouter.get("/users/:userId/audit", async (req, res) => {
  const { userId } = req.params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("admin_audit_log")
    .select("action, actor_email, target_email, details, created_at")
    .or(`target_id.eq.${userId},actor_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return res.status(500).json({ detail: error.message });
  }

  return res.json({ entries: data ?? [] });
});
