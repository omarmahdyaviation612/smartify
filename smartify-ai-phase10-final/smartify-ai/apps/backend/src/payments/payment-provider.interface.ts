/**
 * Abstraction over "which payment processor handles this". Billing
 * feature code only ever talks to PaymentProviderFactory / this
 * interface — never to Stripe/Paymob/PayPal SDKs directly. Adding a new
 * processor means writing one new class here and flipping
 * PaymentProviderConfig.isActive; no billing feature code changes.
 */
export interface CreateCheckoutParams {
  studentUserId: string;
  subscriptionId: string;
  amountEGP: number;
  description: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSession {
  checkoutUrl: string;
  externalSessionId: string;
}

export interface WebhookEvent {
  type: "subscription.activated" | "subscription.canceled" | "payment.failed" | "question_pack.paid" | "unknown";
  externalSubscriptionId?: string;
  purchaseId?: string;
  /**
   * The provider's own unique event ID (e.g. Stripe's "evt_..."). Used by
   * BillingService to enforce webhook idempotency — a provider delivering
   * the same event twice (at-least-once delivery is standard for
   * webhooks) must not double-apply its effect. Optional because a
   * provider's "unknown" event type may not carry one; those are ignored
   * by BillingService regardless.
   */
  externalEventId?: string;
  raw: unknown;
}

export interface PaymentProvider {
  createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSession>;
  /**
   * Verifies and parses an incoming webhook. Takes the FULL headers object
   * (not a single named header) so each provider can extract whichever
   * signature header it actually uses — Stripe uses "stripe-signature",
   * Fawry and InstaPay will each have their own scheme once implemented.
   * Nothing about the controller or BillingService assumes Stripe's
   * header name; that assumption is scoped entirely inside StripeProvider.
   */
  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<WebhookEvent>;
  cancelSubscription(externalSubscriptionId: string): Promise<void>;
}

export const PAYMENT_PROVIDER_FACTORY = Symbol("PAYMENT_PROVIDER_FACTORY");
