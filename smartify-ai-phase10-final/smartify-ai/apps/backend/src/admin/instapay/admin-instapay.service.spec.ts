import { AdminInstapayService } from "./admin-instapay.service";
import { BillingService } from "../../billing/billing.service";
import { TutorQuestionPacksService } from "../../tutor-question-packs/tutor-question-packs.service";

/**
 * Integration-style setup: AdminInstapayService, BillingService, and
 * TutorQuestionPacksService are all REAL instances sharing one fake Prisma
 * client, so "confirm" exercises the actual reused activation methods
 * (applyWebhookEvent / applyPaidPurchase) rather than a mock — proving the
 * idempotency guarantee holds end-to-end through the same code Stripe uses.
 */
function setup() {
  let state = {
    submissions: {} as Record<string, any>,
    subscriptions: {} as Record<string, any>,
    packs: {} as Record<string, any>,
    credits: {} as Record<string, any>,
    events: [] as string[],
    audits: [] as any[],
  };

  function client(get: () => typeof state) {
    return {
      instapayPaymentSubmission: {
        findUnique: async ({ where }: any) => get().submissions[where.id] ?? null,
        updateMany: async ({ where, data }: any) => {
          const row = get().submissions[where.id];
          if (!row || (where.status && row.status !== where.status)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      },
      subscription: {
        findFirst: async ({ where }: any) => {
          const row = Object.values(get().subscriptions).find(
            (s: any) => s.paymentProvider === where.paymentProvider && s.externalSubscriptionId === where.externalSubscriptionId,
          );
          return row ?? null;
        },
        updateMany: async ({ where, data }: any) => {
          const row = get().subscriptions[where.id];
          if (!row || (where.status && row.status !== where.status)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
        update: async ({ where, data }: any) => { Object.assign(get().subscriptions[where.id], data); return get().subscriptions[where.id]; },
      },
      webhookEventLog: {
        create: async ({ data }: any) => {
          const key = `${data.provider}:${data.externalEventId}`;
          if (get().events.includes(key)) throw Object.assign(Error("duplicate"), { code: "P2002" });
          get().events.push(key);
        },
      },
      tutorQuestionPackPurchase: {
        findUnique: async ({ where }: any) => get().packs[where.id] ?? null,
        updateMany: async ({ where, data }: any) => {
          const row = get().packs[where.id];
          if (!row || (where.status && row.status !== where.status)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      },
      tutorExtraQuestionCredit: {
        upsert: async ({ where, update, create }: any) => {
          const key = JSON.stringify(where.studentId_subjectId_usageDate);
          if (get().credits[key]) { get().credits[key].remaining += update.remaining.increment; }
          else { get().credits[key] = { remaining: create.remaining }; }
          return get().credits[key];
        },
      },
      auditLog: { create: async ({ data }: any) => { get().audits.push(data); } },
    };
  }

  const db = {
    ...client(() => state),
    $transaction: async (fn: any) => {
      const draft = structuredClone(state);
      const result = await fn(client(() => draft));
      state = draft;
      return result;
    },
  };

  const prisma = { client: db } as any;
  const billingService = new BillingService(prisma, {} as any, {} as any);
  const questionPacks = new TutorQuestionPacksService(prisma, {} as any, {} as any);
  const service = new AdminInstapayService(prisma, billingService, questionPacks);

  return { service, state: () => state };
}

describe("AdminInstapayService.confirm — subscription", () => {
  function seedPendingSubscriptionSubmission(f: ReturnType<typeof setup>) {
    f.state().subscriptions["sub1"] = { id: "sub1", status: "pending", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-ABC12345" };
    f.state().submissions["sub-1"] = {
      id: "sub-1", kind: "SUBSCRIPTION", subscriptionId: "sub1", packPurchaseId: null,
      referenceId: "SMAI-S-ABC12345", status: "PENDING_VERIFICATION",
    };
  }

  it("activates the subscription and marks the submission VERIFIED", async () => {
    const f = setup();
    seedPendingSubscriptionSubmission(f);
    await f.service.confirm("sub-1", "admin-1");
    expect(f.state().subscriptions["sub1"].status).toBe("active");
    expect(f.state().submissions["sub-1"].status).toBe("VERIFIED");
    expect(f.state().submissions["sub-1"].verifiedByUserId).toBe("admin-1");
    expect(f.state().audits).toHaveLength(1);
    expect(f.state().audits[0].action).toBe("instapay.confirm");
  });

  it("a second confirm call on the same submission never double-activates", async () => {
    const f = setup();
    seedPendingSubscriptionSubmission(f);
    await f.service.confirm("sub-1", "admin-1");
    await expect(f.service.confirm("sub-1", "admin-2")).rejects.toThrow("already been processed");
    // Only one activation event was ever logged for this subscription.
    expect(f.state().events.filter((e) => e.includes("sub-1"))).toHaveLength(1);
    expect(f.state().subscriptions["sub1"].status).toBe("active");
  });

  it("rejects confirming an already-rejected submission", async () => {
    const f = setup();
    seedPendingSubscriptionSubmission(f);
    f.state().submissions["sub-1"].status = "REJECTED";
    await expect(f.service.confirm("sub-1", "admin-1")).rejects.toThrow("already been processed");
    expect(f.state().subscriptions["sub1"].status).toBe("pending");
  });
});

describe("AdminInstapayService.confirm — question pack", () => {
  function seedPendingPackSubmission(f: ReturnType<typeof setup>) {
    f.state().packs["pack1"] = { id: "pack1", studentId: "student1", subjectId: "subj1", status: "pending", amountEGP: 50, quantity: 10 };
    f.state().submissions["sub-2"] = {
      id: "sub-2", kind: "QUESTION_PACK", subscriptionId: null, packPurchaseId: "pack1",
      referenceId: "SMAI-P-XYZ98765", status: "PENDING_VERIFICATION",
    };
  }

  it("grants credits exactly once even if confirm is retried", async () => {
    const f = setup();
    seedPendingPackSubmission(f);
    await f.service.confirm("sub-2", "admin-1");
    await expect(f.service.confirm("sub-2", "admin-1")).rejects.toThrow("already been processed");
    const creditKeys = Object.keys(f.state().credits);
    expect(creditKeys).toHaveLength(1);
    expect(f.state().credits[creditKeys[0]].remaining).toBe(10);
    expect(f.state().packs["pack1"].status).toBe("paid");
  });
});

describe("AdminInstapayService.reject", () => {
  it("rejects without touching entitlement, and blocks a later confirm", async () => {
    const f = setup();
    f.state().subscriptions["sub1"] = { id: "sub1", status: "pending", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-ABC12345" };
    f.state().submissions["sub-1"] = {
      id: "sub-1", kind: "SUBSCRIPTION", subscriptionId: "sub1", packPurchaseId: null,
      referenceId: "SMAI-S-ABC12345", status: "PENDING_VERIFICATION",
    };
    await f.service.reject("sub-1", "admin-1", "Amount did not match");
    expect(f.state().submissions["sub-1"].status).toBe("REJECTED");
    expect(f.state().submissions["sub-1"].rejectionReason).toBe("Amount did not match");
    expect(f.state().subscriptions["sub1"].status).toBe("pending");
    expect(f.state().audits[0].action).toBe("instapay.reject");

    await expect(f.service.confirm("sub-1", "admin-1")).rejects.toThrow("already been processed");
    expect(f.state().subscriptions["sub1"].status).toBe("pending");
  });
});
