import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentProviderFactory } from "../payments/payment-provider.factory";
import { loadBackendEnv } from "@smartify/config";
import { TutorQuestionPacksService } from "../tutor-question-packs/tutor-question-packs.service";
import { ReferralService } from "../referral/referral.service";
import { isTestStudent, subjectDiscoveryWhere } from "../common/subject-access";
import { hasSubjectEntitlementInList } from "../common/subject-entitlement.util";
import { Prisma } from "@smartify/database";

/**
 * Subject-based pricing (2026-09-20) — Subscription.selectedSubjectIds is a
 * plain Json column (not a typed relation), so every read needs the same
 * defensive parse: a real string array, or an empty array for anything
 * else (null, a historical plan-based row that never set it, or malformed
 * data) — never throws, since this is read at activation time from data
 * this same service already wrote.
 */
function parseSelectedSubjectIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function pendingChange(subscription: { pendingSubjectChange?: unknown }) {
  const value = subscription.pendingSubjectChange as any;
  return value && Array.isArray(value.subjectIds) && Number.isFinite(value.monthlyTotalEGP) ? value as { subjectIds: string[]; monthlyTotalEGP: number; checkoutUrl?: string } : null;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly questionPacks: TutorQuestionPacksService,
    private readonly referralService: ReferralService,
  ) {}

  /**
   * Grants StudentSubject rows for every purchased subject at activation
   * time (subscription.activated webhook, or InstaPay confirm) — the
   * ONLY place "purchased access" is applied. Deliberately reuses the
   * EXISTING StudentSubject table/constraint (createMany + skipDuplicates
   * against its @@unique([studentId, subjectId])), so every existing
   * subject-level entitlement check elsewhere in the codebase (Practice's
   * assertSubjectOwned, Quiz, etc. — all read StudentSubject already)
   * needs zero changes. A no-op for a historical plan-based subscription
   * (selectedSubjectIds null) — those students' subjects were already
   * granted through the old onboarding-time flow.
   */
  private async grantSelectedSubjects(tx: any, studentId: string, selectedSubjectIds: unknown): Promise<void> {
    const subjectIds = parseSelectedSubjectIds(selectedSubjectIds);
    if (subjectIds.length === 0) return;
    await tx.studentSubject.createMany({
      data: subjectIds.map((subjectId) => ({ studentId, subjectId })),
      skipDuplicates: true,
    });
  }

  private async getProfileOrThrow(userId: string) {
    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId }, include: { subjects: true, user: { select: { role: true, isTestStudent: true } }, grade: true, curriculum: true } });
    if (!profile) throw new NotFoundException("Complete onboarding before subscribing.");
    return profile;
  }

  /**
   * Subject-based pricing (2026-09-20) — every Subject in the student's
   * own grade, each with its own independent priceEGP (never a bundle/
   * plan price). A Subject with priceEGP null is still listed (so the
   * student can see it exists) but flagged unpriced — the frontend/
   * checkout must never let one be selected. Never lets a student see
   * (or later select) a Subject outside their own grade.
   */
  async getAvailableSubjects(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const subjects = await this.prisma.client.subject.findMany({
      where: subjectDiscoveryWhere(profile),
      orderBy: { nameEn: "asc" },
    });
    return subjects.map((subject) => ({
      id: subject.id,
      nameEn: subject.nameEn,
      nameAr: subject.nameAr,
      priceEGP: subject.priceEGP != null ? Number(subject.priceEGP) : null,
      entitlement: isTestStudent(profile) || hasSubjectEntitlementInList(profile.subjects, subject.id) ? "ACTIVE" : "LOCKED",
      grade: { nameEn: profile.grade.nameEn, nameAr: profile.grade.nameAr },
      curriculum: { nameEn: profile.curriculum.nameEn, nameAr: profile.curriculum.nameAr },
    }));
  }

  async getCurrentSubscription(userId: string) {
    const profile = await this.getProfileOrThrow(userId);
    const subscription = await this.prisma.client.subscription.findUnique({
      where: { studentId: profile.id },
      include: { pricingPlan: true },
    });
    if (!subscription) return null;

    // Subject-based pricing (2026-09-20): a plan-based historical row has
    // pricingPlan populated and selectedSubjectIds null; a new
    // subject-priced row has the reverse. Resolve the real subject names
    // for display either way, without trusting the JSON list blindly.
    const selectedSubjectIds = subscription.selectedSubjectIds == null
      ? profile.subjects.filter(s => hasSubjectEntitlementInList(profile.subjects, s.subjectId)).map(s => s.subjectId)
      : parseSelectedSubjectIds(subscription.selectedSubjectIds);
    const subjects = selectedSubjectIds.length > 0
      ? await this.prisma.client.subject.findMany({ where: { id: { in: selectedSubjectIds } }, select: { id: true, nameEn: true, nameAr: true } })
      : [];

    return { ...subscription, subjects };
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
        amountEGP: pendingChange(subscription)?.monthlyTotalEGP ?? Number(subscription.monthlyTotalEGP),
      });
      if (result === "paid") return { status: subscription.status === "active" && !pendingChange(subscription) ? "verified" : "pending" };
      return { status: result === "pending" || result === "failed" ? result : "unverified" };
    } catch {
      // Missing credentials, provider outage, or legacy session: never infer payment.
      return { status: "unverified" };
    }
  }

  /**
   * Subject-based pricing (2026-09-20) — validates the selected subjects
   * and upserts a "pending" Subscription row for them, at a
   * server-computed, snapshotted price: the SUM of each selected
   * Subject's own priceEGP, nothing else. No plan, no bundle, no
   * included-subjects discount. Shared by the Stripe checkout path and
   * the InstaPay manual path below. Neither path activates (grants)
   * anything here — this only records WHAT the student is trying to buy,
   * at what price; only ever computed from trusted server-side Subject
   * data, never from a client-supplied total.
   */
  private async resolvePendingSubscription(userId: string, input: { subjectIds: string[] }) {
    const profile = await this.getProfileOrThrow(userId);

    const selectedSubjectIds = [...new Set(input.subjectIds ?? [])];
    if (selectedSubjectIds.length === 0) {
      throw new BadRequestException("Select at least one subject.");
    }

    const subjects = await this.prisma.client.subject.findMany({ where: { id: { in: selectedSubjectIds }, ...subjectDiscoveryWhere(profile) } });
    if (subjects.length !== selectedSubjectIds.length) {
      throw new BadRequestException("One or more selected subjects are invalid.");
    }
    const unpriced = subjects.filter((subject) => subject.priceEGP == null);
    if (unpriced.length > 0) {
      throw new BadRequestException(`The following subject(s) are not yet available for purchase: ${unpriced.map((s) => s.nameEn).join(", ")}.`);
    }

    const monthlyTotalEGP = subjects.reduce((sum, subject) => sum + Number(subject.priceEGP), 0);

    const existing = await this.prisma.client.subscription.findUnique({ where: { studentId: profile.id } });
    if (existing?.status === "active") {
      const previousIds = existing.selectedSubjectIds == null ? profile.subjects.filter(s => hasSubjectEntitlementInList(profile.subjects, s.subjectId)).map(s => s.subjectId) : parseSelectedSubjectIds(existing.selectedSubjectIds);
      if (previousIds.some(id => !selectedSubjectIds.includes(id))) throw new BadRequestException("Keep your current subjects selected when adding a subject.");
      if (selectedSubjectIds.every(id => previousIds.includes(id))) throw new BadRequestException("Select an additional subject.");
      const pending = pendingChange(existing);
      if (pending) {
        if (pending.subjectIds.length !== selectedSubjectIds.length || pending.subjectIds.some(id => !selectedSubjectIds.includes(id))) throw new BadRequestException("A subject change is already awaiting payment. Complete it before starting another.");
        return { subjects, monthlyTotalEGP: pending.monthlyTotalEGP, subscription: existing, change: pending, resume: true };
      }
      const claimed = await this.prisma.client.subscription.updateMany({ where: { id: existing.id, status: "active", pendingSubjectChange: { equals: Prisma.DbNull } },
        data: { pendingSubjectChange: { subjectIds: selectedSubjectIds, monthlyTotalEGP } } });
      if (claimed.count !== 1) throw new BadRequestException("A subject change is already awaiting payment.");
      return { subjects, monthlyTotalEGP, subscription: existing, change: { subjectIds: selectedSubjectIds, monthlyTotalEGP }, resume: false };
    }

    const subscription = await this.prisma.client.subscription.upsert({
      where: { studentId: profile.id },
      update: { pricingPlanId: null, additionalSubjectsCount: 0, selectedSubjectIds, monthlyTotalEGP, status: "pending" },
      create: {
        studentId: profile.id,
        pricingPlanId: null,
        additionalSubjectsCount: 0,
        selectedSubjectIds,
        monthlyTotalEGP,
        status: "pending",
      },
    });

    return { subjects, monthlyTotalEGP, subscription, change: null, resume: false };
  }

  /**
   * Starts checkout for the student's selected subjects. Creates a local
   * Subscription row in "pending" status BEFORE redirecting to the
   * payment provider, so the webhook has something concrete to activate —
   * the row is the source of truth, the provider session is just how
   * money actually moves.
   */
  async startCheckout(userId: string, input: { subjectIds: string[] }) {
    const { provider, providerKey } = await this.providerFactory.getActiveProvider();
    const { subjects, monthlyTotalEGP, subscription, change, resume } = await this.resolvePendingSubscription(userId, input);
    if (resume) {
      if (!change?.checkoutUrl) throw new BadRequestException("Continue your pending payment with its original payment method.");
      return { checkoutUrl: change.checkoutUrl };
    }
    const env = loadBackendEnv();

    const params = {
      studentUserId: userId,
      subscriptionId: subscription.id,
      amountEGP: monthlyTotalEGP,
      description: `Smartify AI — ${subjects.map((s) => s.nameEn).join(", ")}`,
      successUrl: `${env.FRONTEND_URL}/billing/success`,
      cancelUrl: `${env.FRONTEND_URL}/billing`,
    };
    let session;
    try { if (change) {
      if (subscription.paymentProvider !== providerKey || !subscription.externalProviderSubscriptionId || !provider.createSubscriptionUpgrade) {
        throw new ServiceUnavailableException("Your existing payment provider cannot add subjects online yet. Contact support to update your subscription.");
      }
      session = await provider.createSubscriptionUpgrade({ ...params, externalProviderSubscriptionId: subscription.externalProviderSubscriptionId });
    } else session = await provider.createCheckoutSession(params);
    } catch (error) {
      if (change) await this.prisma.client.subscription.updateMany({ where: { id: subscription.id, pendingSubjectChange: { equals: change } }, data: { pendingSubjectChange: Prisma.DbNull } });
      throw error;
    }

    await this.prisma.client.subscription.update({
      where: { id: subscription.id },
      data: { paymentProvider: providerKey, externalSubscriptionId: session.externalSessionId,
        ...(change ? { pendingSubjectChange: { ...change, checkoutUrl: session.checkoutUrl } } : {}) },
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
  async startInstapayCheckout(userId: string, input: { subjectIds: string[] }) {
    const env = loadBackendEnv();
    if (!env.INSTAPAY_RECIPIENT_NAME || !env.INSTAPAY_RECIPIENT_HANDLE) {
      throw new ServiceUnavailableException("InstaPay is not configured on this environment yet.");
    }
    const { monthlyTotalEGP, subscription, change, resume } = await this.resolvePendingSubscription(userId, input);
    if (change && subscription.paymentProvider !== "instapay") {
      await this.prisma.client.subscription.updateMany({ where: { id: subscription.id, pendingSubjectChange: { equals: change } }, data: { pendingSubjectChange: Prisma.DbNull } });
      throw new BadRequestException("Use your existing payment provider to add subjects.");
    }

    // "S-" prefix distinguishes this from a question-pack reference so
    // InstapayService can resolve which table to query without ambiguity.
    const referenceId = resume ? subscription.externalSubscriptionId! : `SMAI-S-${randomUUID().slice(0, 8).toUpperCase()}`;
    if (!resume) await this.prisma.client.subscription.update({
      where: { id: subscription.id },
      data: { paymentProvider: "instapay", externalSubscriptionId: referenceId, ...(change ? { pendingSubjectChange: change } : {}) },
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
          const change = pendingChange(subscription);
          const now = new Date();
          const periodEnd = new Date(now);
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          const activated = await tx.subscription.updateMany({
            where: { id: subscription.id, status: change ? "active" : "pending", paymentProvider: providerKey, externalSubscriptionId: lookupValue },
            data: {
              status: "active",
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              ...(change ? { selectedSubjectIds: change.subjectIds, monthlyTotalEGP: change.monthlyTotalEGP, pendingSubjectChange: Prisma.DbNull } : {}),
              // Captured here — the first verified backend point a real
              // provider subscription id becomes available. Never trusted
              // from client input; this comes only from the signature-
              // verified webhook payload.
              ...(event.externalProviderSubscriptionId ? { externalProviderSubscriptionId: event.externalProviderSubscriptionId } : {}),
            },
          });
          if (activated.count !== 1) return;
          // Subject-based pricing (2026-09-20): grant access to exactly
          // what was paid for, in the SAME transaction as activation —
          // either both commit or neither does. No-op for a historical
          // plan-based row (selectedSubjectIds null).
          await this.grantSelectedSubjects(tx, subscription.studentId, change?.subjectIds ?? subscription.selectedSubjectIds);
          // Referral V1 (2026-09-20): this is the referred student's
          // FIRST successful paid activation trigger point — see
          // ReferralService.earnRewardWithinTransaction's own doc comment
          // for why this is safe against resubscribes and webhook retries.
          await this.referralService.earnRewardWithinTransaction(tx, subscription.studentId);
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

  /**
   * InstaPay confirm's own activation path (AdminInstapayService.confirm(),
   * SUBSCRIPTION kind only) — deliberately NOT routed through
   * applyWebhookEvent. That method is built for real payment-provider
   * webhooks, which only ever carry the provider's own external reference
   * and must re-derive which Subscription row it belongs to by matching
   * Subscription.externalSubscriptionId. InstaPay is a manual, out-of-band
   * flow: a student can reopen checkout after already submitting a receipt
   * (page reload, double-click, browser back/forward), which mints a fresh
   * reference and silently overwrites externalSubscriptionId on the same
   * Subscription row — orphaning the earlier reference the receipt was
   * actually submitted against. Found 2026-09-19 via a real stuck "Checkout
   * is not available for reconciliation yet." confirm failure: the
   * submission's referenceId no longer matched its own Subscription's
   * externalSubscriptionId. InstapayPaymentSubmission.subscriptionId is a
   * durable FK captured once at submission time and never rewritten, so
   * activating by that id directly sidesteps the whole reference-drift
   * class of bug rather than papering over one instance of it. Shares the
   * same WebhookEventLog idempotency guarantee as applyWebhookEvent so a
   * retried confirm() still can't double-activate.
   */
  async activateInstapaySubscription(subscriptionId: string, externalEventId: string, referenceId?: string) {
    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.webhookEventLog.create({
          data: { provider: "instapay", externalEventId, eventType: "subscription.activated" },
        });
        const subscription = await tx.subscription.findUnique({ where: { id: subscriptionId } });
        if (!subscription) throw new NotFoundException("Subscription not found for this payment.");
        const change = pendingChange(subscription);
        if (change && referenceId !== subscription.externalSubscriptionId) throw new BadRequestException("This receipt does not match the pending subject change.");
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        const activated = await tx.subscription.updateMany({
          where: { id: subscription.id, status: change ? "active" : "pending" },
          data: { status: "active", currentPeriodStart: now, currentPeriodEnd: periodEnd,
            ...(change ? { selectedSubjectIds: change.subjectIds, monthlyTotalEGP: change.monthlyTotalEGP, pendingSubjectChange: Prisma.DbNull } : {}) },
        });
        if (activated.count !== 1) return;
        // Subject-based pricing (2026-09-20) — see applyWebhookEvent's
        // identical call for the full rationale.
        await this.grantSelectedSubjects(tx, subscription.studentId, change?.subjectIds ?? subscription.selectedSubjectIds);
        // Referral V1 (2026-09-20) — see applyWebhookEvent's identical call.
        await this.referralService.earnRewardWithinTransaction(tx, subscription.studentId);
      });
    } catch (err: any) {
      if (err?.code !== "P2002") throw err;
    }
  }
}
