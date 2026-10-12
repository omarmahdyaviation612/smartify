import { ConflictException, NotFoundException } from "@nestjs/common";
import { createGradeSchema } from "@smartify/validation";
import { AdminCurriculumService } from "./admin-curriculum.service";

describe("AdminCurriculumService.createGrade", () => {
  function makeService(opts: { curriculum?: unknown; clash?: unknown } = {}) {
    const prisma = {
      client: {
        curriculum: { findUnique: jest.fn().mockResolvedValue("curriculum" in opts ? opts.curriculum : { id: "eg" }) },
        grade: {
          findFirst: jest.fn().mockResolvedValue(opts.clash ?? null),
          create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "g7", ...data })),
        },
      },
    };
    const service = new AdminCurriculumService(prisma as never, undefined as never, undefined as never, undefined as never, undefined as never);
    return { service, prisma };
  }

  it("adds Preparatory 1 as a hidden level 7 grade", async () => {
    const { service, prisma } = makeService();
    const created = await service.createGrade("eg", { nameEn: "Prep 1", nameAr: "الصف الأول الإعدادي", level: 7 });
    expect(prisma.client.grade.create).toHaveBeenCalledWith({ data: { curriculumId: "eg", nameEn: "Prep 1", nameAr: "الصف الأول الإعدادي", level: 7, isActive: false } });
    expect(created).toMatchObject({ level: 7, isActive: false });
  });

  it("refuses a second grade with the same level in the same curriculum", async () => {
    const { service, prisma } = makeService({ clash: { nameEn: "Prep 1" } });
    await expect(service.createGrade("eg", { nameEn: "Grade 7", nameAr: "x", level: 7 })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.client.grade.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown curriculum", async () => {
    const { service, prisma } = makeService({ curriculum: null });
    await expect(service.createGrade("nope", { nameEn: "Prep 1", nameAr: "x", level: 7 })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.client.grade.create).not.toHaveBeenCalled();
  });

  it("validates the request body", () => {
    expect(createGradeSchema.safeParse({ curriculumId: "eg", nameEn: "Prep 1", nameAr: "أولى إعدادي", level: 7 }).success).toBe(true);
    expect(createGradeSchema.safeParse({ curriculumId: "eg", nameEn: "Prep 1", nameAr: "أولى إعدادي", level: 0 }).success).toBe(false);
    expect(createGradeSchema.safeParse({ curriculumId: "eg", nameEn: "", nameAr: "x", level: 7 }).success).toBe(false);
    expect(createGradeSchema.safeParse({ curriculumId: "eg", nameEn: "Prep 1", nameAr: "x", level: 7, isActive: true }).success).toBe(false);
  });
});
