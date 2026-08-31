import { SetMetadata } from "@nestjs/common";
import { UserRole } from "@smartify/shared-types";

export const ROLES_KEY = "roles";

/**
 * Marks an endpoint as requiring one of the given roles.
 * Authorization is always evaluated against the local `role` column
 * (see RolesGuard) — never against anything from the auth provider.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
