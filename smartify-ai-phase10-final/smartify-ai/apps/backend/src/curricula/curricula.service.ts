import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CurriculaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public curriculum catalog: curricula -> grades -> subjects. Drives the /curricula page and onboarding's curriculum/grade/subject steps. */
  async getPublicCatalog() {
    return this.prisma.client.curriculum.findMany({
      where: { isActive: true },
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
            subjects: {
              where: { isActive: true },
              select: { id: true, nameEn: true, nameAr: true, icon: true },
            },
          },
        },
      },
    });
  }

  /**
   * Illustrative Grade -> Subject -> Unit -> Topic -> Lesson tree for one
   * subject, used only to concretely explain the content hierarchy on the
   * /curricula page. Pulled from real (placeholder) seed data — never a
   * hand-written example — so it can't drift from what actually exists.
   */
  async getStructureSample(curriculumCode: string) {
    const curriculum = await this.prisma.client.curriculum.findUnique({
      where: { code: curriculumCode },
      include: {
        grades: {
          take: 1,
          orderBy: { level: "asc" },
          include: {
            subjects: {
              take: 1,
              include: {
                units: {
                  take: 1,
                  orderBy: { order: "asc" },
                  include: {
                    topics: {
                      orderBy: { order: "asc" },
                      include: { lessons: { orderBy: { order: "asc" } } },
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
    const subject = grade?.subjects[0];
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
