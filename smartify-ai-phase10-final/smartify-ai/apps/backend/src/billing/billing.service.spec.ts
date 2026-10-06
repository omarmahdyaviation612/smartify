import { BadRequestException } from "@nestjs/common";
import { BillingService } from "./billing.service";

// Referral V1 (2026-09-20) — BillingService calls this unconditionally at
// activation now; mocked as a plain collaborator here (never exercising
// its own transaction logic) since ReferralService's real behavior is
// covered by referral.service.spec.ts, not this file.
const referralServiceMock = { earnRewardWithinTransaction: jest.fn().mockResolvedValue(undefined) } as any;

/**
 * Covers the core business rules that must never regress. Subject-based
 * pricing (2026-09-20): a student can't check out a Subject outside their
 * own grade, an unpriced Subject can never be bought, and the total is
 * always the server-computed SUM of the selected Subjects' own priceEGP —
 * never a client-supplied total, no bundle/plan discount. Uses mocked
 * Prisma + PaymentProviderFactory — no real provider or DB.
 */
describe("BillingService", () => {
  const studentProfile = { id: "student-1", curriculumId: "curriculum-A", gradeId: "grade-A" };
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

  function makePrismaMock(
    overrides: Partial<{ subjects: any[]; subscriptionUpsert: jest.Mock; subscriptionFindFirst: any; webhookEventLogCreate: jest.Mock }> = {},
  ) {
    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        // `subjects` here is what this grade OFFERS (the GradeSubject rows the
        // real query joins through). Availability is an offering question now,
        // not a property of the Subject row.
        gradeSubject: {
          findMany: jest.fn().mockImplementation(async ({ where }: any) =>
            (overrides.subjects ?? [])
              .filter((s: any) => (where.subjectId ? where.subjectId.in.includes(s.id) : true))
              .map((s: any) => ({ subject: s })),
          ),
        },
        subject: { findMany: jest.fn().mockResolvedValue(overrides.subjects ?? []) },
        studentSubject: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
        subscription: {
          upsert: overrides.subscriptionUpsert ?? jest.fn().mockResolvedValue({ id: "sub-1" }),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn(),
          findFirst: jest.fn().mockResolvedValue(overrides.subscriptionFindFirst ?? { id: "sub-1", studentId: "student-1", externalSubscriptionId: "sess_1", selectedSubjectIds: null }),
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

  it("rejects checkout with no subjects selected", async () => {
    const prisma = makePrismaMock();
    const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

    await expect(service.startCheckout("user-1", { subjectIds: [] })).rejects.toThrow(BadRequestException);
  });

  it("rejects checkout for a subject outside the student's own grade", async () => {
    // gradeSubject is what scopes availability now — returning fewer subjects than requested means the grade doesn't offer one of them.
    const prisma = makePrismaMock({ subjects: [{ id: "math", nameEn: "Math", priceEGP: 100 }] });
    const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

    await expect(service.startCheckout("user-1", { subjectIds: ["math", "science-other-grade"] })).rejects.toThrow(BadRequestException);
  });

  it("rejects checkout for a subject that has no priceEGP set yet", async () => {
    const prisma = makePrismaMock({ subjects: [{ id: "math", nameEn: "Math", priceEGP: 100 }, { id: "art", nameEn: "Art", priceEGP: null }] });
    const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

    await expect(service.startCheckout("user-1", { subjectIds: ["math", "art"] })).rejects.toThrow(/not yet available/);
  });

  it("computes monthlyTotalEGP as the sum of each selected Subject's own priceEGP — no bundle, no discount", async () => {
    const subscriptionUpsert = jest.fn().mockResolvedValue({ id: "sub-1" });
    const prisma = makePrismaMock({
      subjects: [{ id: "math", nameEn: "Math", priceEGP: 150 }, { id: "science", nameEn: "Science", priceEGP: 175 }, { id: "art", nameEn: "Art", priceEGP: 90 }],
      subscriptionUpsert,
    });
    const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

    await service.startCheckout("user-1", { subjectIds: ["math", "science", "art"] });

    const upsertArgs = subscriptionUpsert.mock.calls[0][0];
    expect(upsertArgs.create.monthlyTotalEGP).toBe(150 + 175 + 90);
    expect(upsertArgs.create.selectedSubjectIds).toEqual(["math", "science", "art"]);
    expect(upsertArgs.create.pricingPlanId).toBeNull();
  });

  it("a single selected subject costs exactly that subject's own price", async () => {
    const subscriptionUpsert = jest.fn().mockResolvedValue({ id: "sub-1" });
    const prisma = makePrismaMock({ subjects: [{ id: "math", nameEn: "Math", priceEGP: 150 }], subscriptionUpsert });
    const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

    await service.startCheckout("user-1", { subjectIds: ["math"] });

    expect(subscriptionUpsert.mock.calls[0][0].create.monthlyTotalEGP).toBe(150);
  });

  it("lists a shared subject offered by the student's grade, priced from its content home", async () => {
    // The subject's own gradeId is the Egyptian grade (its content home); the
    // student's grade is grade-A. Under the old rule this subject was invisible.
    const sharedArabic = { id: "subject-arabic-eg5", gradeId: "grade-eg-5", isActive: true, nameEn: "Arabic", nameAr: "اللغة العربية", priceEGP: 150 };
    const prisma = makePrismaMock({ subjects: [sharedArabic] });
    const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

    await expect(service.getAvailableSubjects("user-1")).resolves.toEqual([
      { id: sharedArabic.id, nameEn: "Arabic", nameAr: "اللغة العربية", priceEGP: 150 },
    ]);
    expect(prisma.client.gradeSubject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ gradeId: "grade-A" }) }),
    );
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
      const service = new BillingService(prisma, providerFactory, { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

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
      const service = new BillingService(prisma, providerFactory, { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

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
      const service = new BillingService(prisma, providerFactory, { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

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
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

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
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

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
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

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
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

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
        const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

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
      // Student starts checkout for Selection A (cheap: just Math) — row now points at session "cs_selA".
      const selectionA = [{ id: "math", nameEn: "Math", priceEGP: 300 }];
      const selectionB = [{ id: "math", nameEn: "Math", priceEGP: 300 }, { id: "science", nameEn: "Science", priceEGP: 600 }];
      let currentSubjects = selectionA;
      let externalSubscriptionId = "";
      const prisma = makePrismaMock({
        subscriptionUpsert: jest.fn().mockImplementation(async () => ({ id: "sub-1" })),
      });
      prisma.client.gradeSubject.findMany = jest.fn().mockImplementation(async ({ where }: any) =>
        currentSubjects
          .filter((s: any) => (where.subjectId ? where.subjectId.in.includes(s.id) : true))
          .map((s: any) => ({ subject: s })),
      );
      prisma.client.subscription.update = jest.fn().mockImplementation(async ({ data }: any) => {
        if (data.externalSubscriptionId) externalSubscriptionId = data.externalSubscriptionId;
      });
      prisma.client.subscription.findFirst = jest.fn().mockImplementation(async ({ where }: any) =>
        where.externalSubscriptionId === externalSubscriptionId ? { id: "sub-1", studentId: "student-1", status: "pending", selectedSubjectIds: null } : null,
      );
      prisma.client.subscription.updateMany = jest.fn().mockImplementation(async ({ where }: any) =>
        where.externalSubscriptionId === externalSubscriptionId ? { count: 1 } : { count: 0 },
      );

      const providerFactory = {
        getActiveProvider: jest.fn().mockImplementation(async () => ({
          provider: { createCheckoutSession: jest.fn().mockResolvedValue({ checkoutUrl: "https://example.test/a", externalSessionId: "cs_selA" }) },
          providerKey: "stripe",
        })),
        getProviderByKey: jest.fn(),
      };
      const service = new BillingService(prisma, providerFactory as any, { applyPaidPurchase: jest.fn() } as any, referralServiceMock);
      await service.startCheckout("user-1", { subjectIds: ["math"] });
      expect(externalSubscriptionId).toBe("cs_selA");

      // Student changes their mind and starts checkout for Selection B instead —
      // the SAME Subscription row (by studentId) now points at "cs_selB".
      currentSubjects = selectionB;
      providerFactory.getActiveProvider.mockResolvedValueOnce({
        provider: { createCheckoutSession: jest.fn().mockResolvedValue({ checkoutUrl: "https://example.test/b", externalSessionId: "cs_selB" }) },
        providerKey: "stripe",
      });
      await service.startCheckout("user-1", { subjectIds: ["math", "science"] });
      expect(externalSubscriptionId).toBe("cs_selB");

      // The abandoned Selection A checkout is later completed anyway (e.g.
      // the student never closed that browser tab). Its webhook must NOT
      // activate anything — the row it would need to match no longer
      // points at that session (it now points at "cs_selB"), so this
      // safely fails closed (NotFoundException, requesting a retry) rather
      // than activating Selection A's (cheaper) access on a row that has
      // since moved on to Selection B.
      await expect(
        service.applyWebhookEvent("stripe", {
          type: "subscription.activated",
          externalSubscriptionId: "cs_selA",
          externalEventId: "evt_selA",
        }),
      ).rejects.toThrow();
      expect(prisma.client.subscription.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("subject entitlement granting at activation (subject-based pricing)", () => {
    it("grants StudentSubject rows for every selected subject when a subscription activates", async () => {
      const prisma = makePrismaMock({
        subscriptionFindFirst: { id: "sub-1", studentId: "student-1", status: "pending", externalSubscriptionId: "sess_1", selectedSubjectIds: ["math", "science"] },
      });
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

      await service.applyWebhookEvent("stripe", { type: "subscription.activated", externalSubscriptionId: "sess_1", externalEventId: "evt_1" });

      expect(prisma.client.studentSubject.createMany).toHaveBeenCalledWith({
        data: [{ studentId: "student-1", subjectId: "math" }, { studentId: "student-1", subjectId: "science" }],
        skipDuplicates: true,
      });
    });

    it("does nothing (no createMany call) for a historical plan-based subscription with no selectedSubjectIds", async () => {
      const prisma = makePrismaMock({
        subscriptionFindFirst: { id: "sub-1", studentId: "student-1", status: "pending", externalSubscriptionId: "sess_1", selectedSubjectIds: null },
      });
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralServiceMock);

      await service.applyWebhookEvent("stripe", { type: "subscription.activated", externalSubscriptionId: "sess_1", externalEventId: "evt_1" });

      expect(prisma.client.studentSubject.createMany).not.toHaveBeenCalled();
    });
  });

  describe("referral reward earning at activation (Referral V1)", () => {
    it("Stripe activation (applyWebhookEvent) calls earnRewardWithinTransaction for the activated student", async () => {
      const referralService = { earnRewardWithinTransaction: jest.fn().mockResolvedValue(undefined) };
      const prisma = makePrismaMock({
        subscriptionFindFirst: { id: "sub-1", studentId: "student-1", status: "pending", externalSubscriptionId: "sess_1", selectedSubjectIds: null },
      });
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralService as any);

      await service.applyWebhookEvent("stripe", { type: "subscription.activated", externalSubscriptionId: "sess_1", externalEventId: "evt_1" });

      expect(referralService.earnRewardWithinTransaction).toHaveBeenCalledWith(expect.anything(), "student-1");
    });

    it("confirmed InstaPay activation (activateInstapaySubscription) calls earnRewardWithinTransaction for the activated student", async () => {
      const referralService = { earnRewardWithinTransaction: jest.fn().mockResolvedValue(undefined) };
      const prisma = makePrismaMock();
      prisma.client.subscription.findUnique.mockResolvedValue({ id: "sub-1", studentId: "student-1", status: "pending", selectedSubjectIds: null });
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralService as any);

      await service.activateInstapaySubscription("sub-1", "evt_instapay_1");

      expect(referralService.earnRewardWithinTransaction).toHaveBeenCalledWith(expect.anything(), "student-1");
    });

    it("a duplicate webhook delivery (externalEventId already logged) never calls earnRewardWithinTransaction at all", async () => {
      const referralService = { earnRewardWithinTransaction: jest.fn().mockResolvedValue(undefined) };
      const duplicateKeyError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      const webhookEventLogCreate = jest.fn().mockRejectedValue(duplicateKeyError);
      const prisma = makePrismaMock({ webhookEventLogCreate });
      const service = new BillingService(prisma, makeProviderFactoryMock(), { applyPaidPurchase: jest.fn() } as any, referralService as any);

      await service.applyWebhookEvent("stripe", { type: "subscription.activated", externalSubscriptionId: "sess_1", externalEventId: "evt_dup" });

      expect(referralService.earnRewardWithinTransaction).not.toHaveBeenCalled();
    });
  });
});
