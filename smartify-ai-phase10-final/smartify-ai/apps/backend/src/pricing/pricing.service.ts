import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public pricing table, grouped by curriculum -> grade -> Subject
   * (2026-09-20: replaces the old PricingPlan bundle-tier source — every
   * Subject is now priced independently, there is no "N subjects
   * included" concept for new purchases). Sourced from Subject.priceEGP,
   * the same field admins edit and the same field billing.service.ts
   * sums at checkout, so this page can never drift from real pricing. A
   * Subject with priceEGP === null is listed with priceEGP: null so the
   * frontend can show it as "not yet available" rather than purchasable.
   */
  async getPublicPricing() {
    const curricula = await this.prisma.client.curriculum.findMany({
      where: { isActive: true, grades: { some: { isActive: true } } },
      orderBy: { code: "asc" },
      select: {
        code: true,
        nameEn: true,
        nameAr: true,
        grades: {
          where: { isActive: true },
          orderBy: { level: "asc" },
          select: {
            nameEn: true,
            nameAr: true,
            level: true,
            subjects: {
              where: { isActive: true },
              orderBy: { nameEn: "asc" },
              select: { id: true, nameEn: true, nameAr: true, priceEGP: true },
            },
          },
        },
      },
    });

    const dailyQuestionsConfig = await this.prisma.client.systemConfig.findUnique({
      where: { key: "default_daily_ai_questions_per_subject" },
    });

    return {
      currency: "EGP",
      dailyAiQuestionsPerSubjectIncluded: dailyQuestionsConfig?.value ?? null,
      curricula: curricula.map((c) => ({
        code: c.code,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        grades: c.grades.map((g) => ({
          nameEn: g.nameEn,
          nameAr: g.nameAr,
          level: g.level,
          subjects: g.subjects.map((s) => ({
            id: s.id,
            nameEn: s.nameEn,
            nameAr: s.nameAr,
            priceEGP: s.priceEGP != null ? Number(s.priceEGP) : null,
          })),
        })),
      })),
    };
  }
}
