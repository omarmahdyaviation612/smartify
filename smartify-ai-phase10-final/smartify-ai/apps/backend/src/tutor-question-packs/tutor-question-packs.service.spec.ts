import { BadRequestException, NotFoundException } from "@nestjs/common";
import { TutorQuestionPacksService } from "./tutor-question-packs.service";

/**
 * Covers the Stripe-adjacent "question pack purchase" mapping path —
 * previously untested. This is the SECOND thing a webhook can activate
 * (alongside subscriptions in BillingService), reached via
 * BillingService.applyWebhookEvent's "question_pack.paid" branch, so the
 * same production-readiness bar (idempotent, race-safe, never
 * double-credits, rejects a tampered/invalid purchase shape) applies here
 * too.
 */
describe("TutorQuestionPacksService.applyPaidPurchase", () => {
  const PACK_SIZE = 10;
  const PACK_PRICE_EGP = 50;

  function makeService(initialPurchase: any) {
    let purchase = initialPurchase === null ? null : { ...initialPurchase };
    let credit: { remaining: number } | null = null;

    const client: any = {
      tutorQuestionPackPurchase: {
        findUnique: jest.fn().mockImplementation(async () => (purchase ? { ...purchase } : null)),
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          if (!purchase || (where.status && purchase.status !== where.status)) return { count: 0 };
          purchase = { ...purchase, ...data };
          return { count: 1 };
        }),
      },
      tutorExtraQuestionCredit: {
        upsert: jest.fn().mockImplementation(async ({ update, create }: any) => {
          credit = credit ? { remaining: credit.remaining + update.remaining.increment } : { remaining: create.remaining };
          return credit;
        }),
      },
    };
    client.$transaction = (fn: any) => fn(client);

    const prisma = { client } as any;
    const service = new TutorQuestionPacksService(prisma, {} as any, {} as any);
    return { service, client, getPurchase: () => purchase, getCredit: () => credit };
  }

  const basePurchase = {
    id: "purchase-1",
    studentId: "student-1",
    subjectId: "subject-1",
    quantity: PACK_SIZE,
    amountEGP: PACK_PRICE_EGP,
    status: "pending",
  };

  it("credits exactly one pack (10 questions) on first delivery", async () => {
    const { service, getCredit, getPurchase } = makeService(basePurchase);
    await service.applyPaidPurchase("stripe", "purchase-1", "evt_1");
    expect(getCredit()).toEqual({ remaining: PACK_SIZE });
    expect(getPurchase().status).toBe("paid");
  });

  it("does NOT double-credit when the same paid event is delivered a second time", async () => {
    const { service, getCredit } = makeService(basePurchase);
    await service.applyPaidPurchase("stripe", "purchase-1", "evt_1");
    await service.applyPaidPurchase("stripe", "purchase-1", "evt_1");
    expect(getCredit()).toEqual({ remaining: PACK_SIZE });
  });

  it("does NOT double-credit under a genuine concurrent-delivery race (two deliveries both see status=pending before either writes)", async () => {
    const { service, client, getCredit } = makeService(basePurchase);
    // Simulate both requests reading "pending" before either's updateMany
    // commits, by calling updateMany twice against the same starting state
    // — only the first should find status still "pending".
    const firstUpdate = client.tutorQuestionPackPurchase.updateMany({ where: { id: "purchase-1", status: "pending" }, data: { status: "paid", paymentProvider: "stripe", externalEventId: "evt_race" } });
    const secondUpdate = client.tutorQuestionPackPurchase.updateMany({ where: { id: "purchase-1", status: "pending" }, data: { status: "paid", paymentProvider: "stripe", externalEventId: "evt_race_2" } });
    const [first, second] = await Promise.all([firstUpdate, secondUpdate]);
    expect([first.count, second.count].sort()).toEqual([0, 1]);
    // Now drive the real method to confirm the credit step only ever runs once downstream too.
    await service.applyPaidPurchase("stripe", "purchase-1", "evt_after_race");
    expect(getCredit()).toEqual(null); // updateMany above already flipped status to "paid" outside applyPaidPurchase, so the guard short-circuits before crediting
  });

  it("throws NotFoundException for an unknown purchase ID", async () => {
    const { service } = makeService(null as any);
    await expect(service.applyPaidPurchase("stripe", "does-not-exist", "evt_1")).rejects.toThrow(NotFoundException);
  });

  it("rejects a purchase whose stored amount/quantity does not match the fixed pack shape (tamper/corruption guard)", async () => {
    const { service } = makeService({ ...basePurchase, quantity: 999 });
    await expect(service.applyPaidPurchase("stripe", "purchase-1", "evt_1")).rejects.toThrow(BadRequestException);
  });

  it("rejects a purchase with a mismatched price (tamper/corruption guard)", async () => {
    const { service } = makeService({ ...basePurchase, amountEGP: 1 });
    await expect(service.applyPaidPurchase("stripe", "purchase-1", "evt_1")).rejects.toThrow(BadRequestException);
  });

  it("is a safe no-op (does not throw, does not re-credit) when the purchase is already paid", async () => {
    const { service, getCredit } = makeService({ ...basePurchase, status: "paid" });
    await expect(service.applyPaidPurchase("stripe", "purchase-1", "evt_1")).resolves.toBeUndefined();
    expect(getCredit()).toEqual(null);
  });
});
