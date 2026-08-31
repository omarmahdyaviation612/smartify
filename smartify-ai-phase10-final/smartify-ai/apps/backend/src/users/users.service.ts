import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UserRole } from "@smartify/shared-types";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.client.user.findUnique({ where: { id } });
  }

  findAll() {
    return this.prisma.client.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Phase 10 hardening: closes a privilege-escalation gap. Previously,
   * ANY caller with role ADMIN (not just SUPER_ADMIN) could call this
   * with an arbitrary target role — including granting themselves or
   * anyone else SUPER_ADMIN, since RolesGuard only checked that the
   * CALLER was ADMIN-or-above, never what role they were trying to GRANT
   * or MODIFY. Now enforced:
   *   - Only SUPER_ADMIN can grant or revoke the SUPER_ADMIN role.
   *   - Only SUPER_ADMIN can change the role of an existing SUPER_ADMIN
   *     (an ADMIN cannot demote a SUPER_ADMIN either).
   *   - No caller can change their own role through this endpoint, full
   *     stop — removes any self-escalation path entirely, including the
   *     otherwise-legitimate-looking "ADMIN promotes themselves to
   *     ADMIN again with different metadata" class of confusion.
   */
  async updateRole(actorId: string, actorRole: UserRole, targetUserId: string, newRole: UserRole) {
    if (actorId === targetUserId) {
      throw new ForbiddenException("You cannot change your own role.");
    }

    const target = await this.prisma.client.user.findUnique({ where: { id: targetUserId } });
    if (!target) {
      throw new ForbiddenException("User not found.");
    }

    const touchesSuperAdmin = newRole === UserRole.SUPER_ADMIN || target.role === UserRole.SUPER_ADMIN;
    if (touchesSuperAdmin && actorRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException("Only a Super Admin can grant or modify the Super Admin role.");
    }

    const updated = await this.prisma.client.user.update({
      where: { id: targetUserId },
      data: { role: newRole },
    });

    await this.prisma.client.auditLog.create({
      data: {
        userId: targetUserId,
        action: "ROLE_UPDATED",
        entityType: "User",
        entityId: targetUserId,
        metadata: { newRole, previousRole: target.role, changedBy: actorId },
      },
    });

    return updated;
  }
}
