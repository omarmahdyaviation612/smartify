import { UserRole } from "@smartify/shared-types";

export { UserRole };

// UI-level convenience only — real authorization always happens on the
// backend against the Postgres `role` column via RolesGuard.
export function canAccessAdminArea(role: UserRole | undefined): boolean {
  if (!role) return false;
  return [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.CONTENT_MANAGER, UserRole.SUPPORT].includes(role);
}
