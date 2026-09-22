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

    // Subject-based pricing (2026-09-20): grouped by the STUDENT's own
    // curriculum, not pricingPlan.curriculum — a subject-priced
    // subscription has no pricingPlan at all (null), only a historical
    // plan-based row does. Student.curriculumId works identically for both.
    const activeSubscriptions = await this.prisma.client.subscription.findMany({
      where: { status: "active" },
      include: { student: { include: { curriculum: true } } },
    });

    const monthlyRecurringRevenueEGP = activeSubscriptions.reduce((sum, s) => sum + Number(s.monthlyTotalEGP), 0);

    const revenueByCurriculum = new Map<string, number>();
    for (const s of activeSubscriptions) {
      const key = s.student.curriculum.nameEn;
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

  /**
   * Free Trial + Referral V1 (2026-09-20) — simple counts only, from the
   * real LessonTrial/LessonTrialConsumption/Referral tables. Reuses this
   * existing admin summary endpoint rather than a new analytics module.
   */
  async getGrowthSummary() {
    const [trialUsers, trialLessonsConsumed, referralsCreated, successfulReferrals, referralRewardsIssued] = await Promise.all([
      this.prisma.client.lessonTrial.count(),
      this.prisma.client.lessonTrialConsumption.count(),
      this.prisma.client.referral.count(),
      this.prisma.client.referral.count({ where: { earnedAt: { not: null } } }),
      this.prisma.client.referral.count({ where: { appliedAt: { not: null } } }),
    ]);

    return { trialUsers, trialLessonsConsumed, referralsCreated, successfulReferrals, referralRewardsIssued };
  }

  /** Inspectable referral/reward records — real Referral rows, not a projection. */
  async listReferrals(take = 100) {
    const referrals = await this.prisma.client.referral.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: {
        referrer: { select: { fullName: true, user: { select: { email: true } } } },
        referredStudent: { select: { fullName: true, user: { select: { email: true } } } },
        appliedSubject: { select: { nameEn: true } },
      },
    });

    return referrals.map((r) => ({
      id: r.id,
      code: r.code,
      createdAt: r.createdAt,
      referrerName: r.referrer.fullName,
      referrerEmail: r.referrer.user.email,
      referredName: r.referredStudent.fullName,
      referredEmail: r.referredStudent.user.email,
      earnedAt: r.earnedAt,
      appliedAt: r.appliedAt,
      appliedSubjectNameEn: r.appliedSubject?.nameEn ?? null,
      appliedExpiresAt: r.appliedExpiresAt,
    }));
  }
}
