import { resolveSubjectAccess } from "./subject-access";

describe("shared subject access", () => {
  const profile = {
    id: "student-1",
    gradeId: "british-grade-1",
    curriculumId: "british-curriculum",
    subjects: [{ subjectId: "british-arabic", expiresAt: null }],
    user: { role: "STUDENT", isTestStudent: false },
  };

  it("resolves an entitled target subject to its canonical MOE content without changing its identity", async () => {
    const target = { id: "british-arabic", nameEn: "Arabic", nameAr: "اللغة العربية", sharedContentSubjectId: "moe-arabic", grade: { level: 1 }, sharedContentSubject: { id: "moe-arabic", nameEn: "Arabic", nameAr: "اللغة العربية", isActive: true, sharedContentSubjectId: null, grade: { level: 1, isActive: true, curriculum: { code: "EG_NATIONAL", isActive: true } } } };
    const prisma: any = { client: { subject: { findFirst: jest.fn().mockResolvedValue(target) } } };

    await expect(resolveSubjectAccess(prisma, profile, target.id)).resolves.toMatchObject({
      subject: target,
      contentSubjectId: "moe-arabic",
      active: true,
    });
  });

  it("authorizes a canonical Topic through an entitled same-grade shared subject", async () => {
    const alias = { id: "british-arabic", nameEn: "Arabic", nameAr: "اللغة العربية", sharedContentSubjectId: "moe-arabic", grade: { level: 1 }, sharedContentSubject: { id: "moe-arabic", nameEn: "Arabic", nameAr: "اللغة العربية", isActive: true, sharedContentSubjectId: null, grade: { level: 1, isActive: true, curriculum: { code: "EG_NATIONAL", isActive: true } } } };
    const prisma: any = {
      client: {
        subject: { findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(alias) },
      },
    };

    await expect(resolveSubjectAccess(prisma, profile, "moe-arabic")).resolves.toMatchObject({
      subject: alias,
      contentSubjectId: "moe-arabic",
      active: true,
    });
  });

  it("does not grant active access when a student has no entitlement to the target alias", async () => {
    const unentitled = { ...profile, subjects: [] };
    const alias = { id: "british-arabic", nameEn: "Arabic", nameAr: "اللغة العربية", sharedContentSubjectId: "moe-arabic", grade: { level: 1 }, sharedContentSubject: { id: "moe-arabic", nameEn: "Arabic", nameAr: "اللغة العربية", isActive: true, sharedContentSubjectId: null, grade: { level: 1, isActive: true, curriculum: { code: "EG_NATIONAL", isActive: true } } } };
    const prisma: any = {
      client: {
        subject: { findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(alias) },
        studentSubject: { findUnique: jest.fn().mockResolvedValue(null) },
      },
    };

    await expect(resolveSubjectAccess(prisma, unentitled, "moe-arabic")).resolves.toMatchObject({ active: false });
  });
});
