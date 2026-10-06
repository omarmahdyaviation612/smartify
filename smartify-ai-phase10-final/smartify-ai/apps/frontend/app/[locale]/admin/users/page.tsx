"use client";

import { useEffect, useState } from "react";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { useApiClient } from "@/lib/api-client";
import { useCurrentUser } from "@/lib/use-current-user";

interface AdminUser {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  isTestStudent: boolean;
  createdAt: string;
}

const ROLES = ["SUPER_ADMIN", "ADMIN", "CONTENT_MANAGER", "SUPPORT", "TEACHER", "PARENT", "STUDENT"];

function UsersTable() {
  const { apiFetch } = useApiClient();
  const { user: me } = useCurrentUser();
  const canEditRoles = me?.role === "SUPER_ADMIN" || me?.role === "ADMIN";

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatingTestAccess, setUpdatingTestAccess] = useState<string | null>(null);

  async function updateTestAccess(u: AdminUser) {
    setUpdatingTestAccess(u.id);
    try {
      const updated = await apiFetch<{ isTestStudent: boolean }>(`/users/${u.id}/test-access`, { method: "PATCH", body: JSON.stringify({ enabled: !u.isTestStudent }) });
      setUsers(prev => prev?.map(row => row.id === u.id ? { ...row, isTestStudent: updated.isTestStudent } : row) ?? null);
    } catch { setError("Couldn't update student test access."); }
    finally { setUpdatingTestAccess(null); }
  }

  useEffect(() => {
    apiFetch<AdminUser[]>("/users")
      .then(setUsers)
      .catch(() => setError("Couldn't load users."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateRole(id: string, role: string) {
    try {
      await apiFetch(`/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
      setUsers((prev) => prev?.map((u) => (u.id === id ? { ...u, role } : u)) ?? null);
    } catch {
      setError("Couldn't update role.");
    }
  }

  if (error) return <p className="mt-6 text-sm text-error-500">{error}</p>;
  if (!users) return <p className="mt-6 text-neutral-500">Loading...</p>;

  return (
    <div className="mt-6 overflow-x-auto rounded-sf-lg border border-neutral-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-start">
          <tr>
            <th className="px-4 py-3 text-start font-medium text-neutral-500">Email</th>
            <th className="px-4 py-3 text-start font-medium text-neutral-500">Role</th>
            <th className="px-4 py-3 text-start font-medium text-neutral-500">Active</th>
            <th className="px-4 py-3 text-start font-medium text-neutral-500">Joined</th>
            <th className="px-4 py-3 text-start font-medium text-neutral-500">Student test access</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-neutral-100 last:border-0">
              <td className="px-4 py-3 text-navy-900">{u.email}</td>
              <td className="px-4 py-3">
                {canEditRoles ? (
                  <select
                    value={u.role}
                    onChange={(e) => updateRole(u.id, e.target.value)}
                    className="rounded-sf border border-neutral-300 bg-white px-2 py-1 text-xs"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-neutral-600">{u.role}</span>
                )}
              </td>
              <td className="px-4 py-3 text-neutral-500">{u.isActive ? "Yes" : "No"}</td>
              <td className="px-4 py-3 text-neutral-500">{new Date(u.createdAt).toLocaleDateString()}</td>
              <td className="px-4 py-3 text-neutral-500">
                {u.role === "STUDENT" ? (me?.role === "SUPER_ADMIN" && u.isActive ?
                  <button type="button" disabled={updatingTestAccess !== null} onClick={() => updateTestAccess(u)} className="rounded-sf border border-neutral-300 px-3 py-1" aria-label={`${u.isTestStudent ? "Disable" : "Enable"} test access for ${u.email}`}>
                    {u.isTestStudent ? "Enabled — disable" : "Disabled — enable"}
                  </button> : u.isTestStudent ? "Enabled" : "Disabled") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN", "SUPPORT"]}>
      <main className="py-12">
        <SmartifyContainer>
          <h1 className="text-2xl font-bold text-navy-900">Users</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Support can view accounts; only Super Admin and Admin can change roles.
          </p>
          <UsersTable />
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
