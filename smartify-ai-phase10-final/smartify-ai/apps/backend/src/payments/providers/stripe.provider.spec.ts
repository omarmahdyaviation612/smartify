import { StripeProvider } from "./stripe.provider";

const retrieve = jest.fn();
const constructEvent = jest.fn();
jest.mock("stripe", () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({
  checkout: { sessions: { retrieve } }, webhooks: { constructEvent },
})) }));
let mockEnv: any = { STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "fixture" };
jest.mock("@smartify/config", () => ({ loadBackendEnv: () => mockEnv }));

describe("Stripe payment verification boundary", () => {
  const expected = { externalSessionId: "cs_own", studentUserId: "user", subscriptionId: "sub", amountEGP: 500 };
  const paid = { id: "cs_own", status: "complete", payment_status: "paid", currency: "egp", amount_total: 50000,
    client_reference_id: "sub", metadata: { subscriptionId: "sub", studentUserId: "user" }, subscription: "sub_stripe" };
  beforeEach(() => {
    jest.clearAllMocks();
    retrieve.mockResolvedValue(paid);
    mockEnv = { STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "fixture" };
  });
  it("verifies paid state and full ownership using a server-side session retrieval", async () => {
    expect(await (new StripeProvider() as any).verifyCheckoutSession(expected)).toBe("paid");
    expect(retrieve).toHaveBeenCalledWith("cs_own");
  });
  it.each([
    { payment_status: "unpaid" }, { payment_status: "no_payment_required" }, { status: "open" },
  ])("does not treat completed but unpaid/open sessions as payment", async (patch) => {
    retrieve.mockResolvedValue({ ...paid, ...patch });
    expect(await (new StripeProvider() as any).verifyCheckoutSession(expected)).toBe("pending");
  });
  it.each([
    { amount_total: 1 }, { currency: "usd" }, { id: "cs_other" }, { client_reference_id: "other" },
    { metadata: { subscriptionId: "sub", studentUserId: "other" } },
  ])("rejects mismatched session/owner/amount/currency", async (patch) => {
    retrieve.mockResolvedValue({ ...paid, ...patch });
    expect(await (new StripeProvider() as any).verifyCheckoutSession(expected)).toBe("unverified");
  });
  it("reports expired checkout as failed", async () => {
    retrieve.mockResolvedValue({ ...paid, status: "expired", payment_status: "unpaid" });
    expect(await (new StripeProvider() as any).verifyCheckoutSession(expected)).toBe("failed");
  });
  it.each([undefined, "unpaid", "no_payment_required"])("never grants a subscription or pack for payment_status %s", async (payment_status) => {
    for (const metadata of [paid.metadata, { purchaseType: "tutor_question_pack", purchaseId: "pack" }]) {
      constructEvent.mockReturnValue({ id: "evt", type: "checkout.session.completed", data: { object: { ...paid, payment_status, metadata } } });
      expect((await new StripeProvider().verifyAndParseWebhook(Buffer.from("{}"), { "stripe-signature": "fixture" })).type).toBe("unknown");
    }
  });
  it.each(["checkout.session.completed", "checkout.session.async_payment_succeeded"])("correlates %s using the stored checkout session ID", async (type) => {
    constructEvent.mockReturnValue({ id: "evt", type, data: { object: paid } });
    expect(await new StripeProvider().verifyAndParseWebhook(Buffer.from("{}"), { "stripe-signature": "fixture" })).toMatchObject({
      type: "subscription.activated", externalSubscriptionId: "cs_own", externalEventId: "evt",
    });
  });
  it("does not parse or fulfill an invalid signature", async () => {
    constructEvent.mockImplementation(() => { throw Error("invalid signature"); });
    await expect(new StripeProvider().verifyAndParseWebhook(Buffer.from("{}"), { "stripe-signature": "bad" })).rejects.toThrow("invalid signature");
  });

  it("throws when the webhook secret is not configured, without ever attempting signature verification", async () => {
    mockEnv = { STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: undefined };
    await expect(new StripeProvider().verifyAndParseWebhook(Buffer.from("{}"), { "stripe-signature": "whatever" })).rejects.toThrow(
      /not configured/i,
    );
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("rejects a webhook request with a missing signature header, without attempting verification", async () => {
    await expect(new StripeProvider().verifyAndParseWebhook(Buffer.from("{}"), {})).rejects.toThrow(/signature/i);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("does not fulfill a checkout retrieval for a forged/unknown session ID", async () => {
    retrieve.mockRejectedValue(Object.assign(new Error("No such checkout.session: 'cs_forged'"), { statusCode: 404 }));
    await expect((new StripeProvider() as any).verifyCheckoutSession({ ...expected, externalSessionId: "cs_forged" })).rejects.toThrow();
  });

  // FIXED (previously a confirmed gap — see docs/production readiness
  // reports): Stripe's own subscription-level webhooks carry a Stripe
  // *subscription* ID, never a checkout *session* ID. These two event
  // types must never populate externalSubscriptionId (that field means
  // "checkout session" everywhere else in this codebase) — they populate
  // externalProviderSubscriptionId instead, a distinct identifier
  // BillingService now looks these events up by.
  it("parses customer.subscription.deleted using the Stripe SUBSCRIPTION id, never the checkout session id", async () => {
    constructEvent.mockReturnValue({ id: "evt_del", type: "customer.subscription.deleted", data: { object: { id: "sub_stripe_123" } } });
    const result = await new StripeProvider().verifyAndParseWebhook(Buffer.from("{}"), { "stripe-signature": "fixture" });
    expect(result).toMatchObject({ type: "subscription.canceled", externalProviderSubscriptionId: "sub_stripe_123", externalEventId: "evt_del" });
    expect((result as any).externalSubscriptionId).toBeUndefined();
  });

  it("parses invoice.payment_failed using the invoice's Stripe SUBSCRIPTION id, never the checkout session id", async () => {
    constructEvent.mockReturnValue({ id: "evt_fail", type: "invoice.payment_failed", data: { object: { subscription: "sub_stripe_456" } } });
    const result = await new StripeProvider().verifyAndParseWebhook(Buffer.from("{}"), { "stripe-signature": "fixture" });
    expect(result).toMatchObject({ type: "payment.failed", externalProviderSubscriptionId: "sub_stripe_456", externalEventId: "evt_fail" });
    expect((result as any).externalSubscriptionId).toBeUndefined();
  });

  it("parses invoice.payment_failed for a non-subscription invoice with no correlatable subscription id (defensive edge case)", async () => {
    constructEvent.mockReturnValue({ id: "evt_fail2", type: "invoice.payment_failed", data: { object: { subscription: null } } });
    const result = await new StripeProvider().verifyAndParseWebhook(Buffer.from("{}"), { "stripe-signature": "fixture" });
    expect((result as any).externalProviderSubscriptionId).toBeUndefined();
  });

  it("captures the real Stripe subscription id from a completed checkout session, alongside the checkout session id", async () => {
    constructEvent.mockReturnValue({ id: "evt_checkout", type: "checkout.session.completed", data: { object: paid } });
    const result = await new StripeProvider().verifyAndParseWebhook(Buffer.from("{}"), { "stripe-signature": "fixture" });
    expect(result).toMatchObject({
      type: "subscription.activated",
      externalSubscriptionId: "cs_own",
      externalProviderSubscriptionId: "sub_stripe",
    });
  });
});
