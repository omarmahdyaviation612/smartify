import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public pricing table, grouped by curriculum — the only source the frontend reads from. */
  async getPublicPricing() {
    const curricula = await this.prisma.client.curriculum.findMany({
      where: { isActive: true },
      include: {
        pricingPlans: { where: { isActive: true }, orderBy: { monthlyPriceEGP: "asc" } },
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
        tiers: c.pricingPlans.map((p) => ({
          id: p.id, // lets the frontend carry the selected plan into checkout without the student re-picking it
          levelEn: p.levelCodeEn,
          levelAr: p.levelCodeAr,
          monthlyPriceEGP: p.monthlyPriceEGP,
          includedSubjects: p.includedSubjects,
          additionalSubjectPriceEGP: p.additionalSubjectPriceEGP,
        })),
      })),
    };
  }
}
