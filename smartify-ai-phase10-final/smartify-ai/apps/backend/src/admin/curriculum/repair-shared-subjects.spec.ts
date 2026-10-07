import { AdminCurriculumService } from "./admin-curriculum.service";

describe("AdminCurriculumService.repairSharedSubjectAliases", () => {
  it("links existing empty subjects and creates missing aliases by grade without touching prices or AI", async () => {
    const tx: any = {
      grade: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{
            id: "moe-g1", level: 1, subjects: [{ id: "moe-ar", nameEn: "Arabic", nameAr: "اللغة العربية", _count: { units: 4 } }],
          }])
          .mockResolvedValueOnce([
            { id: "brit-g1", level: 1, curriculum: { code: "BRITISH_INTL" }, subjects: [{ id: "brit-ar", nameEn: "Arabic Language", nameAr: "اللغة العربية", isActive: false, sourceFile: null, sharedContentSubjectId: null, priceEGP: 175, _count: { units: 0 } }] },
            { id: "amer-g1", level: 1, curriculum: { code: "AMERICAN_INTL" }, subjects: [] },
          ]),
      },
      subject: {
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma: any = { client: { $transaction: jest.fn(async (callback: (client: any) => unknown) => callback(tx)) } };
    const ai: any = { getActiveProvider: jest.fn() };
    const upload: any = { uploadFromBuffer: jest.fn() };
    const toc: any = { extract: jest.fn() };
    const grounding: any = { prepareNextGroundingChunk: jest.fn() };
    const service = new AdminCurriculumService(prisma, ai, upload, toc, {} as any, grounding);

    await expect(service.repairSharedSubjectAliases()).resolves.toMatchObject({ linked: 1, created: 1, activated: 1, conflicts: [] });
    expect(tx.subject.update).toHaveBeenCalledWith({ where: { id: "brit-ar" }, data: { sharedContentSubjectId: "moe-ar", isActive: true } });
    expect(tx.subject.create).toHaveBeenCalledWith({ data: {
      gradeId: "amer-g1", nameEn: "Arabic", nameAr: "اللغة العربية", isActive: true,
      sourceFile: null, priceEGP: null, sharedContentSubjectId: "moe-ar",
    } });
    expect(JSON.stringify(tx.subject.update.mock.calls)).not.toContain("priceEGP");
    expect(ai.getActiveProvider).not.toHaveBeenCalled();
    expect(upload.uploadFromBuffer).not.toHaveBeenCalled();
    expect(toc.extract).not.toHaveBeenCalled();
    expect(grounding.prepareNextGroundingChunk).not.toHaveBeenCalled();
  });

  it("reports rather than repoints subjects that already contain their own material", async () => {
    const tx: any = {
      grade: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "moe-g1", level: 1, subjects: [{ id: "moe-ar", nameEn: "Arabic", nameAr: "اللغة العربية", _count: { units: 2 } }] }])
          .mockResolvedValueOnce([{ id: "brit-g1", level: 1, curriculum: { code: "BRITISH_INTL" }, subjects: [{ id: "brit-ar", nameEn: "Arabic", nameAr: "العربية", isActive: true, sourceFile: "book.pdf", sharedContentSubjectId: null, _count: { units: 1 } }] }]),
      },
      subject: { update: jest.fn(), create: jest.fn() },
    };
    const prisma: any = { client: { $transaction: jest.fn(async (callback: (client: any) => unknown) => callback(tx)) } };
    const service = new AdminCurriculumService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);

    await expect(service.repairSharedSubjectAliases()).resolves.toMatchObject({
      linked: 0,
      created: 0,
      conflicts: [expect.objectContaining({ gradeId: "brit-g1", reason: "TARGET_HAS_OWN_CONTENT" })],
    });
    expect(tx.subject.update).not.toHaveBeenCalled();
    expect(tx.subject.create).not.toHaveBeenCalled();
  });
});
