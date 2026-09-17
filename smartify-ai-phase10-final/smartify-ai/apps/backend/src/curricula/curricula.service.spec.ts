import { NotFoundException } from "@nestjs/common";
import { CurriculaService } from "./curricula.service";

/**
 * Phase 10C: getPublicCatalog() must never let a student pick a curriculum
 * that dead-ends the very next onboarding step. isActive alone wasn't
 * enough — LOCAL/BRITISH_INTL/AMERICAN_INTL were all `isActive: true` with
 * zero active grades, so they showed up as selectable cards with no grade
 * to choose afterward. Fixed at the data-contract level (the query itself
 * excludes them), not a frontend-only filter.
 */
describe("CurriculaService.getPublicCatalog", () => {
  function makeService(findManyImpl: (...args: any[]) => any) {
    const prisma = { client: { curriculum: { findMany: jest.fn(findManyImpl) } } };
    return { service: new CurriculaService(prisma as any), prisma };
  }

  it("CASE 7/8 — queries only active curricula that have at least one active grade (the exact backend data-contract fix)", async () => {
    const { service, prisma } = makeService(() => []);
    await service.getPublicCatalog();
    expect(prisma.client.curriculum.findMany).toHaveBeenCalledTimes(1);
    const call = prisma.client.curriculum.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ isActive: true, grades: { some: { isActive: true } } });
  });

  it("CASE 8 — an active curriculum with zero active grades is excluded by construction (the where clause itself filters it, not post-processing)", async () => {
    // The `grades: { some: { isActive: true } }` clause means Prisma itself
    // never returns LOCAL/BRITISH_INTL/AMERICAN_INTL-shaped rows here — this
    // test documents that contract rather than re-implementing Prisma's
    // filtering, which a mocked client can't meaningfully execute.
    const { service } = makeService(() => [
      { id: "eg", code: "EG_NATIONAL", nameEn: "Egyptian National", nameAr: "المصري", country: "EG", grades: [{ id: "g1", nameEn: "Grade 1", nameAr: "الأول", level: 1, subjects: [] }] },
    ]);
    const result = await service.getPublicCatalog();
    expect(result.map((c: any) => c.code)).toEqual(["EG_NATIONAL"]);
    expect(result.map((c: any) => c.code)).not.toEqual(expect.arrayContaining(["LOCAL", "BRITISH_INTL", "AMERICAN_INTL"]));
  });

  it("CASE 9 — Egyptian National Grade 1 remains available through the catalog", async () => {
    const { service } = makeService(() => [
      { id: "eg", code: "EG_NATIONAL", nameEn: "Egyptian National", nameAr: "المصري", country: "EG", grades: [{ id: "g1", nameEn: "Grade 1", nameAr: "الأول", level: 1, subjects: [{ id: "s1", nameEn: "Mathematics", nameAr: "الرياضيات", icon: "calculator" }] }] },
    ]);
    const result = await service.getPublicCatalog();
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("EG_NATIONAL");
    expect(result[0].grades[0].nameEn).toBe("Grade 1");
    expect(result[0].grades[0].subjects[0].nameEn).toBe("Mathematics");
  });

  it("still filters nested grades/subjects by isActive:true (unchanged from before — a placeholder grade under an otherwise-real curriculum stays hidden)", async () => {
    const { service, prisma } = makeService(() => []);
    await service.getPublicCatalog();
    const call = prisma.client.curriculum.findMany.mock.calls[0][0];
    expect(call.select.grades.where).toEqual({ isActive: true });
    expect(call.select.grades.select.subjects.where).toEqual({ isActive: true });
  });
});

/**
 * Regression: getStructureSample (public, unauthenticated /curricula/:code/
 * structure-sample) queried grades/subjects with no isActive filter at all,
 * unlike getPublicCatalog right above it in the same file. A real GET
 * against the live dev DB after Phase 9.1's curriculum-activation cleanup
 * returned an inactive "[PLACEHOLDER] Grade 7" and its placeholder topics
 * for American International Curriculum — content the public catalog
 * already correctly hides. These tests lock in the fix: the same
 * isActive filtering as getPublicCatalog, applied at curriculum/grade/
 * subject level for this endpoint too, and safe handling when a real
 * (active) curriculum has zero active grades left.
 */
describe("CurriculaService.getStructureSample", () => {
  function makeService(findFirstImpl: (...args: any[]) => any) {
    const prisma = { client: { curriculum: { findFirst: jest.fn(findFirstImpl) } } };
    return { service: new CurriculaService(prisma as any), prisma };
  }

  it("queries the curriculum with isActive:true, and filters grades/subjects by isActive:true (never returns inactive hierarchy)", async () => {
    const { service, prisma } = makeService(() => ({
      nameEn: "American International Curriculum",
      nameAr: "المنهج الأمريكي الدولي",
      grades: [],
    }));

    await service.getStructureSample("AMERICAN_INTL");

    expect(prisma.client.curriculum.findFirst).toHaveBeenCalledTimes(1);
    const call = prisma.client.curriculum.findFirst.mock.calls[0][0];
    expect(call.where).toEqual({ code: "AMERICAN_INTL", isActive: true });
    expect(call.include.grades.where).toEqual({ isActive: true });
    expect(call.include.grades.include.subjects.where).toEqual({ isActive: true });
  });

  it("returns an empty (null-safe) structure when the curriculum is active but has no active grades left (e.g. only a deactivated placeholder grade remains)", async () => {
    const { service } = makeService(() => ({
      nameEn: "American International Curriculum",
      nameAr: "المنهج الأمريكي الدولي",
      grades: [], // the Prisma `where: { isActive: true }` filter means an inactive grade is simply absent here, not present-but-flagged
    }));

    const result = await service.getStructureSample("AMERICAN_INTL");

    expect(result.grade).toBeNull();
    expect(result.subject).toBeNull();
    expect(result.unit).toBeNull();
    expect(result.topics).toEqual([]);
  });

  it("throws NotFoundException for an unknown or inactive curriculum code", async () => {
    const { service } = makeService(() => null);
    await expect(service.getStructureSample("NOT_A_REAL_CODE")).rejects.toThrow(NotFoundException);
  });

  it("returns the real active Egyptian Grade 1 Mathematics hierarchy correctly (post Phase 9.1 activation)", async () => {
    const { service } = makeService(() => ({
      nameEn: "Egyptian National Curriculum (Arabic)",
      nameAr: "المنهج المصري",
      grades: [
        {
          nameEn: "Grade 1",
          nameAr: "الصف الأول",
          subjects: [
            {
              nameEn: "Mathematics",
              nameAr: "الرياضيات",
              units: [
                {
                  nameEn: "Addition",
                  nameAr: "الجمع",
                  topics: [
                    { nameEn: "Addition (Part 1)", nameAr: "الجمع (1)", lessons: [] },
                    { nameEn: "Addition with Zero", nameAr: "الجمع مع الصفر", lessons: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }));

    const result = await service.getStructureSample("EGYPT_NATIONAL");

    expect(result.grade).toEqual({ nameEn: "Grade 1", nameAr: "الصف الأول" });
    expect(result.subject).toEqual({ nameEn: "Mathematics", nameAr: "الرياضيات" });
    expect(result.unit).toEqual({ nameEn: "Addition", nameAr: "الجمع" });
    expect(result.topics.map((t) => t.nameEn)).toEqual(["Addition (Part 1)", "Addition with Zero"]);
  });
});
