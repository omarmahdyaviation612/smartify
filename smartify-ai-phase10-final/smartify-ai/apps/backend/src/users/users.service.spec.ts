import { ForbiddenException } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UserRole } from "@smartify/shared-types";

/**
 * Covers the Phase 10 privilege-escalation fix: before this phase, any
 * caller with role ADMIN could grant SUPER_ADMIN to anyone (including
 * themselves) through PATCH /users/:id/role, since RolesGuard only
 * checked the CALLER's role, never what role was being granted.
 */
describe("UsersService.updateRole — privilege escalation protection", () => {
  function makePrismaMock(targetUser: { id: string; role: UserRole }) {
    return {
      client: {
        user: {
          findUnique: jest.fn().mockResolvedValue(targetUser),
          update: jest.fn().mockResolvedValue({ ...targetUser }),
        },
        auditLog: { create: jest.fn() },
      },
    } as any;
  }

  it("rejects an ADMIN granting SUPER_ADMIN to another user", async () => {
    const prisma = makePrismaMock({ id: "target-1", role: UserRole.STUDENT });
    const service = new UsersService(prisma);

    await expect(
      service.updateRole("admin-actor", UserRole.ADMIN, "target-1", UserRole.SUPER_ADMIN),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects an ADMIN modifying the role of an EXISTING Super Admin (even to demote them)", async () => {
    const prisma = makePrismaMock({ id: "target-1", role: UserRole.SUPER_ADMIN });
    const service = new UsersService(prisma);

    await expect(
      service.updateRole("admin-actor", UserRole.ADMIN, "target-1", UserRole.STUDENT),
    ).rejects.toThrow(ForbiddenException);
  });

  it("allows a SUPER_ADMIN to grant SUPER_ADMIN to another user", async () => {
    const prisma = makePrismaMock({ id: "target-1", role: UserRole.STUDENT });
    const service = new UsersService(prisma);

    await expect(
      service.updateRole("super-admin-actor", UserRole.SUPER_ADMIN, "target-1", UserRole.SUPER_ADMIN),
    ).resolves.toBeDefined();
  });

  it("rejects a caller changing their own role, regardless of caller role", async () => {
    const prisma = makePrismaMock({ id: "self-1", role: UserRole.ADMIN });
    const service = new UsersService(prisma);

    await expect(
      service.updateRole("self-1", UserRole.ADMIN, "self-1", UserRole.SUPER_ADMIN),
    ).rejects.toThrow(ForbiddenException);
  });

  it("allows an ADMIN to change a non-Super-Admin user's role to another non-Super-Admin role", async () => {
    const prisma = makePrismaMock({ id: "target-1", role: UserRole.STUDENT });
    const service = new UsersService(prisma);

    await expect(
      service.updateRole("admin-actor", UserRole.ADMIN, "target-1", UserRole.CONTENT_MANAGER),
    ).resolves.toBeDefined();
  });

  it("records an audit log entry including who made the change and the previous role", async () => {
    const prisma = makePrismaMock({ id: "target-1", role: UserRole.STUDENT });
    const service = new UsersService(prisma);

    await service.updateRole("admin-actor", UserRole.ADMIN, "target-1", UserRole.CONTENT_MANAGER);

    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ newRole: UserRole.CONTENT_MANAGER, previousRole: UserRole.STUDENT, changedBy: "admin-actor" }),
        }),
      }),
    );
  });
});
