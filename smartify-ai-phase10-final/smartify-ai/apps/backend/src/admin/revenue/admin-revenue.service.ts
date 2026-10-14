import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AdminRevenueService {
  constructor(private readonly prisma: PrismaService) {}

  /** Current active-subscription MRR grouped by student context; this is not a cash-collection report. */
  async getRevenueAnalytics() {
    const subscriptions = await this.prisma.client.subscription.findMany({
      where: { status: "active" },
      include: { student: { include: { curriculum: true } } },
    });
    const groups = {
      byArea: new Map<string, any>(),
      byCurriculum: new Map<string, any>(),
      byAgeGroup: new Map<string, any>(),
    };
    const selectedIds = new Set<string>();
    const selectedIdsBySubscription = new Map<string, string[]>();
    let monthlyRecurringRevenueEGP = 0;
    for (const subscription of subscriptions) {
      const amount = Number(subscription.monthlyTotalEGP);
      const student = subscription.student;
      monthlyRecurringRevenueEGP += amount;
      const governorate = student.governorate?.trim() || "Unknown";
      const area = student.area?.trim() || "Unknown";
      const ageGroup = student.age <= 5 ? "0–5" : student.age <= 10 ? "6–10" : student.age <= 12 ? "11–12" : student.age <= 15 ? "13–15" : "16+";
      this.addAnalyticsGroup(groups.byArea, `${governorate}\u0000${area}`, { governorate, area }, amount);
      this.addAnalyticsGroup(groups.byCurriculum, student.curriculum.nameEn, { name: student.curriculum.nameEn }, amount);
      this.addAnalyticsGroup(groups.byAgeGroup, ageGroup, { ageGroup }, amount);
      const rawIds = subscription.selectedSubjectIds;
      const ids = Array.isArray(rawIds) ? [...new Set(rawIds.filter((id): id is string => typeof id === "string"))] : [];
      selectedIdsBySubscription.set(subscription.id, ids);
      ids.forEach((id) => selectedIds.add(id));
    }

    const subjects = selectedIds.size ? await this.prisma.client.subject.findMany({
      where: { id: { in: [...selectedIds] } },
      select: { id: true, nameEn: true, nameAr: true, priceEGP: true },
    }) : [];
    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
    const bySubject = new Map<string, any>();
    let unattributedSubjectRevenueEGP = 0;
    for (const subscription of subscriptions) {
      const ids = selectedIdsBySubscription.get(subscription.id) ?? [];
      const amount = Number(subscription.monthlyTotalEGP);
      const priced = ids.map((id) => subjectById.get(id)).filter((subject): subject is NonNullable<typeof subject> => Boolean(subject && Number(subject.priceEGP) > 0));
      const totalCurrentPrice = priced.reduce((sum, subject) => sum + Number(subject.priceEGP), 0);
      if (!ids.length || priced.length !== ids.length || !totalCurrentPrice) {
        unattributedSubjectRevenueEGP += amount;
        continue;
      }
      for (const subject of priced) {
        const allocated = amount * Number(subject.priceEGP) / totalCurrentPrice;
        const row = bySubject.get(subject.id) ?? { id: subject.id, nameEn: subject.nameEn, nameAr: subject.nameAr, revenueEGP: 0, studentCount: 0 };
        row.revenueEGP += allocated;
        row.studentCount += 1;
        bySubject.set(subject.id, row);
      }
    }
    const sortRevenue = (rows: Map<string, any>) => [...rows.values()].sort((a, b) => b.revenueEGP - a.revenueEGP);
    return {
      activeSubscriptionCount: subscriptions.length,
      monthlyRecurringRevenueEGP,
      byArea: sortRevenue(groups.byArea),
      byCurriculum: sortRevenue(groups.byCurriculum),
      byAgeGroup: sortRevenue(groups.byAgeGroup),
      bySubject: [...bySubject.values()].sort((a, b) => b.revenueEGP - a.revenueEGP),
      unattributedSubjectRevenueEGP,
      notes: [
        "Revenue is current monthly recurring value from active subscriptions, not payments collected in a date range.",
        "Area and governorate are optional, student-reported profile fields; Unknown means profile data is missing.",
        "Subject revenue is allocated using current subject prices as weights and scaled to each subscription total; it is an estimate when historic prices changed.",
      ],
    };
  }

  private addAnalyticsGroup(groups: Map<string, any>, key: string, labels: Record<string, string>, amount: number) {
    const row = groups.get(key) ?? { ...labels, revenueEGP: 0, studentCount: 0 };
    row.revenueEGP += amount;
    row.studentCount += 1;
    groups.set(key, row);
  }

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
