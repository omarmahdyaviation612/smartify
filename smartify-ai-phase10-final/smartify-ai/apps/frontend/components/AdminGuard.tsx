"use client";

import type { ReactNode } from "react";
import { useCurrentUser } from "@/lib/use-current-user";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  CONTENT_MANAGER: "Content Manager",
  SUPPORT: "Support",
};

/**
 * UX-only gate: shows children if the signed-in user's role is in
 * `allowedRoles`, otherwise a plain "not authorized" message. The actual
 * security boundary is server-side (RolesGuard on every /admin/* route) —
 * this component only prevents a confusing flash of admin UI for people
 * who'd get a 403 from the backend anyway.
 */
export function AdminGuard({ allowedRoles, children }: { allowedRoles: string[]; children: ReactNode }) {
  const { user, loading } = useCurrentUser();

  if (loading) return <div className="p-12 text-center text-neutral-400">Loading...</div>;

  if (!user || !allowedRoles.includes(user.role)) {
    return (
      <div className="p-12 text-center text-neutral-500">
        You don&apos;t have access to this page.
        {user && (
          <p className="mt-1 text-xs text-neutral-400">
            Signed in as {ROLE_LABELS[user.role] ?? user.role}. This page requires:{" "}
            {allowedRoles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}.
          </p>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
