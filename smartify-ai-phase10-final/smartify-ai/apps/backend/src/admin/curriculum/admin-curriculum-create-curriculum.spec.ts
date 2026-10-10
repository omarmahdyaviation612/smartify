import { BadRequestException, ConflictException } from "@nestjs/common";
import { createCurriculumSchema } from "@smartify/validation";
import { AdminCurriculumService, curriculumCodeFromName } from "./admin-curriculum.service";

describe("AdminCurriculumService.createCurriculum", () => {
  function makeService(existing: unknown = null) {
    const prisma = {
      client: {
        curriculum: {
          findUnique: jest.fn().mockResolvedValue(existing),
          create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "new-id", ...data })),
        },
      },
    };
    const service = new AdminCurriculumService(prisma as never, undefined as never, undefined as never, undefined as never, undefined as never);
    return { service, prisma };
  }

  it("creates the curriculum hidden from students, with Grade 1..N", async () => {
    const { service, prisma } = makeService();
    await service.createCurriculum({ nameEn: "Egyptian Languages", nameAr: "منهج اللغات", code: "EG_LANGUAGES", gradeCount: 3 });

    const { data } = prisma.client.curriculum.create.mock.calls[0][0];
    expect(data).toMatchObject({ code: "EG_LANGUAGES", nameEn: "Egyptian Languages", nameAr: "منهج اللغات", isActive: false });
    expect(data.grades.create).toEqual([
      { nameEn: "Grade 1", nameAr: "الصف الأول", level: 1 },
      { nameEn: "Grade 2", nameAr: "الصف الثاني", level: 2 },
      { nameEn: "Grade 3", nameAr: "الصف الثالث", level: 3 },
    ]);
  });

  it("derives the code from the English name when none is given", async () => {
    const { service, prisma } = makeService();
    await service.createCurriculum({ nameEn: "American Curriculum", nameAr: "المنهج الأمريكي" });

    expect(prisma.client.curriculum.findUnique).toHaveBeenCalledWith({ where: { code: "AMERICAN_CURRICULUM" } });
    expect(prisma.client.curriculum.create.mock.calls[0][0].data.grades.create).toEqual([]);
  });

  it("rejects a duplicate code without creating anything", async () => {
    const { service, prisma } = makeService({ id: "existing" });
    await expect(service.createCurriculum({ nameEn: "British", nameAr: "بريطاني", code: "BRITISH_INTL" })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.client.curriculum.create).not.toHaveBeenCalled();
  });

  it("asks for a code when the English name has no usable letters", async () => {
    const { service } = makeService();
    await expect(service.createCurriculum({ nameEn: "تجريبي", nameAr: "تجريبي" })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("curriculumCodeFromName", () => {
  it.each([
    ["Egyptian Experimental Curriculum", "EGYPTIAN_EXPERIMENTAL_CURRICULUM"],
    ["  American (US) curriculum ", "AMERICAN_US_CURRICULUM"],
    ["123 numbers first", ""],
    ["منهج", ""],
  ])("%s -> %s", (input, expected) => {
    expect(curriculumCodeFromName(input)).toBe(expected);
  });
});

describe("createCurriculumSchema", () => {
  it("rejects lowercase codes and too many grades", () => {
    expect(createCurriculumSchema.safeParse({ nameEn: "A", nameAr: "ب", code: "eg_lang" }).success).toBe(false);
    expect(createCurriculumSchema.safeParse({ nameEn: "A", nameAr: "ب", gradeCount: 13 }).success).toBe(false);
    expect(createCurriculumSchema.safeParse({ nameEn: "A", nameAr: "ب", gradeCount: 6, code: "EG_LANGUAGES" }).success).toBe(true);
  });
});
