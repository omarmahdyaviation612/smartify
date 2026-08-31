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
});
