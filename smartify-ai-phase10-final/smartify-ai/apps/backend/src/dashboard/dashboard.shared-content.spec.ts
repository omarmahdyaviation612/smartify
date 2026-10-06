import { DashboardService } from "./dashboard.service";

describe("DashboardService shared canonical subjects", () => {
  it("lists the British subject and loads the same MOE Topics under that catalog ID", async () => {
    const source = { id: "moe-arabic", nameEn: "Arabic", nameAr: "اللغة العربية", isActive: true, sharedContentSubjectId: null, grade: { level: 1, isActive: true, curriculum: { code: "EG_NATIONAL", isActive: true } } };
    const alias = { id: "british-arabic", nameEn: "Arabic", nameAr: "اللغة العربية", gradeId: "british-grade-1", isActive: true, sharedContentSubjectId: source.id, grade: { level: 1 }, sharedContentSubject: source };
    const profile: any = {
      id: "student-1", userId: "user-1", curriculumId: "british", gradeId: "british-grade-1", fullName: "Student",
      user: { role: "STUDENT", isTestStudent: false }, curriculum: { nameEn: "British", nameAr: "بريطاني" }, grade: { nameEn: "Year 1", nameAr: "الأول" },
      subjects: [{ subjectId: alias.id, expiresAt: null }], learningPlans: [],
    };
    const prisma: any = { client: {
      studentProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
      assessment: { findFirst: jest.fn().mockResolvedValue(null) },
      subject: { findMany: jest.fn().mockResolvedValue([alias]) },
      questionAttempt: { findMany: jest.fn().mockResolvedValue([]) },
      topic: { findMany: jest.fn().mockResolvedValue([{ id: "moe-topic-1", nameEn: "Reading", nameAr: "قراءة", unit: { subjectId: source.id, nameEn: "Unit", nameAr: "وحدة" } }]) },
      lessonSession: { findMany: jest.fn().mockResolvedValue([]) },
    } };
    const accuracy: any = { getPerTopicAccuracy: jest.fn().mockResolvedValue([]) };

    const result = await new DashboardService(prisma, accuracy).getSummary(profile.userId);

    expect(result.subjects).toEqual([{ id: alias.id, nameEn: alias.nameEn, nameAr: alias.nameAr, entitlement: "ACTIVE" }]);
    expect(result.pilotLessons).toEqual([expect.objectContaining({ topicId: "moe-topic-1", subjectId: alias.id })]);
    expect(prisma.client.topic.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { unit: { subjectId: { in: [source.id] } } } }));
    expect(accuracy.getPerTopicAccuracy).toHaveBeenCalledWith(profile.id, [source.id]);
  });
});
