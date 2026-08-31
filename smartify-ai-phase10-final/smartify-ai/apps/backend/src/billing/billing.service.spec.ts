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
    return {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        pricingPlan: { findUnique: jest.fn().mockResolvedValue(overrides.plan) },
        subscription: {
          upsert: overrides.subscriptionUpsert ?? jest.fn().mockResolvedValue({ id: "sub-1" }),
          update: jest.fn().mockResolvedValue({}),
          findUnique: jest.fn(),
          findFirst: jest.fn().mockResolvedValue(overrides.subscriptionFindFirst ?? { id: "sub-1", externalSubscriptionId: "sess_1" }),
        },
        webhookEventLog: {
          create: overrides.webhookEventLogCreate ?? jest.fn().mockResolvedValue({ id: "log-1" }),
        },
      },
    } as any;
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
      expect(prisma.client.subscription.update).toHaveBeenCalledWith(
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
  });
});
