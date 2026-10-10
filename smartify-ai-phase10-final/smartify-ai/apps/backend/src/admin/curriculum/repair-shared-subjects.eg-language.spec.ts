import { AdminCurriculumService } from "./admin-curriculum.service";
import { isSharedLaunchSubject, isSharedTargetCurriculum, linksAtMoePrice, sharedKindsForCurriculum, sharedSubjectKind } from "../../common/shared-content-subject.util";

/**
 * 2026-10-11: the Egyptian Language curriculum (EG_LANGUAGE) studies the
 * national Arabic and Social Studies books and sells them at the same price.
 */
function makeService(tx: any) {
  const prisma: any = { client: { $transaction: jest.fn(async (callback: (client: any) => unknown) => callback(tx)) } };
  return new AdminCurriculumService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
}

describe("shared MOE subjects for the Egyptian Language curriculum", () => {
  it("treats EG_LANGUAGE as a shared target that links at the MOE price", () => {
    expect(isSharedTargetCurriculum("EG_LANGUAGE")).toBe(true);
    expect(isSharedTargetCurriculum("EG_NATIONAL")).toBe(false);
    expect(linksAtMoePrice("EG_LANGUAGE")).toBe(true);
    expect(linksAtMoePrice("BRITISH_INTL")).toBe(false);
  });

  it("repair creates Arabic and Social Studies in EG_LANGUAGE grades with the MOE subject's price", async () => {
    const tx: any = {
      grade: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{
            id: "moe-g4", level: 4, subjects: [
              { id: "moe-ar", nameEn: "Arabic Language", nameAr: "اللغة العربية", priceEGP: 140, _count: { units: 3 } },
              { id: "moe-ss", nameEn: "Social Studies", nameAr: "الدراسات الاجتماعية", priceEGP: 150, _count: { units: 3 } },
            ],
          }])
          .mockResolvedValueOnce([{ id: "lang-g4", level: 4, curriculum: { code: "EG_LANGUAGE" }, subjects: [] }]),
      },
      subject: { update: jest.fn(), create: jest.fn().mockResolvedValue({}) },
    };
    await expect(makeService(tx).repairSharedSubjectAliases()).resolves.toMatchObject({ created: 2, conflicts: [] });
    expect(tx.subject.create).toHaveBeenCalledWith({ data: expect.objectContaining({ gradeId: "lang-g4", nameEn: "Arabic Language", priceEGP: 140, sharedContentSubjectId: "moe-ar", isActive: true }) });
    expect(tx.subject.create).toHaveBeenCalledWith({ data: expect.objectContaining({ gradeId: "lang-g4", nameEn: "Social Studies", priceEGP: 150, sharedContentSubjectId: "moe-ss", isActive: true }) });
  });

  it("shares English only with EG_LANGUAGE, never British or American", () => {
    expect(sharedSubjectKind("English Language", "\u0627\u0644\u0644\u063a\u0629 \u0627\u0644\u0625\u0646\u062c\u0644\u064a\u0632\u064a\u0629")).toBe("ENGLISH");
    expect(sharedSubjectKind("Arabic Language", "\u0627\u0644\u0644\u063a\u0629 \u0627\u0644\u0639\u0631\u0628\u064a\u0629")).toBe("ARABIC");
    expect(sharedKindsForCurriculum("EG_LANGUAGE")).toContain("ENGLISH");
    expect(sharedKindsForCurriculum("BRITISH_INTL")).not.toContain("ENGLISH");
    expect(sharedKindsForCurriculum("AMERICAN_INTL")).not.toContain("ENGLISH");
    expect(isSharedLaunchSubject("English Language", null, "EG_LANGUAGE")).toBe(true);
    expect(isSharedLaunchSubject("English Language", null, "BRITISH_INTL")).toBe(false);
    expect(isSharedLaunchSubject("English Language", null, "EG_NATIONAL")).toBe(true);
    expect(isSharedLaunchSubject("English Language", null)).toBe(false);
  });

  it("repair links English into EG_LANGUAGE at the MOE price but never into British grades", async () => {
    const english = { id: "moe-en", nameEn: "English Language", nameAr: "\u0627\u0644\u0644\u063a\u0629 \u0627\u0644\u0625\u0646\u062c\u0644\u064a\u0632\u064a\u0629", priceEGP: 140, _count: { units: 6 } };
    const tx: any = {
      grade: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "moe-g4", level: 4, subjects: [english] }])
          .mockResolvedValueOnce([
            { id: "lang-g4", level: 4, curriculum: { code: "EG_LANGUAGE" }, subjects: [] },
            { id: "brit-g4", level: 4, curriculum: { code: "BRITISH_INTL" }, subjects: [] },
          ]),
      },
      subject: { update: jest.fn(), create: jest.fn().mockResolvedValue({}) },
    };
    await makeService(tx).repairSharedSubjectAliases();
    expect(tx.subject.create).toHaveBeenCalledTimes(1);
    expect(tx.subject.create).toHaveBeenCalledWith({ data: expect.objectContaining({ gradeId: "lang-g4", nameEn: "English Language", priceEGP: 140, sharedContentSubjectId: "moe-en" }) });
  });

  it("targets curricula that are still hidden from students (prepared before launch)", async () => {
    const tx: any = { grade: { findMany: jest.fn().mockResolvedValue([]) }, subject: { update: jest.fn(), create: jest.fn() } };
    await makeService(tx).repairSharedSubjectAliases();
    const targetQuery = tx.grade.findMany.mock.calls[1][0];
    expect(targetQuery.where.curriculum.code.in).toContain("EG_LANGUAGE");
    expect(targetQuery.where.curriculum.isActive).toBeUndefined();
  });
});
