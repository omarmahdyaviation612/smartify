import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentProviderFactory } from "../payments/payment-provider.factory";
import { loadBackendEnv } from "@smartify/config";
import { TutorQuestionPacksService } from "../tutor-question-packs/tutor-question-packs.service";

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly questionPacks: TutorQuestionPacksService,
  ) {}

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException("Complete onboarding before subscribing.");
    return profile;
  }

  /** Plans available for the student's own curriculum — never lets them buy a plan for a curriculum they're not enrolled in. */
  async getAvailablePlans(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const [plans, grade] = await Promise.all([
      this.prisma.client.pricingPlan.findMany({
      where: { curriculumId: profile.curriculumId, isActive: true },
      orderBy: { monthlyPriceEGP: "asc" },
      }),
      this.prisma.client.grade.findUnique({
        where: { id: profile.gradeId },
        include: { subjects: { orderBy: { nameEn: "asc" } } },
      }),
    ]);

    const subjects = grade?.subjects ?? [];
    return plans.map((plan) => ({
      ...plan,
      gradeLevel: grade?.level ?? null,
      subjects,
      basicSubjectIds: subjects.slice(0, plan.includedSubjects).map((subject) => subject.id),
    }));
  }

  async getCurrentSubscription(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    return this.prisma.client.subscription.findUnique({
      where: { studentId: profile.id },
      include: { pricingPlan: true },
    });
  }

  /**
   * Starts checkout for a plan. Creates a local Subscription row in
   * "pending" status BEFORE redirecting to the payment provider, so the
   * webhook has something concrete to activate — the row is the source
   * of truth, the provider session is just how money actually moves.
   */
  async startCheckout(userId: string, input: { pricingPlanId: string; additionalSubjectsCount?: number; subjectIds?: string[] }) {
    const profile = await this.getProfileOrThrow(userId);
    const plan = await this.prisma.client.pricingPlan.findUnique({ where: { id: input.pricingPlanId } });

    if (!plan || plan.curriculumId !== profile.curriculumId || !plan.isActive) {
      throw new BadRequestException("This plan is not available for your curriculum.");
    }

    const selectedSubjectIds = [...new Set(input.subjectIds ?? [])];
    if (selectedSubjectIds.length > 0) {
      const gradeSubjects = await this.prisma.client.subject.findMany({ where: { gradeId: profile.gradeId } });
      const validSubjectIds = new Set(gradeSubjects.map((subject) => subject.id));
      if (selectedSubjectIds.some((id) => !validSubjectIds.has(id))) {
        throw new BadRequestException("One or more selected subjects are invalid.");
      }
    }
    const extra = selectedSubjectIds.length > 0
      ? Math.max(0, selectedSubjectIds.length - plan.includedSubjects)
      : Math.max(0, input.additionalSubjectsCount ?? 0);
    const monthlyTotalEGP = Number(plan.monthlyPriceEGP) + extra * Number(plan.additionalSubjectPriceEGP);

    const subscription = await this.prisma.client.subscription.upsert({
      where: { studentId: profile.id },
      update: { pricingPlanId: plan.id, additionalSubjectsCount: extra, monthlyTotalEGP, status: "pending" },
      create: {
        studentId: profile.id,
        pricingPlanId: plan.id,
        additionalSubjectsCount: extra,
        monthlyTotalEGP,
        status: "pending",
      },
    });

    const { provider, providerKey } = await this.providerFactory.getActiveProvider();
    const env = loadBackendEnv();

    const session = await provider.createCheckoutSession({
      studentUserId: userId,
      subscriptionId: subscription.id,
      amountEGP: monthlyTotalEGP,
      description: `Smartify AI — ${plan.levelCodeEn} (${plan.includedSubjects + extra} subjects)`,
      successUrl: `${env.FRONTEND_URL}/billing/success`,
      cancelUrl: `${env.FRONTEND_URL}/billing`,
    });

    await this.prisma.client.subscription.update({
      where: { id: subscription.id },
      data: { paymentProvider: providerKey, externalSubscriptionId: session.externalSessionId },
    });

    return { checkoutUrl: session.checkoutUrl };
  }

  async cancelSubscription(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const subscription = await this.prisma.client.subscription.findUnique({ where: { studentId: profile.id } });
    if (!subscription) throw new NotFoundException("No subscription to cancel.");
    if (subscription.status !== "active") throw new BadRequestException("Only an active subscription can be canceled.");

    if (subscription.paymentProvider && subscription.externalSubscriptionId) {
      const provider = await this.providerFactory.getProviderByKey(subscription.paymentProvider);
      await provider.cancelSubscription(subscription.externalSubscriptionId);
    }

    return this.prisma.client.subscription.update({ where: { id: subscription.id }, data: { status: "canceled" } });
  }

  /**
   * Called by the webhook controller after signature verification —
   * updates the local Subscription row, which stays the source of truth
   * for the rest of the app.
   *
   * Phase 10 idempotency fix: webhook delivery is at-least-once per most
   * providers' own guarantees (Stripe included) — the same event can and
   * will arrive more than once in normal operation, not just as an edge
   * case. Before this fix, a duplicate "subscription.activated" delivery
   * would silently reset currentPeriodStart/End to "now" a second time,
   * quietly corrupting the billing period. The fix: log every
   * (provider, externalEventId) pair exactly once via a DB unique
   * constraint (WebhookEventLog) BEFORE applying any business effect. A
   * duplicate delivery hits that constraint and is treated as an
   * already-processed no-op. The uniqueness is enforced by Postgres
   * itself, so this is safe even if two duplicate deliveries somehow
   * race each other — only one insert can win.
   */
  async applyWebhookEvent(providerKey: string, event: { type: string; externalSubscriptionId?: string; externalEventId?: string }) {
    if (event.type === "question_pack.paid") {
      const purchaseId = (event as { purchaseId?: string }).purchaseId;
      if (!purchaseId || !event.externalEventId) throw new BadRequestException("Invalid question pack webhook event.");
      await this.questionPacks.applyPaidPurchase(providerKey, purchaseId, event.externalEventId);
      return;
    }
    if (event.externalEventId) {
      try {
        await this.prisma.client.webhookEventLog.create({
          data: { provider: providerKey, externalEventId: event.externalEventId, eventType: event.type },
        });
      } catch (err: any) {
        if (err?.code === "P2002") {
          // Unique constraint violation — this exact event was already
          // processed (or is being processed by a concurrent delivery
          // right now). Either way, do not re-apply its effect.
          return;
        }
        throw err;
      }
    }

    if (!event.externalSubscriptionId) return;

    const subscription = await this.prisma.client.subscription.findFirst({
      where: { externalSubscriptionId: event.externalSubscriptionId },
    });
    if (!subscription) return; // unknown session — nothing to reconcile

    if (event.type === "subscription.activated") {
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await this.prisma.client.subscription.update({
        where: { id: subscription.id },
        data: { status: "active", currentPeriodStart: now, currentPeriodEnd: periodEnd },
      });
    } else if (event.type === "subscription.canceled") {
      await this.prisma.client.subscription.update({ where: { id: subscription.id }, data: { status: "canceled" } });
    } else if (event.type === "payment.failed") {
      await this.prisma.client.subscription.update({ where: { id: subscription.id }, data: { status: "past_due" } });
    }
  }
}
