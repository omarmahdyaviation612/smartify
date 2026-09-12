import { BillingService } from "./billing.service";

/**
 * Regression coverage for the Stripe subscription-lifecycle mapping fix:
 * customer.subscription.deleted and invoice.payment_failed are keyed by
 * the provider's own SUBSCRIPTION id (externalProviderSubscriptionId),
 * never the CHECKOUT SESSION id (externalSubscriptionId) that activation
 * uses. This file models several Subscription rows at once (unlike
 * billing-webhook-retry.spec.ts's single-row harness) specifically to
 * prove cross-row isolation: another user's row, an id-type mismatch, and
 * an InstaPay row must never be reachable by a Stripe lifecycle event.
 */
describe("applyWebhookEvent — Stripe subscription lifecycle (cancellation / payment failure)", () => {
  function makeHarness(initialRows: any[]) {
    let state = {
      events: new Set<string>(),
      rows: new Map(initialRows.map((r) => [r.id, { ...r }])),
    };
    let failWrite = false;
    let updateManyCallCount = 0;

    function matches(row: any, where: any) {
      if (where.id !== undefined && row.id !== where.id) return false;
      if (where.paymentProvider !== undefined && row.paymentProvider !== where.paymentProvider) return false;
      if (where.externalSubscriptionId !== undefined && row.externalSubscriptionId !== where.externalSubscriptionId) return false;
      if (where.externalProviderSubscriptionId !== undefined && row.externalProviderSubscriptionId !== where.externalProviderSubscriptionId) return false;
      if (where.status !== undefined && row.status !== where.status) return false;
      return true;
    }

    function client(getState: () => typeof state) {
      return {
        webhookEventLog: {
          create: async ({ data }: any) => {
            const key = `${data.provider}:${data.externalEventId}`;
            if (getState().events.has(key)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
            getState().events.add(key);
          },
        },
        subscription: {
          findFirst: async ({ where }: any) => {
            for (const row of getState().rows.values()) {
              if (matches(row, where)) return { ...row };
            }
            return null;
          },
          updateMany: async ({ where, data }: any) => {
            if (failWrite) throw new Error("database write failed");
            updateManyCallCount++;
            let count = 0;
            for (const row of getState().rows.values()) {
              if (!matches(row, where)) continue;
              Object.assign(row, data);
              count++;
            }
            return { count };
          },
        },
      };
    }

    // Real Postgres transactions touching the same rows serialize against
    // each other (that's exactly what the unique WebhookEventLog
    // constraint relies on for concurrent-delivery safety) — a mutex here
    // makes concurrent $transaction calls in this mock behave the same
    // way, rather than each racing off an independent snapshot the way
    // true JS-level parallelism would allow.
    let mutex = Promise.resolve();
    const db: any = {
      ...client(() => state),
      $transaction: (fn: any) => {
        const run = mutex.then(async () => {
          const draft = { events: new Set(state.events), rows: new Map([...state.rows].map(([k, v]) => [k, { ...v }])) };
          const result = await fn(client(() => draft));
          state = draft;
          return result;
        });
        mutex = run.then(() => undefined, () => undefined);
        return run;
      },
    };

    return {
      service: new BillingService({ client: db } as any, {} as any, { applyPaidPurchase: jest.fn() } as any),
      getRow: (id: string) => state.rows.get(id),
      setFailWrite: (v: boolean) => { failWrite = v; },
      updateManyCalls: () => updateManyCallCount,
    };
  }

  const stripeRow = {
    id: "row-stripe-1",
    status: "active",
    paymentProvider: "stripe",
    externalSubscriptionId: "cs_own",
    externalProviderSubscriptionId: "sub_stripe_1",
  };

  it("customer.subscription.deleted marks the matching subscription canceled", async () => {
    const h = makeHarness([stripeRow]);
    await h.service.applyWebhookEvent("stripe", { type: "subscription.canceled", externalProviderSubscriptionId: "sub_stripe_1", externalEventId: "evt_del_1" });
    expect(h.getRow("row-stripe-1")!.status).toBe("canceled");
  });

  it("invoice.payment_failed marks the matching subscription past_due (does not leave it indefinitely active)", async () => {
    const h = makeHarness([stripeRow]);
    await h.service.applyWebhookEvent("stripe", { type: "payment.failed", externalProviderSubscriptionId: "sub_stripe_1", externalEventId: "evt_fail_1" });
    expect(h.getRow("row-stripe-1")!.status).toBe("past_due");
  });

  it("rejects an unknown Stripe subscription ID (nothing to reconcile, safe to retry) without changing any row", async () => {
    const h = makeHarness([stripeRow]);
    await expect(
      h.service.applyWebhookEvent("stripe", { type: "subscription.canceled", externalProviderSubscriptionId: "sub_does_not_exist", externalEventId: "evt_unknown" }),
    ).rejects.toThrow();
    expect(h.getRow("row-stripe-1")!.status).toBe("active");
  });

  it("is a safe no-op (no error, no state change, no event logged) when the Stripe subscription id is missing entirely", async () => {
    const h = makeHarness([stripeRow]);
    await expect(
      h.service.applyWebhookEvent("stripe", { type: "subscription.canceled", externalEventId: "evt_missing_id" }),
    ).resolves.toBeUndefined();
    expect(h.getRow("row-stripe-1")!.status).toBe("active");
    expect(h.updateManyCalls()).toBe(0);
    // Since the event was never logged, a LATER delivery with a real id but the SAME externalEventId must still apply cleanly (not blocked as a false duplicate).
    await h.service.applyWebhookEvent("stripe", { type: "subscription.canceled", externalProviderSubscriptionId: "sub_stripe_1", externalEventId: "evt_missing_id" });
    expect(h.getRow("row-stripe-1")!.status).toBe("canceled");
  });

  it("duplicate customer.subscription.deleted delivery does not re-process (second delivery is a no-op)", async () => {
    const h = makeHarness([stripeRow]);
    await h.service.applyWebhookEvent("stripe", { type: "subscription.canceled", externalProviderSubscriptionId: "sub_stripe_1", externalEventId: "evt_del_dup" });
    await h.service.applyWebhookEvent("stripe", { type: "subscription.canceled", externalProviderSubscriptionId: "sub_stripe_1", externalEventId: "evt_del_dup" });
    expect(h.updateManyCalls()).toBe(1);
    expect(h.getRow("row-stripe-1")!.status).toBe("canceled");
  });

  it("duplicate invoice.payment_failed delivery does not re-process (second delivery is a no-op)", async () => {
    const h = makeHarness([stripeRow]);
    await h.service.applyWebhookEvent("stripe", { type: "payment.failed", externalProviderSubscriptionId: "sub_stripe_1", externalEventId: "evt_fail_dup" });
    await h.service.applyWebhookEvent("stripe", { type: "payment.failed", externalProviderSubscriptionId: "sub_stripe_1", externalEventId: "evt_fail_dup" });
    expect(h.updateManyCalls()).toBe(1);
    expect(h.getRow("row-stripe-1")!.status).toBe("past_due");
  });

  it("concurrent duplicate delivery of the same event only applies the effect once", async () => {
    const h = makeHarness([stripeRow]);
    const event = { type: "subscription.canceled", externalProviderSubscriptionId: "sub_stripe_1", externalEventId: "evt_concurrent" };
    const results = await Promise.allSettled([
      h.service.applyWebhookEvent("stripe", event),
      h.service.applyWebhookEvent("stripe", event),
    ]);
    // Both deliveries resolve without error (a webhook provider must see a
    // success response for a duplicate, or it will keep retrying forever)
    // — but only ONE of them actually applied the status change, thanks to
    // the WebhookEventLog unique constraint rejecting the second insert
    // before either delivery's business effect runs.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(h.getRow("row-stripe-1")!.status).toBe("canceled");
    expect(h.updateManyCalls()).toBe(1);
  });

  it("out-of-order protection: a late/replayed activation event cannot resurrect an already-canceled subscription", async () => {
    const h = makeHarness([{ ...stripeRow, status: "pending" }]);
    await h.service.applyWebhookEvent("stripe", { type: "subscription.canceled", externalProviderSubscriptionId: "sub_stripe_1", externalEventId: "evt_del_first" });
    expect(h.getRow("row-stripe-1")!.status).toBe("canceled");

    // A stale/out-of-order "checkout.session.completed" for the same
    // subscription arrives afterward — activation requires status
    // "pending" to transition, so it must not resurrect a canceled row.
    await h.service.applyWebhookEvent("stripe", { type: "subscription.activated", externalSubscriptionId: "cs_own", externalEventId: "evt_activate_late" });
    expect(h.getRow("row-stripe-1")!.status).toBe("canceled");
  });

  it("a lifecycle event for one user's Stripe subscription never affects another user's row", async () => {
    const otherUserRow = { id: "row-stripe-2", status: "active", paymentProvider: "stripe", externalSubscriptionId: "cs_other", externalProviderSubscriptionId: "sub_stripe_2" };
    const h = makeHarness([stripeRow, otherUserRow]);
    await h.service.applyWebhookEvent("stripe", { type: "subscription.canceled", externalProviderSubscriptionId: "sub_stripe_1", externalEventId: "evt_cross_user" });
    expect(h.getRow("row-stripe-1")!.status).toBe("canceled");
    expect(h.getRow("row-stripe-2")!.status).toBe("active");
  });

  it("SECURITY: a checkout SESSION id cannot be substituted for a Stripe SUBSCRIPTION id to reach a subscription-lifecycle event", async () => {
    const h = makeHarness([stripeRow]);
    // stripeRow.externalSubscriptionId ("cs_own") is a real value on this
    // row, but under the WRONG field — a lifecycle event carrying that
    // value as externalProviderSubscriptionId must not match.
    await expect(
      h.service.applyWebhookEvent("stripe", { type: "subscription.canceled", externalProviderSubscriptionId: "cs_own", externalEventId: "evt_substitution" }),
    ).rejects.toThrow();
    expect(h.getRow("row-stripe-1")!.status).toBe("active");
  });

  it("InstaPay subscriptions are never affected by Stripe lifecycle events, even with a colliding-looking reference", async () => {
    const instapayRow = { id: "row-instapay-1", status: "active", paymentProvider: "instapay", externalSubscriptionId: "SMAI-S-ABC123", externalProviderSubscriptionId: null };
    const h = makeHarness([stripeRow, instapayRow]);
    await expect(
      h.service.applyWebhookEvent("stripe", { type: "subscription.canceled", externalProviderSubscriptionId: "SMAI-S-ABC123", externalEventId: "evt_instapay_isolation" }),
    ).rejects.toThrow();
    expect(h.getRow("row-instapay-1")!.status).toBe("active");
  });

  it("rolls back the event marker when the cancellation write fails, permitting retry", async () => {
    const h = makeHarness([stripeRow]);
    h.setFailWrite(true);
    await expect(
      h.service.applyWebhookEvent("stripe", { type: "subscription.canceled", externalProviderSubscriptionId: "sub_stripe_1", externalEventId: "evt_rollback" }),
    ).rejects.toThrow("database write failed");
    expect(h.getRow("row-stripe-1")!.status).toBe("active");

    h.setFailWrite(false);
    await h.service.applyWebhookEvent("stripe", { type: "subscription.canceled", externalProviderSubscriptionId: "sub_stripe_1", externalEventId: "evt_rollback" });
    expect(h.getRow("row-stripe-1")!.status).toBe("canceled");
  });
});
