import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CurriculaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public curriculum catalog: curricula -> grades -> subjects. Drives the
   * /curricula page and onboarding's curriculum/grade/subject steps.
   *
   * Phase 10C: a curriculum is only listed here when it has at least one
   * active grade. Without this, `isActive: true` alone let a curriculum
   * with zero real grades (LOCAL/BRITISH_INTL/AMERICAN_INTL, at this
   * point in the product) appear as a selectable onboarding option that
   * dead-ended on the next step — this is a backend data-contract fix so
   * every client (onboarding, the marketing page, anything else) gets a
   * catalog that's actually safe to render/select from, not a cosmetic
   * frontend-only filter.
   */
  async getPublicCatalog() {
    const curricula = await this.prisma.client.curriculum.findMany({
      where: { isActive: true, grades: { some: { isActive: true } } },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        country: true,
        grades: {
          where: { isActive: true },
          orderBy: { level: "asc" },
          select: {
            id: true,
            nameEn: true,
            nameAr: true,
            level: true,
            // Availability is an OFFERING: a grade may offer a Subject whose
            // content home is another curriculum's grade (shared Arabic /
            // Social Studies). Mapped back to `subjects` below so the public
            // response shape is unchanged.
            offeredSubjects: {
              where: { isActive: true, subject: { isActive: true } },
              orderBy: { subject: { nameEn: "asc" } },
              select: { subject: { select: { id: true, nameEn: true, nameAr: true, icon: true } } },
            },
          },
        },
      },
    });

    return curricula.map((curriculum) => ({
      ...curriculum,
      grades: curriculum.grades.map((grade) => {
        const { offeredSubjects, ...rest } = grade;
        return { ...rest, subjects: offeredSubjects.map((offering) => offering.subject) };
      }),
    }));
  }

  /**
   * Illustrative Grade -> Subject -> Unit -> Topic -> Lesson tree for one
   * subject, used only to concretely explain the content hierarchy on the
   * /curricula page. Pulled from real (placeholder) seed data — never a
   * hand-written example — so it can't drift from what actually exists.
   */
  async getStructureSample(curriculumCode: string) {
    // Same visibility rule as getPublicCatalog above: an inactive
    // curriculum/grade/subject must never be reachable here either, even
    // though this endpoint queries by curriculum CODE rather than going
    // through the catalog list first.
    const curriculum = await this.prisma.client.curriculum.findFirst({
      where: { code: curriculumCode, isActive: true },
      include: {
        grades: {
          where: { isActive: true },
          take: 1,
          orderBy: { level: "asc" },
          include: {
            offeredSubjects: {
              where: { isActive: true, subject: { isActive: true } },
              orderBy: { subject: { nameEn: "asc" } },
              take: 1,
              select: {
                subject: {
                  select: {
                    nameEn: true,
                    nameAr: true,
                    units: {
                      take: 1,
                      orderBy: { order: "asc" },
                      include: { topics: { orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" } } } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!curriculum) throw new NotFoundException("Unknown curriculum code.");

    const grade = curriculum.grades[0];
    const subject = grade?.offeredSubjects?.[0]?.subject;
    const unit = subject?.units[0];

    return {
      curriculum: { nameEn: curriculum.nameEn, nameAr: curriculum.nameAr },
      grade: grade ? { nameEn: grade.nameEn, nameAr: grade.nameAr } : null,
      subject: subject ? { nameEn: subject.nameEn, nameAr: subject.nameAr } : null,
      unit: unit ? { nameEn: unit.nameEn, nameAr: unit.nameAr } : null,
      topics:
        unit?.topics.map((t) => ({
          nameEn: t.nameEn,
          nameAr: t.nameAr,
          lessons: t.lessons.map((l) => ({ nameEn: l.nameEn, nameAr: l.nameAr })),
        })) ?? [],
    };
  }
}
