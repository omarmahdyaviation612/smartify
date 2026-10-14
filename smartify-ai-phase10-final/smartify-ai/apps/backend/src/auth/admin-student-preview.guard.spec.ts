import { ForbiddenException } from "@nestjs/common";
import { ClerkAuthGuard } from "./clerk-auth.guard";

function context(request: any) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as any;
}

describe("ClerkAuthGuard student preview", () => {
  function setup(targetOverrides: Record<string, unknown> = {}) {
    const actor = { id: "admin-1", role: "SUPER_ADMIN", isActive: true, deletedAt: null };
    const student = { id: "test-student-1", role: "STUDENT", isActive: true, deletedAt: null, isTestStudent: true, studentProfile: { id: "profile-1" }, ...targetOverrides };
    const prisma = { client: {
      user: { findUnique: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(where.clerkUserId ? actor : student)) },
      auditLog: { findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(where.action === "STUDENT_TEST_PREVIEW_STARTED" ? { entityId: "test-student-1" } : null)) },
    } };
    const auth = { verifySessionToken: jest.fn().mockResolvedValue({ externalUserId: "clerk-admin", email: "admin@example.test" }) };
    return { guard: new ClerkAuthGuard(auth as any, prisma as any), actor, student, prisma };
  }

  it("uses only an active, explicitly enabled test student as the request identity", async () => {
    const { guard, student } = setup();
    const request: any = { headers: { authorization: "Bearer token", "x-admin-student-preview": "preview-session-1" }, path: "/dashboard/summary", method: "GET" };
    await guard.canActivate(context(request));
    expect(request.user).toBe(student);
    expect(request.adminPreviewActor).toMatchObject({ id: "admin-1", role: "SUPER_ADMIN" });
  });

  it("rejects a client-supplied student preview without a server-recorded active session", async () => {
    const { guard, prisma } = setup();
    const request = { headers: { authorization: "Bearer token", "x-admin-student-preview": "not-started" }, path: "/dashboard/summary", method: "GET" };
    prisma.client.auditLog.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects reusing a preview session after its end event", async () => {
    const { guard, prisma } = setup();
    prisma.client.auditLog.findFirst.mockImplementation(({ where }: any) => Promise.resolve(where.action === "STUDENT_TEST_PREVIEW_STARTED" ? { entityId: "test-student-1" } : { id: "end-event" }));
    const request = { headers: { authorization: "Bearer token", "x-admin-student-preview": "preview-session-1" }, path: "/dashboard/summary", method: "GET" };
    await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects previewing a student without the server-controlled test flag", async () => {
    const { guard } = setup({ isTestStudent: false });
    const request = { headers: { authorization: "Bearer token", "x-admin-student-preview": "student-1" }, path: "/dashboard/summary", method: "GET" };
    await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("blocks payment mutations while previewing a test student", async () => {
    const { guard } = setup();
    const request = { headers: { authorization: "Bearer token", "x-admin-student-preview": "test-student-1" }, path: "/billing/checkout", method: "POST" };
    await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
