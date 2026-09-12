import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "crypto";
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

  /** No client identifiers and no writes: revisiting or retrying never grants access. */
  async getPaymentStatus(userId: string): Promise<{ status: "verified" | "pending" | "failed" | "unverified" }> {
    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId } });
    if (!profile) return { status: "unverified" };
    const subscription = await this.prisma.client.subscription.findUnique({ where: { studentId: profile.id } });
    if (!subscription?.paymentProvider || !subscription.externalSubscriptionId) return { status: "unverified" };
    if (["canceled", "past_due"].includes(subscription.status)) return { status: "failed" };
    try {
      const provider = await this.providerFactory.getProviderByKey(subscription.paymentProvider);
      if (!provider.verifyCheckoutSession) return { status: "unverified" };
      const result = await provider.verifyCheckoutSession({
        externalSessionId: subscription.externalSubscriptionId,
        studentUserId: userId,
        subscriptionId: subscription.id,
        amountEGP: Number(subscription.monthlyTotalEGP),
      });
      if (result === "paid") return { status: subscription.status === "active" ? "verified" : "pending" };
      return { status: result === "pending" || result === "failed" ? result : "unverified" };
    } catch {
      // Missing credentials, provider outage, or legacy session: never infer payment.
      return { status: "unverified" };
    }
  }

  /**
   * Validates the plan/subject selection and upserts a "pending" Subscription
   * row for it — shared by the Stripe checkout path and the InstaPay manual
   * path below. Neither path activates anything here; this only records
   * WHAT the student is trying to buy, at a snapshotted price.
   */
  private async resolvePendingSubscription(
    userId: string,
    input: { pricingPlanId: string; additionalSubjectsCount?: number; subjectIds?: string[] },
  ) {
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

    return { plan, extra, monthlyTotalEGP, subscription };
  }

  /**
   * Starts checkout for a plan. Creates a local Subscription row in
   * "pending" status BEFORE redirecting to the payment provider, so the
   * webhook has something concrete to activate — the row is the source
   * of truth, the provider session is just how money actually moves.
   */
  async startCheckout(userId: string, input: { pricingPlanId: string; additionalSubjectsCount?: number; subjectIds?: string[] }) {
    const { plan, extra, monthlyTotalEGP, subscription } = await this.resolvePendingSubscription(userId, input);

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

  /**
   * Manual InstaPay path: skips the automated provider entirely. Records
   * the same "pending" Subscription row as Stripe checkout, but the
   * "session ID" is a reference code we generate and show the student —
   * they transfer money out-of-band and submit a receipt (InstapayService)
   * against this reference. Nothing here grants any entitlement; only
   * AdminInstapayService.confirm() does, via the existing applyWebhookEvent.
   */
  async startInstapayCheckout(userId: string, input: { pricingPlanId: string; additionalSubjectsCount?: number; subjectIds?: string[] }) {
    const env = loadBackendEnv();
    if (!env.INSTAPAY_RECIPIENT_NAME || !env.INSTAPAY_RECIPIENT_HANDLE) {
      throw new ServiceUnavailableException("InstaPay is not configured on this environment yet.");
    }
    const { monthlyTotalEGP, subscription } = await this.resolvePendingSubscription(userId, input);

    // "S-" prefix distinguishes this from a question-pack reference so
    // InstapayService can resolve which table to query without ambiguity.
    const referenceId = `SMAI-S-${randomUUID().slice(0, 8).toUpperCase()}`;
    await this.prisma.client.subscription.update({
      where: { id: subscription.id },
      data: { paymentProvider: "instapay", externalSubscriptionId: referenceId },
    });

    return {
      referenceId,
      expectedAmountEGP: monthlyTotalEGP,
      recipientName: env.INSTAPAY_RECIPIENT_NAME,
      recipientHandle: env.INSTAPAY_RECIPIENT_HANDLE,
      instructionsEn: env.INSTAPAY_INSTRUCTIONS_EN ?? "",
      instructionsAr: env.INSTAPAY_INSTRUCTIONS_AR ?? "",
    };
  }

  async cancelSubscription(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const subscription = await this.prisma.client.subscription.findUnique({ where: { studentId: profile.id } });
    if (!subscription) throw new NotFoundException("No subscription to cancel.");
    if (subscription.status !== "active") throw new BadRequestException("Only an active subscription can be canceled.");

    // InstaPay has no external gateway subscription to cancel — it's a
    // manual one-time confirmation, not a recurring provider-managed
    // subscription. Only automated providers (Stripe etc.) need the
    // provider-side cancel call.
    //
    // The provider's cancel API expects its own SUBSCRIPTION id (e.g.
    // Stripe "sub_..."), never the CHECKOUT SESSION id (e.g. "cs_...") —
    // these are different identifiers (see Subscription.
    // externalProviderSubscriptionId). Historical subscriptions created
    // before that field existed never captured a real subscription id;
    // externalSubscriptionId is kept as a fallback purely so old rows
    // don't change behavior, not because it's the correct identifier.
    const providerCancelId = subscription.externalProviderSubscriptionId ?? subscription.externalSubscriptionId;
    if (subscription.paymentProvider && subscription.paymentProvider !== "instapay" && providerCancelId) {
      const provider = await this.providerFactory.getProviderByKey(subscription.paymentProvider);
      await provider.cancelSubscription(providerCancelId);
    }

    // include pricingPlan: the frontend renders subscription.pricingPlan.*
    // unconditionally once a subscription is present (as getCurrentSubscription
    // returns it) — omitting it here previously crashed the billing page
    // client-side right after a successful cancel.
    return this.prisma.client.subscription.update({
      where: { id: subscription.id },
      data: { status: "canceled" },
      include: { pricingPlan: true },
    });
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
  async applyWebhookEvent(
    providerKey: string,
    event: { type: string; externalSubscriptionId?: string; externalProviderSubscriptionId?: string; externalEventId?: string },
  ) {
    if (event.type === "question_pack.paid") {
      const purchaseId = (event as { purchaseId?: string }).purchaseId;
      if (!purchaseId || !event.externalEventId) throw new BadRequestException("Invalid question pack webhook event.");
      await this.questionPacks.applyPaidPurchase(providerKey, purchaseId, event.externalEventId);
      return;
    }
    if (!["subscription.activated", "subscription.canceled", "payment.failed"].includes(event.type)) return;

    // Activation is only ever correlatable by the CHECKOUT SESSION id —
    // that's all we have at checkout-creation time, before the provider
    // has assigned a real subscription. Lifecycle events (cancellation,
    // payment failure) are subscription-level Stripe events and only ever
    // carry the provider's own SUBSCRIPTION id instead — a different
    // identifier that a checkout session id can never be substituted for
    // (see Subscription.externalProviderSubscriptionId). Without the
    // right identifier for the event type, there is nothing to reconcile —
    // this is a safe no-op, not an error (the event can never succeed on
    // retry either, so we don't want to log/retry it).
    const isActivation = event.type === "subscription.activated";
    const lookupValue = isActivation ? event.externalSubscriptionId : event.externalProviderSubscriptionId;
    if (!lookupValue) return;
    if (!event.externalEventId) throw new BadRequestException("A payment event ID is required.");

    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.webhookEventLog.create({
          data: { provider: providerKey, externalEventId: event.externalEventId!, eventType: event.type },
        });
        const subscription = isActivation
          ? await tx.subscription.findFirst({ where: { paymentProvider: providerKey, externalSubscriptionId: lookupValue } })
          : await tx.subscription.findFirst({ where: { paymentProvider: providerKey, externalProviderSubscriptionId: lookupValue } });
        // A delivery can race the checkout session persistence, or arrive
        // for a subscription we haven't (yet) linked. Roll back the marker
        // and request a retry rather than permanently losing the update.
        if (!subscription) throw new NotFoundException("Checkout is not available for reconciliation yet.");
        if (isActivation) {
          const now = new Date();
          const periodEnd = new Date(now);
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          await tx.subscription.updateMany({
            where: { id: subscription.id, status: "pending", paymentProvider: providerKey, externalSubscriptionId: lookupValue },
            data: {
              status: "active",
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              // Captured here — the first verified backend point a real
              // provider subscription id becomes available. Never trusted
              // from client input; this comes only from the signature-
              // verified webhook payload.
              ...(event.externalProviderSubscriptionId ? { externalProviderSubscriptionId: event.externalProviderSubscriptionId } : {}),
            },
          });
        } else {
          // Scoped to the SAME identifier used to find the row (never the
          // checkout session id) — a stale/substituted id cannot match.
          await tx.subscription.updateMany({
            where: { id: subscription.id, paymentProvider: providerKey, externalProviderSubscriptionId: lookupValue },
            data: { status: event.type === "subscription.canceled" ? "canceled" : "past_due" },
          });
        }
      });
    } catch (err: any) {
      // The unique event marker and entitlement change commit together.
      if (err?.code !== "P2002") throw err;
    }
  }
}
