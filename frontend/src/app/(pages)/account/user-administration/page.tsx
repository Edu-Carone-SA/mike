"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Shield, UserPlus, KeyRound, Ban, CheckCircle, LogOut, Copy, Check } from "lucide-react";
import {
    listAdminUsers,
    createAdminUser,
    changeUserRole,
    disableUser,
    enableUser,
    resetUserPassword,
    revokeUserSessions,
    type AdminUser,
} from "@/app/lib/mikeApi";
import { useUserProfile } from "@/app/contexts/UserProfileContext";

export default function UserAdministrationPage() {
    const { profile } = useUserProfile();
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [newEmail, setNewEmail] = useState("");
    const [newRole, setNewRole] = useState("member");
    const [tempPasswordInfo, setTempPasswordInfo] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const loadUsers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await listAdminUsers();
            setUsers(data.users);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load users");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (profile?.role === "admin") {
            loadUsers();
        }
    }, [profile?.role, loadUsers]);

    const handleCreate = async () => {
        if (!newEmail.trim()) return;
        setActionLoading("create");
        setError(null);
        try {
            const result = await createAdminUser(newEmail.trim(), newRole);
            setTempPasswordInfo(
                `User created: ${result.email}\nTemp password: ${result.tempPassword}`,
            );
            setNewEmail("");
            setNewRole("member");
            setShowCreate(false);
            await loadUsers();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to create user");
        } finally {
            setActionLoading(null);
        }
    };

    const handleRoleChange = async (id: string, role: string) => {
        setActionLoading(`role-${id}`);
        try {
            await changeUserRole(id, role);
            setUsers((prev) =>
                prev.map((u) => (u.id === id ? { ...u, role } : u)),
            );
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to change role");
        } finally {
            setActionLoading(null);
        }
    };

    const handleDisable = async (id: string) => {
        setActionLoading(`disable-${id}`);
        try {
            await disableUser(id);
            setUsers((prev) =>
                prev.map((u) =>
                    u.id === id ? { ...u, status: "disabled" } : u,
                ),
            );
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to disable user");
        } finally {
            setActionLoading(null);
        }
    };

    const handleEnable = async (id: string) => {
        setActionLoading(`enable-${id}`);
        try {
            await enableUser(id);
            setUsers((prev) =>
                prev.map((u) =>
                    u.id === id ? { ...u, status: "active" } : u,
                ),
            );
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to enable user");
        } finally {
            setActionLoading(null);
        }
    };

    const handleResetPassword = async (id: string, email: string) => {
        setActionLoading(`reset-${id}`);
        try {
            const result = await resetUserPassword(id);
            setTempPasswordInfo(
                `Password reset for: ${email}\nNew temp password: ${result.tempPassword}`,
            );
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to reset password");
        } finally {
            setActionLoading(null);
        }
    };

    const handleRevokeSessions = async (id: string) => {
        setActionLoading(`revoke-${id}`);
        try {
            await revokeUserSessions(id);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to revoke sessions");
        } finally {
            setActionLoading(null);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (profile && profile.role !== "admin") {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center">
                    <Shield className="mx-auto h-12 w-12 text-gray-400" />
                    <p className="mt-4 text-lg text-gray-600">
                        Admin access required
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-medium">User Administration</h2>
                    <p className="text-sm text-gray-500">
                        Manage users, roles, and access
                    </p>
                </div>
                <button
                    onClick={() => setShowCreate(!showCreate)}
                    className="flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                    <UserPlus className="h-4 w-4" />
                    Add User
                </button>
            </div>

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {tempPasswordInfo && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                        <pre className="whitespace-pre-wrap text-sm text-amber-900">
                            {tempPasswordInfo}
                        </pre>
                        <button
                            onClick={() => copyToClipboard(tempPasswordInfo)}
                            className="shrink-0"
                        >
                            {copied ? (
                                <Check className="h-4 w-4 text-green-600" />
                            ) : (
                                <Copy className="h-4 w-4 text-gray-500" />
                            )}
                        </button>
                    </div>
                    <button
                        onClick={() => setTempPasswordInfo(null)}
                        className="mt-2 text-xs text-amber-700 underline"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {showCreate && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <h3 className="text-sm font-medium">Create New User</h3>
                    <div className="mt-3 flex gap-3">
                        <input
                            type="email"
                            placeholder="user@atlasgov.com"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                        <select
                            value={newRole}
                            onChange={(e) => setNewRole(e.target.value)}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                        </select>
                        <button
                            onClick={handleCreate}
                            disabled={actionLoading === "create" || !newEmail.trim()}
                            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                            {actionLoading === "create" ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                "Create"
                            )}
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                                <th className="pb-2 pr-4">Email</th>
                                <th className="pb-2 pr-4">Role</th>
                                <th className="pb-2 pr-4">Status</th>
                                <th className="pb-2 pr-4">Last Login</th>
                                <th className="pb-2 pr-4">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((user) => (
                                <tr
                                    key={user.id}
                                    className="border-b border-gray-100"
                                >
                                    <td className="py-3 pr-4 font-medium">
                                        {user.email}
                                    </td>
                                    <td className="py-3 pr-4">
                                        <select
                                            value={user.role}
                                            onChange={(e) =>
                                                handleRoleChange(
                                                    user.id,
                                                    e.target.value,
                                                )
                                            }
                                            disabled={
                                                actionLoading ===
                                                `role-${user.id}`
                                            }
                                            className="rounded border border-gray-300 px-2 py-1 text-xs"
                                        >
                                            <option value="member">
                                                Member
                                            </option>
                                            <option value="admin">
                                                Admin
                                            </option>
                                        </select>
                                    </td>
                                    <td className="py-3 pr-4">
                                        {user.status === "active" ? (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                                                <CheckCircle className="h-3 w-3" />
                                                Active
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                                                <Ban className="h-3 w-3" />
                                                Disabled
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-3 pr-4 text-xs text-gray-500">
                                        {user.lastLoginAt
                                            ? new Date(
                                                  user.lastLoginAt,
                                              ).toLocaleDateString()
                                            : "Never"}
                                    </td>
                                    <td className="py-3 pr-4">
                                        <div className="flex gap-1">
                                            {user.status === "active" ? (
                                                <button
                                                    onClick={() =>
                                                        handleDisable(user.id)
                                                    }
                                                    disabled={
                                                        actionLoading ===
                                                        `disable-${user.id}`
                                                    }
                                                    title="Disable user"
                                                    className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
                                                >
                                                    <Ban className="h-4 w-4" />
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() =>
                                                        handleEnable(user.id)
                                                    }
                                                    disabled={
                                                        actionLoading ===
                                                        `enable-${user.id}`
                                                    }
                                                    title="Enable user"
                                                    className="rounded p-1 text-gray-500 hover:bg-green-50 hover:text-green-600"
                                                >
                                                    <CheckCircle className="h-4 w-4" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() =>
                                                    handleResetPassword(
                                                        user.id,
                                                        user.email,
                                                    )
                                                }
                                                disabled={
                                                    actionLoading ===
                                                    `reset-${user.id}`
                                                }
                                                title="Reset password"
                                                className="rounded p-1 text-gray-500 hover:bg-amber-50 hover:text-amber-600"
                                            >
                                                <KeyRound className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={() =>
                                                    handleRevokeSessions(
                                                        user.id,
                                                    )
                                                }
                                                disabled={
                                                    actionLoading ===
                                                    `revoke-${user.id}`
                                                }
                                                title="Revoke sessions"
                                                className="rounded p-1 text-gray-500 hover:bg-purple-50 hover:text-purple-600"
                                            >
                                                <LogOut className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
