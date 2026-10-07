import { BadRequestException } from "@nestjs/common";
import { ParentService } from "./parent.service";

describe("ParentService", () => {
  const accuracyService = { getPerTopicAccuracy: jest.fn().mockResolvedValue([]) } as any;
  const usageService = { getRemainingToday: jest.fn().mockResolvedValue({ used: 0, limit: 10, remaining: 10 }) } as any;

  it("rejects expired or reused link codes", async () => {
    const prisma = {
      client: {
        $transaction: jest.fn(async (callback: (tx: any) => any) => callback({ parentLinkInvitation: { findUnique: jest.fn().mockResolvedValue({ usedAt: null, expiresAt: new Date(0) }) } })),
        parentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "p1" }) },
        parentLinkInvitation: { findUnique: jest.fn().mockResolvedValue({ usedAt: null, expiresAt: new Date(0) }) },
      },
    } as any;
    await expect(new ParentService(prisma, accuracyService, usageService).acceptCode("parent", "abc")).rejects.toThrow(BadRequestException);
  });

  it("does not query conversations when permission is disabled", async () => {
    const prisma = {
      client: {
        parentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "p1", fullName: "Parent" }) },
        parentStudentRelation: { findMany: jest.fn().mockResolvedValue([{ parentId: "p1", studentId: "s1", canViewConversations: false, student: { id: "s1", fullName: "Student", curriculum: { nameEn: "British", nameAr: "بريطاني" }, grade: { nameEn: "Year 5", nameAr: "الصف الخامس" }, subjects: [], _count: { questionAttempts: 0, quizResults: 0 } } }]) },
        questionAttempt: { findMany: jest.fn().mockResolvedValue([]) },
        lessonSession: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
        quizResult: { findMany: jest.fn().mockResolvedValue([]) },
        subject: { findMany: jest.fn().mockResolvedValue([]) },
        aIConversation: { findMany: jest.fn() },
      },
    } as any;
    await new ParentService(prisma, accuracyService, usageService).dashboardSummary("parent");
    expect(prisma.client.aIConversation.findMany).not.toHaveBeenCalled();
  });

  it("returns only linked children with their curriculum, grade, usage, and explainable weak topics", async () => {
    const selectedSubject1 = { id: "arabic-y5", nameEn: "Arabic", nameAr: "اللغة العربية", sharedContentSubjectId: "moe-arabic-y5" };
    const selectedSubject2 = { id: "science-y5", nameEn: "Science", nameAr: "العلوم", sharedContentSubjectId: null };
    const children = [
      { id: "child-2", fullName: "Second", curriculum: { nameEn: "British", nameAr: "بريطاني" }, grade: { nameEn: "Year 5", nameAr: "الصف الخامس" }, subjects: [{ subject: selectedSubject1 }], _count: { questionAttempts: 3, quizResults: 0 } },
      { id: "child-1", fullName: "First", curriculum: { nameEn: "American", nameAr: "أمريكي" }, grade: { nameEn: "Grade 4", nameAr: "الصف الرابع" }, subjects: [{ subject: selectedSubject2 }], _count: { questionAttempts: 0, quizResults: 0 } },
    ];
    const prisma = { client: {
      parentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "p1", fullName: "Parent" }) },
      parentStudentRelation: { findMany: jest.fn().mockResolvedValue(children.map((student) => ({ studentId: student.id, student }))) },
      questionAttempt: { findMany: jest.fn().mockResolvedValue([]) },
      lessonSession: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      quizResult: { findMany: jest.fn().mockResolvedValue([]) },
      subject: { findMany: jest.fn().mockResolvedValue([]) },
    } } as any;
    usageService.getRemainingToday.mockImplementation(async (_studentId: string, subjectId: string) =>
      subjectId === "arabic-y5" ? { used: 2, limit: 10, remaining: 8 } : { used: 4, limit: 10, remaining: 6 });
    accuracyService.getPerTopicAccuracy.mockImplementation(async (studentId: string, subjectIds: string[]) =>
      studentId === "child-2" && subjectIds.includes("moe-arabic-y5") ? [
        { topicId: "topic-weak", nameEn: "Reading", nameAr: "القراءة", subjectNameEn: "Arabic", subjectNameAr: "اللغة العربية", correct: 1, total: 4, percent: 25 },
        { topicId: "topic-strong", nameEn: "Writing", nameAr: "الكتابة", subjectNameEn: "Arabic", subjectNameAr: "اللغة العربية", correct: 3, total: 4, percent: 75 },
      ] : []);

    const result = await new ParentService(prisma, accuracyService, usageService).dashboardSummary("parent");

    expect(prisma.client.parentStudentRelation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { parentId: "p1" } }));
    expect(result.students.map((student: any) => student.id)).toEqual(["child-2", "child-1"]);
    expect(result.students[0]).toMatchObject({
      curriculum: { nameAr: "بريطاني" },
      grade: { nameAr: "الصف الخامس" },
      subjects: [{ id: "arabic-y5", nameAr: "اللغة العربية" }],
      subjectUsage: [{ subjectId: "arabic-y5", used: 2, limit: 10, remaining: 8 }],
      weakTopics: [{ topicId: "topic-weak", total: 4, percent: 25 }],
    });
    expect(result.students[1]).toMatchObject({ curriculum: { nameAr: "أمريكي" }, grade: { nameAr: "الصف الرابع" } });
    expect(accuracyService.getPerTopicAccuracy).toHaveBeenCalledWith("child-2", ["moe-arabic-y5"]);
    expect(JSON.stringify(result)).not.toMatch(/question text|answer text|conversation text/i);
  });
});
