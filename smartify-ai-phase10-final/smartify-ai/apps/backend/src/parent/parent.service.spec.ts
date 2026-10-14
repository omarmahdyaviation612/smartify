import { BadRequestException } from "@nestjs/common";
import { ParentService } from "./parent.service";

describe("ParentService", () => {
  it("rejects expired or reused link codes", async () => {
    const prisma = {
      client: {
        parentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "p1" }) },
        parentLinkInvitation: { findUnique: jest.fn().mockResolvedValue({ usedAt: null, expiresAt: new Date(0) }) },
      },
    } as any;
    await expect(new ParentService(prisma).acceptCode("parent", "abc")).rejects.toThrow(BadRequestException);
  });

  it("does not query conversations when permission is disabled", async () => {
    const prisma = {
      client: {
        parentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "p1", fullName: "Parent" }) },
        parentStudentRelation: { findMany: jest.fn().mockResolvedValue([{ parentId: "p1", studentId: "s1", canViewConversations: false, student: { id: "s1", fullName: "Student", _count: { questionAttempts: 0, quizResults: 0 } } }]) },
        questionAttempt: { findMany: jest.fn().mockResolvedValue([]) },
        aIConversation: { findMany: jest.fn() },
      },
    } as any;
    await new ParentService(prisma).dashboardSummary("parent");
    expect(prisma.client.aIConversation.findMany).not.toHaveBeenCalled();
  });

  it("allows one parent to retry a link that already connected the same student", async () => {
    const relation = { id: "rel-1", studentId: "student-1", canViewConversations: false };
    const prisma = { client: {
      parentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "parent-1" }) },
      parentLinkInvitation: { findUnique: jest.fn().mockResolvedValue({ id: "invite-1", code: "ABC123", usedAt: new Date(), expiresAt: new Date(Date.now() + 60000), studentId: "student-1", createdByUserId: "child-user-1" }) },
      parentStudentRelation: { findUnique: jest.fn().mockResolvedValue(relation), upsert: jest.fn() },
    } } as any;
    await expect(new ParentService(prisma).acceptCode("parent-user", "abc123")).resolves.toEqual(relation);
    expect(prisma.client.parentStudentRelation.upsert).not.toHaveBeenCalled();
  });

  it("links two different children to the same parent account", async () => {
    const invitations = new Map([
      ["DAGHER1", { id: "invite-1", code: "DAGHER1", usedAt: null, expiresAt: new Date(Date.now() + 60000), studentId: "dagher", createdByUserId: "dagher-user" }],
      ["KENDA1", { id: "invite-2", code: "KENDA1", usedAt: null, expiresAt: new Date(Date.now() + 60000), studentId: "kenda", createdByUserId: "kenda-user" }],
    ]);
    const relations = new Map<string, any>();
    const prisma = { client: {
      parentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "mom" }) },
      parentLinkInvitation: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(invitations.get(where.code) ?? null)),
        update: jest.fn(({ where, data }: any) => { const invite: any = [...invitations.values()].find((item) => item.id === where.id); invite.usedAt = data.usedAt; return Promise.resolve(invite); }),
      },
      parentStudentRelation: { upsert: jest.fn(({ where, create }: any) => {
        const key = `${where.parentId_studentId.parentId}:${where.parentId_studentId.studentId}`;
        if (!relations.has(key)) relations.set(key, { id: `rel-${relations.size + 1}`, ...create, canViewConversations: false });
        return Promise.resolve(relations.get(key));
      }) },
    } } as any;
    const service = new ParentService(prisma);
    await service.acceptCode("mom-user", "DAGHER1");
    await service.acceptCode("mom-user", "KENDA1");
    expect([...relations.values()].map((relation) => relation.studentId)).toEqual(["dagher", "kenda"]);
    expect(prisma.client.parentStudentRelation.upsert).toHaveBeenCalledTimes(2);
  });
});
