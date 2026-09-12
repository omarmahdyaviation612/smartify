import { BadRequestException } from "@nestjs/common";
import { BillingService } from "./billing.service";

/**
 * Covers the core business rules that must never regress: a student
 * can't check out a plan for a curriculum they're not enrolled in, and
 * the total price is computed correctly from the plan + extra subjects.
 * Uses mocked Prisma + PaymentProviderFactory — no real provider or DB.
 */
describe("BillingService", () => {
  const studentProfile = { id: "student-1", curriculumId: "curriculum-A" };
  const requiredEnv = {
    DATABASE_URL: "postgresql://test:test@localhost:5432/smartify_test",
    REDIS_URL: "redis://localhost:6379",
    CLERK_SECRET_KEY: "sk_test_unit",
    CLERK_PUBLISHABLE_KEY: "pk_test_unit",
    CLERK_WEBHOOK_SIGNING_SECRET: "whsec_test_unit",
    FRONTEND_URL: "http://localhost:3000",
  };
  const originalEnv = { ...process.env };

  beforeAll(() => {
    Object.assign(process.env, requiredEnv);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function makePrismaMock(overrides: Partial<{ plan: any; subscriptionUpsert: jest.Mock; subscriptionFindFirst: any; webhookEventLogCreate: jest.Mock }> = {}) {
    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        pricingPlan: { findUnique: jest.fn().mockResolvedValue(overrides.plan) },
        subscription: {
          upsert: overrides.subscriptionUpsert ?? jest.fn().mockResolvedValue({ id: "sub-1" }),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn(),
          findFirst: jest.fn().mockResolvedValue(overrides.subscriptionFindFirst ?? { id: "sub-1", externalSubscriptionId: "sess_1" }),
        },
        webhookEventLog: {
          create: overrides.webhookEventLogCreate ?? jest.fn().mockResolvedValue({ id: "log-1" }),
        },
      },
    } as any;
    prisma.client.$transaction = (callback: any) => callback(prisma.client);
    return prisma;
  }

  function makeProviderFactoryMock() {
    return {
      getActiveProvider: jest.fn().mockResolvedValue({
        provider: { createCheckoutSession: jest.fn().mockResolvedValue({ checkoutUrl: "https://example.test/checkout", externalSessionId: "sess_1" }) },
        providerKey: "stripe",
      }),
      getProviderByKey: jest.fn(),
    } as any;
  }

  it("rejects checkout for a plan that belongs to a different curriculum than the student's", async () => {
    const prisma = makePrismaMock({ plan: { id: "plan-1", curriculumId: "curriculum-B", isActive: true, monthlyPriceEGP: 300, additionalSubjectPriceEGP: 100 } });
    const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any);

    await expect(service.startCheckout("user-1", { pricingPlanId: "plan-1" })).rejects.toThrow(BadRequestException);
  });

  it("rejects checkout for a plan that is not active", async () => {
    const prisma = makePrismaMock({ plan: { id: "plan-1", curriculumId: "curriculum-A", isActive: false, monthlyPriceEGP: 300, additionalSubjectPriceEGP: 100 } });
    const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any);

    await expect(service.startCheckout("user-1", { pricingPlanId: "plan-1" })).rejects.toThrow(BadRequestException);
  });

  it("computes monthlyTotalEGP as base price + (extra subjects * additional subject price)", async () => {
    const subscriptionUpsert = jest.fn().mockResolvedValue({ id: "sub-1" });
    const prisma = makePrismaMock({
      plan: { id: "plan-1", curriculumId: "curriculum-A", isActive: true, monthlyPriceEGP: 300, additionalSubjectPriceEGP: 130, levelCodeEn: "Primary", includedSubjects: 3 },
      subscriptionUpsert,
    });
    const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any);

    await service.startCheckout("user-1", { pricingPlanId: "plan-1", additionalSubjectsCount: 2 });

    const upsertArgs = subscriptionUpsert.mock.calls[0][0];
    expect(upsertArgs.create.monthlyTotalEGP).toBe(300 + 2 * 130);
    expect(upsertArgs.create.additionalSubjectsCount).toBe(2);
  });

  it("treats a negative additionalSubjectsCount as zero rather than reducing the price", async () => {
    const subscriptionUpsert = jest.fn().mockResolvedValue({ id: "sub-1" });
    const prisma = makePrismaMock({
      plan: { id: "plan-1", curriculumId: "curriculum-A", isActive: true, monthlyPriceEGP: 300, additionalSubjectPriceEGP: 130, levelCodeEn: "Primary", includedSubjects: 3 },
      subscriptionUpsert,
    });
    const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any);

    await service.startCheckout("user-1", { pricingPlanId: "plan-1", additionalSubjectsCount: -5 });

    const upsertArgs = subscriptionUpsert.mock.calls[0][0];
    expect(upsertArgs.create.monthlyTotalEGP).toBe(300);
  });

  describe("cancelSubscription", () => {
    function makeCancelPrisma(subscription: any) {
      const prisma = makePrismaMock();
      prisma.client.subscription.findUnique = jest.fn().mockResolvedValue(subscription);
      return prisma;
    }

    it("cancels an InstaPay-paid subscription locally without calling any payment provider", async () => {
      const prisma = makeCancelPrisma({ id: "sub-1", status: "active", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-ABC" });
      const providerFactory = makeProviderFactoryMock();
      const service = new BillingService(prisma, providerFactory, { applyPaidPurchase: jest.fn() } as any);

      await service.cancelSubscription("user-1");

      expect(providerFactory.getProviderByKey).not.toHaveBeenCalled();
      expect(prisma.client.subscription.update).toHaveBeenCalledWith({
        where: { id: "sub-1" },
        data: { status: "canceled" },
        include: { pricingPlan: true },
      });
    });

    it("falls back to the checkout session id for a historical Stripe subscription with no stored provider subscription id", async () => {
      const prisma = makeCancelPrisma({ id: "sub-1", status: "active", paymentProvider: "stripe", externalSubscriptionId: "sess_1" });
      const cancelSubscription = jest.fn().mockResolvedValue(undefined);
      const providerFactory = makeProviderFactoryMock();
      providerFactory.getProviderByKey.mockResolvedValue({ cancelSubscription });
      const service = new BillingService(prisma, providerFactory, { applyPaidPurchase: jest.fn() } as any);

      await service.cancelSubscription("user-1");

      expect(providerFactory.getProviderByKey).toHaveBeenCalledWith("stripe");
      expect(cancelSubscription).toHaveBeenCalledWith("sess_1");
      expect(prisma.client.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ include: { pricingPlan: true } }));
    });

    it("prefers the real Stripe subscription id over the checkout session id when both are known", async () => {
      const prisma = makeCancelPrisma({
        id: "sub-1",
        status: "active",
        paymentProvider: "stripe",
        externalSubscriptionId: "sess_1",
        externalProviderSubscriptionId: "sub_stripe_real",
      });
      const cancelSubscription = jest.fn().mockResolvedValue(undefined);
      const providerFactory = makeProviderFactoryMock();
      providerFactory.getProviderByKey.mockResolvedValue({ cancelSubscription });
      const service = new BillingService(prisma, providerFactory, { applyPaidPurchase: jest.fn() } as any);

      await service.cancelSubscription("user-1");

      // Stripe's cancel API expects its own subscription id, not the
      // checkout session id — passing the wrong one would fail against
      // the real Stripe API.
      expect(cancelSubscription).toHaveBeenCalledWith("sub_stripe_real");
      expect(cancelSubscription).not.toHaveBeenCalledWith("sess_1");
    });
  });

  describe("applyWebhookEvent — idempotency (Phase 10)", () => {
    it("applies the subscription-activated effect on first delivery of an event", async () => {
      const prisma = makePrismaMock();
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any);

      await service.applyWebhookEvent("stripe", {
        type: "subscription.activated",
        externalSubscriptionId: "sess_1",
        externalEventId: "evt_123",
      });

      expect(prisma.client.webhookEventLog.create).toHaveBeenCalledWith({
        data: { provider: "stripe", externalEventId: "evt_123", eventType: "subscription.activated" },
      });
      expect(prisma.client.subscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "active" }) }),
      );
    });

    it("does NOT re-apply the effect when the same externalEventId is delivered a second time", async () => {
      const duplicateKeyError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      const webhookEventLogCreate = jest.fn().mockRejectedValue(duplicateKeyError);
      const prisma = makePrismaMock({ webhookEventLogCreate });
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any);

      await service.applyWebhookEvent("stripe", {
        type: "subscription.activated",
        externalSubscriptionId: "sess_1",
        externalEventId: "evt_123",
      });

      // The log insert was attempted (and hit the unique constraint) but
      // the actual subscription update must never have been reached —
      // this is what prevents a duplicate delivery from resetting
      // currentPeriodStart/End a second time.
      expect(prisma.client.subscription.update).not.toHaveBeenCalled();
      expect(prisma.client.subscription.updateMany).not.toHaveBeenCalled();
      expect(prisma.client.subscription.findFirst).not.toHaveBeenCalled();
    });

    it("re-throws a genuinely unexpected database error rather than silently swallowing it as a duplicate", async () => {
      const realDbError = new Error("connection refused");
      const webhookEventLogCreate = jest.fn().mockRejectedValue(realDbError);
      const prisma = makePrismaMock({ webhookEventLogCreate });
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any);

      await expect(
        service.applyWebhookEvent("stripe", {
          type: "subscription.activated",
          externalSubscriptionId: "sess_1",
          externalEventId: "evt_456",
        }),
      ).rejects.toThrow("connection refused");
    });

    it("ignores events with no externalSubscriptionId (nothing to reconcile) without erroring", async () => {
      const prisma = makePrismaMock();
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any);

      await expect(
        service.applyWebhookEvent("stripe", { type: "unknown", externalEventId: "evt_789" }),
      ).resolves.toBeUndefined();
    });

    // FIXED (previously a confirmed gap): "subscription.canceled"/
    // "payment.failed" are now looked up by externalProviderSubscriptionId
    // (the real Stripe subscription id), never externalSubscriptionId (the
    // checkout session id) — see billing-lifecycle-webhook.spec.ts for the
    // full lifecycle regression suite. This test covers the remaining
    // defensive edge case: if a lifecycle event somehow arrives with
    // NEITHER identifier, it must still be a safe, silent no-op rather
    // than an error or a crash.
    it.each(["subscription.canceled", "payment.failed"])(
      "a %s event with no externalProviderSubscriptionId at all is a silent no-op — it never reaches the DB",
      async (type) => {
        const prisma = makePrismaMock();
        const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any);

        await expect(
          service.applyWebhookEvent("stripe", { type, externalEventId: `evt_${type}` }),
        ).resolves.toBeUndefined();
        expect(prisma.client.webhookEventLog.create).not.toHaveBeenCalled();
        expect(prisma.client.subscription.update).not.toHaveBeenCalled();
        expect(prisma.client.subscription.updateMany).not.toHaveBeenCalled();
      },
    );
  });

  describe("checkout session substitution safety", () => {
    it("cannot activate at an earlier (abandoned) checkout session's price after the student starts a second, different checkout", async () => {
      // Student starts checkout for Plan A (cheap) — row now points at session "cs_planA".
      const planA = { id: "plan-a", curriculumId: "curriculum-A", isActive: true, monthlyPriceEGP: 300, additionalSubjectPriceEGP: 100, levelCodeEn: "Primary", includedSubjects: 3 };
      const planB = { id: "plan-b", curriculumId: "curriculum-A", isActive: true, monthlyPriceEGP: 900, additionalSubjectPriceEGP: 100, levelCodeEn: "Secondary", includedSubjects: 3 };
      let currentPlan = planA;
      let externalSubscriptionId = "";
      const prisma = makePrismaMock({
        plan: undefined,
        subscriptionUpsert: jest.fn().mockImplementation(async () => ({ id: "sub-1" })),
      });
      prisma.client.pricingPlan.findUnique = jest.fn().mockImplementation(async () => currentPlan);
      prisma.client.subscription.update = jest.fn().mockImplementation(async ({ data }: any) => {
        if (data.externalSubscriptionId) externalSubscriptionId = data.externalSubscriptionId;
      });
      prisma.client.subscription.findFirst = jest.fn().mockImplementation(async ({ where }: any) =>
        where.externalSubscriptionId === externalSubscriptionId ? { id: "sub-1", status: "pending" } : null,
      );
      prisma.client.subscription.updateMany = jest.fn().mockImplementation(async ({ where }: any) =>
        where.externalSubscriptionId === externalSubscriptionId ? { count: 1 } : { count: 0 },
      );

      const providerFactory = {
        getActiveProvider: jest.fn().mockImplementation(async () => ({
          provider: { createCheckoutSession: jest.fn().mockResolvedValue({ checkoutUrl: "https://example.test/a", externalSessionId: "cs_planA" }) },
          providerKey: "stripe",
        })),
        getProviderByKey: jest.fn(),
      };
      const service = new BillingService(prisma, providerFactory as any, { applyPaidPurchase: jest.fn() } as any);
      await service.startCheckout("user-1", { pricingPlanId: "plan-a" });
      expect(externalSubscriptionId).toBe("cs_planA");

      // Student changes their mind and starts checkout for Plan B instead —
      // the SAME Subscription row (by studentId) now points at "cs_planB".
      currentPlan = planB;
      providerFactory.getActiveProvider.mockResolvedValueOnce({
        provider: { createCheckoutSession: jest.fn().mockResolvedValue({ checkoutUrl: "https://example.test/b", externalSessionId: "cs_planB" }) },
        providerKey: "stripe",
      });
      await service.startCheckout("user-1", { pricingPlanId: "plan-b" });
      expect(externalSubscriptionId).toBe("cs_planB");

      // The abandoned Plan A checkout is later completed anyway (e.g. the
      // student never closed that browser tab). Its webhook must NOT
      // activate anything — the row it would need to match no longer
      // points at that session (it now points at "cs_planB"), so this
      // safely fails closed (NotFoundException, requesting a retry) rather
      // than activating Plan A's price on a row that has since moved on.
      await expect(
        service.applyWebhookEvent("stripe", {
          type: "subscription.activated",
          externalSubscriptionId: "cs_planA",
          externalEventId: "evt_planA",
        }),
      ).rejects.toThrow();
      expect(prisma.client.subscription.updateMany).not.toHaveBeenCalled();
    });
  });
});
