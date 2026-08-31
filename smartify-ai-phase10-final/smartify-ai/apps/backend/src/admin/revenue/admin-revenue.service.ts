import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AdminRevenueService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Real active-subscription revenue (EGP) vs. real AI cost (USD) over the
   * same window — the "Total Revenue > AI API Costs + ..." business-safety
   * check from the original spec, computed from actual Subscription and
   * AIUsage rows rather than projected/estimated figures.
   *
   * NOTE: revenue is in EGP and AI cost is in USD — this endpoint returns
   * both figures separately rather than silently converting between
   * currencies with a guessed exchange rate. Whoever reads this should
   * apply a real, current FX rate before treating them as directly comparable.
   */
  async getRevenueVsCostSummary(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const activeSubscriptions = await this.prisma.client.subscription.findMany({
      where: { status: "active" },
      include: { pricingPlan: { include: { curriculum: true } } },
    });

    const monthlyRecurringRevenueEGP = activeSubscriptions.reduce((sum, s) => sum + Number(s.monthlyTotalEGP), 0);

    const revenueByCurriculum = new Map<string, number>();
    for (const s of activeSubscriptions) {
      const key = s.pricingPlan.curriculum.nameEn;
      revenueByCurriculum.set(key, (revenueByCurriculum.get(key) ?? 0) + Number(s.monthlyTotalEGP));
    }

    const aiUsageInWindow = await this.prisma.client.aIUsage.findMany({ where: { createdAt: { gte: since } } });
    const aiCostUsdInWindow = aiUsageInWindow.reduce((sum, u) => sum + Number(u.costUsd), 0);

    return {
      windowDays: days,
      activeSubscriptionCount: activeSubscriptions.length,
      monthlyRecurringRevenueEGP,
      revenueByCurriculumEGP: Object.fromEntries(revenueByCurriculum),
      aiCostUsdInWindow,
      note: "Revenue is EGP (monthly recurring); AI cost is USD for the selected window. Apply a real FX rate before comparing directly — none is assumed here.",
    };
  }
}
