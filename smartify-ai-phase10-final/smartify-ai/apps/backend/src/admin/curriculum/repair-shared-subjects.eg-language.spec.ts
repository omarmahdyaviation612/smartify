import { AdminCurriculumService } from "./admin-curriculum.service";
import { isSharedTargetCurriculum, linksAtMoePrice } from "../../common/shared-content-subject.util";

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

  it("targets curricula that are still hidden from students (prepared before launch)", async () => {
    const tx: any = { grade: { findMany: jest.fn().mockResolvedValue([]) }, subject: { update: jest.fn(), create: jest.fn() } };
    await makeService(tx).repairSharedSubjectAliases();
    const targetQuery = tx.grade.findMany.mock.calls[1][0];
    expect(targetQuery.where.curriculum.code.in).toContain("EG_LANGUAGE");
    expect(targetQuery.where.curriculum.isActive).toBeUndefined();
  });
});
