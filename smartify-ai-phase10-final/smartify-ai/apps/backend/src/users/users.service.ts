import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UserRole } from "@smartify/shared-types";
import { randomUUID } from "crypto";

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

  async setTestStudentAccess(actorId: string, actorRole: UserRole, targetUserId: string, enabled: boolean) {
    if (actorRole !== UserRole.SUPER_ADMIN || actorId === targetUserId) throw new ForbiddenException("Only a Super Admin may configure student test access.");
    return this.prisma.client.$transaction(async tx => {
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target || target.role !== "STUDENT" || !target.isActive || target.deletedAt) throw new ForbiddenException("Test access applies only to active student accounts.");
      const updated = await tx.user.update({ where: { id: targetUserId }, data: { isTestStudent: enabled } });
      await tx.auditLog.create({ data: { userId: actorId, action: "TEST_STUDENT_ACCESS_UPDATED", entityType: "User", entityId: targetUserId,
        metadata: { enabled, previousValue: target.isTestStudent, changedBy: actorId } } });
      return { id: updated.id, isTestStudent: updated.isTestStudent };
    });
  }

  async startStudentPreview(actorId: string, actorRole: UserRole, targetUserId: string) {
    if (![UserRole.SUPER_ADMIN, UserRole.ADMIN].includes(actorRole) || actorId === targetUserId) {
      throw new ForbiddenException("Only an administrator can preview a separate test student account.");
    }
    return this.prisma.client.$transaction(async (tx) => {
      const sessionId = randomUUID();
      const target = await tx.user.findUnique({ where: { id: targetUserId }, include: { studentProfile: { select: { id: true, fullName: true } } } });
      if (!target || target.role !== "STUDENT" || !target.isActive || target.deletedAt || !target.isTestStudent || !target.studentProfile) {
        throw new ForbiddenException("Student preview is limited to active accounts enabled for testing.");
      }
      await tx.auditLog.create({ data: { userId: actorId, action: "STUDENT_TEST_PREVIEW_STARTED", entityType: "User", entityId: targetUserId,
        metadata: { sessionId, targetUserId, targetProfileId: target.studentProfile.id } } });
      return { sessionId, studentId: target.id, studentName: target.studentProfile.fullName };
    });
  }

  async stopStudentPreview(actorId: string, actorRole: UserRole, targetUserId: string, sessionId: string) {
    if (![UserRole.SUPER_ADMIN, UserRole.ADMIN].includes(actorRole) || actorId === targetUserId) {
      throw new ForbiddenException("Only an administrator can end a student preview.");
    }
    const started = await this.prisma.client.auditLog.findFirst({ where: { userId: actorId, action: "STUDENT_TEST_PREVIEW_STARTED", entityId: targetUserId,
      metadata: { path: ["sessionId"], equals: sessionId } }, select: { id: true } });
    const alreadyEnded = await this.prisma.client.auditLog.findFirst({ where: { userId: actorId, action: "STUDENT_TEST_PREVIEW_ENDED",
      metadata: { path: ["sessionId"], equals: sessionId } }, select: { id: true } });
    if (!started || alreadyEnded) throw new ForbiddenException("This student preview session is not active.");
    await this.prisma.client.auditLog.create({ data: { userId: actorId, action: "STUDENT_TEST_PREVIEW_ENDED", entityType: "User", entityId: targetUserId,
      metadata: { targetUserId, sessionId } } });
    return { ok: true };
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
