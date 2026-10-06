import { BadRequestException } from "@nestjs/common";
import { AdminCurriculumService } from "./admin-curriculum.service";

const target = {
  id: "british-arabic",
  nameEn: "Arabic Language",
  nameAr: "اللغة العربية",
  isActive: true,
  sourceFile: null,
  sharedContentSubjectId: null,
  _count: { units: 0 },
  grade: { level: 1, isActive: true, curriculum: { code: "BRITISH_INTL", isActive: true } },
};
const source = {
  id: "moe-arabic",
  nameEn: "Arabic",
  nameAr: "اللغة العربية",
  isActive: true,
  sharedContentSubjectId: null,
  _count: { units: 3 },
  grade: { level: 1, isActive: true, curriculum: { code: "EG_NATIONAL", isActive: true } },
};

function harness(sourceOverride: any = source) {
  const prisma: any = { client: { subject: {
    findUnique: jest.fn().mockResolvedValueOnce(target).mockResolvedValueOnce(sourceOverride),
    update: jest.fn().mockResolvedValue({ id: target.id, sharedContentSubjectId: source.id }),
  } } };
  const ai: any = { getActiveProvider: jest.fn() };
  const sourceUpload: any = { uploadFromBuffer: jest.fn() };
  const tocExtraction: any = { extract: jest.fn(), getPageCount: jest.fn() };
  const grounding: any = { prepareNextGroundingChunk: jest.fn() };
  return { service: new AdminCurriculumService(prisma, ai, sourceUpload, tocExtraction, {} as any, grounding), prisma, ai, sourceUpload, tocExtraction, grounding };
}

describe("AdminCurriculumService.updateSharedSubjectContent", () => {
  it("links the British catalog subject to canonical MOE content without calling upload or AI", async () => {
    const h = harness();

    await expect(h.service.updateSharedSubjectContent(target.id, { sharedContentSubjectId: source.id })).resolves.toEqual({
      id: target.id,
      sharedContentSubjectId: source.id,
    });
    expect(h.prisma.client.subject.update).toHaveBeenCalledWith({
      where: { id: target.id },
      data: { sharedContentSubjectId: source.id },
      select: { id: true, sharedContentSubjectId: true },
    });
    expect(h.ai.getActiveProvider).not.toHaveBeenCalled();
    expect(h.sourceUpload.uploadFromBuffer).not.toHaveBeenCalled();
    expect(h.tocExtraction.extract).not.toHaveBeenCalled();
    expect(h.grounding.prepareNextGroundingChunk).not.toHaveBeenCalled();
  });

  it("rejects grade-level mismatches without writing", async () => {
    const h = harness({ ...source, grade: { ...source.grade, level: 2 } });
    await expect(h.service.updateSharedSubjectContent(target.id, { sharedContentSubjectId: source.id })).rejects.toThrow(BadRequestException);
    expect(h.prisma.client.subject.update).not.toHaveBeenCalled();
  });

  it("rejects non-canonical or non-MOE sources", async () => {
    const h = harness({ ...source, sharedContentSubjectId: "another-source" });
    await expect(h.service.updateSharedSubjectContent(target.id, { sharedContentSubjectId: source.id })).rejects.toThrow(BadRequestException);
    expect(h.prisma.client.subject.update).not.toHaveBeenCalled();
  });
});

describe("AdminCurriculumService.createSharedSubjectAlias", () => {
  function createHarness(level = 1, existing: any[] = []) {
    const created = { id: "british-arabic", gradeId: "british-grade-1", nameEn: source.nameEn, nameAr: source.nameAr, sharedContentSubjectId: source.id };
    const prisma: any = { client: {
      grade: { findUnique: jest.fn().mockResolvedValue({ id: "british-grade-1", level, isActive: true, curriculum: { code: "BRITISH_INTL", isActive: true } }) },
      subject: {
        findUnique: jest.fn().mockResolvedValue(source),
        findMany: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue(created),
      },
    } };
    const ai: any = { getActiveProvider: jest.fn() };
    const upload: any = { uploadFromBuffer: jest.fn() };
    const toc: any = { extract: jest.fn() };
    const grounding: any = { prepareNextGroundingChunk: jest.fn() };
    return { service: new AdminCurriculumService(prisma, ai, upload, toc, {} as any, grounding), prisma, ai, upload, toc, grounding };
  }

  it("creates a zero-content target subject that points at the MOE source without AI or uploads", async () => {
    const h = createHarness();
    await expect(h.service.createSharedSubjectAlias("british-grade-1", source.id)).resolves.toMatchObject({
      nameEn: source.nameEn,
      nameAr: source.nameAr,
      sharedContentSubjectId: source.id,
    });
    expect(h.prisma.client.subject.create).toHaveBeenCalledWith(expect.objectContaining({ data: {
      gradeId: "british-grade-1", nameEn: source.nameEn, nameAr: source.nameAr,
      isActive: true, sourceFile: null, priceEGP: null, sharedContentSubjectId: source.id,
    } }));
    expect(h.ai.getActiveProvider).not.toHaveBeenCalled();
    expect(h.upload.uploadFromBuffer).not.toHaveBeenCalled();
    expect(h.toc.extract).not.toHaveBeenCalled();
    expect(h.grounding.prepareNextGroundingChunk).not.toHaveBeenCalled();
  });

  it("rejects a different grade level and duplicate subject category", async () => {
    const mismatch = createHarness(2);
    await expect(mismatch.service.createSharedSubjectAlias("british-grade-1", source.id)).rejects.toThrow(BadRequestException);
    expect(mismatch.prisma.client.subject.create).not.toHaveBeenCalled();

    const duplicate = createHarness(1, [{ nameEn: "Arabic Language", nameAr: "العربية" }]);
    await expect(duplicate.service.createSharedSubjectAlias("british-grade-1", source.id)).rejects.toThrow(BadRequestException);
    expect(duplicate.prisma.client.subject.create).not.toHaveBeenCalled();
  });
});
