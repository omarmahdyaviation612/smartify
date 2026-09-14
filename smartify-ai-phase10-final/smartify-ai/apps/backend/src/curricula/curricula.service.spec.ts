import { NotFoundException } from "@nestjs/common";
import { CurriculaService } from "./curricula.service";

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
