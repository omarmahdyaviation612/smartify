import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import Stripe from "stripe";
import { loadBackendEnv } from "@smartify/config";
import type { CheckoutSession, CreateCheckoutParams, PaymentProvider, WebhookEvent } from "../payment-provider.interface";

@Injectable()
export class StripeProvider implements PaymentProvider {
  private client: Stripe | null = null;
  private webhookSecret: string | undefined;

  constructor() {
    const env = loadBackendEnv();
    if (env.STRIPE_SECRET_KEY) {
      this.client = new Stripe(env.STRIPE_SECRET_KEY);
    }
    this.webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    // No key configured — client stays null, methods below fail fast and
    // clearly rather than crashing deep inside the Stripe SDK.
  }

  async createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSession> {
    if (!this.client) {
      throw new ServiceUnavailableException("Payments are not configured yet — STRIPE_SECRET_KEY is missing on the backend.");
    }

    // EGP is a supported Stripe currency; amounts are in the smallest
    // currency unit (piastres), hence * 100.
    const session = await this.client.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "egp",
            product_data: { name: params.description },
            unit_amount: Math.round(params.amountEGP * 100),
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      client_reference_id: params.subscriptionId,
      metadata: { studentUserId: params.studentUserId, subscriptionId: params.subscriptionId, ...params.metadata },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });

    if (!session.url) {
      throw new ServiceUnavailableException("Stripe did not return a checkout URL.");
    }
    return { checkoutUrl: session.url, externalSessionId: session.id };
  }

  async createSubscriptionUpgrade(params: CreateCheckoutParams & { externalProviderSubscriptionId: string }): Promise<CheckoutSession> {
    if (!this.client) throw new ServiceUnavailableException("Payments are not configured yet.");
    const subscription = await this.client.subscriptions.retrieve(params.externalProviderSubscriptionId);
    if (subscription.status !== "active" || subscription.items.data.length !== 1) throw new ServiceUnavailableException("This subscription cannot be updated through the subject checkout.");
    const item = subscription.items.data[0];
    const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const product = typeof item.price.product === "string" ? item.price.product : item.price.product.id;
    const price = await this.client.prices.create({ currency: "egp", unit_amount: Math.round(params.amountEGP * 100), recurring: { interval: "month" }, product });
    const reference = `sfu:${subscription.id}:${price.id}`;
    const configuration = await this.client.billingPortal.configurations.create({
      business_profile: { headline: params.description },
      features: { subscription_update: { enabled: true, default_allowed_updates: ["price"], proration_behavior: "always_invoice", products: [{ product, prices: [item.price.id, price.id] }] } },
    });
    await this.client.subscriptions.update(subscription.id, { metadata: { smartifyUpgradeReference: reference, studentUserId: params.studentUserId, subscriptionId: params.subscriptionId } });
    const portal = await this.client.billingPortal.sessions.create({ customer, configuration: configuration.id, return_url: params.cancelUrl,
      flow_data: { type: "subscription_update_confirm", subscription_update_confirm: { subscription: subscription.id, items: [{ id: item.id, price: price.id, quantity: 1 }] },
        after_completion: { type: "redirect", redirect: { return_url: params.successUrl } } } });
    return { checkoutUrl: portal.url, externalSessionId: reference };
  }

  async verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<WebhookEvent> {
    if (!this.client || !this.webhookSecret) {
      throw new ServiceUnavailableException("Stripe webhook verification is not configured.");
    }

    const signatureHeader = headers["stripe-signature"];
    if (!signatureHeader || Array.isArray(signatureHeader)) {
      throw new ServiceUnavailableException("Missing or malformed stripe-signature header.");
    }

    const event = this.client.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Completion can precede settlement for asynchronous payment methods.
        if (session.payment_status !== "paid") return { type: "unknown", externalEventId: event.id, raw: event };
        if (session.metadata?.purchaseType === "tutor_question_pack") {
          return {
            type: "question_pack.paid",
            purchaseId: session.metadata.purchaseId,
            externalEventId: event.id,
            raw: event,
          };
        }
        return {
          type: "subscription.activated",
          externalSubscriptionId: session.id,
          // Stripe assigns the real Subscription only once the session
          // completes — this is the first verified backend point it's
          // available. `session.subscription` is a plain string ID here
          // since we never request `expand`.
          externalProviderSubscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id,
          externalEventId: event.id,
          raw: event,
        };
      }
      case "customer.subscription.deleted": {
        // This event's own object IS the Stripe Subscription — never a
        // checkout session, so there is no externalSubscriptionId to give.
        const subscription = event.data.object as Stripe.Subscription;
        return { type: "subscription.canceled", externalProviderSubscriptionId: subscription.id, externalEventId: event.id, raw: event };
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        return { type: "payment.failed", externalProviderSubscriptionId: subscriptionId, externalEventId: event.id, raw: event };
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const id = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        if (!id || invoice.status !== "paid") return { type: "unknown", externalEventId: event.id, raw: event };
        const subscription = await this.client.subscriptions.retrieve(id);
        const reference = subscription.metadata.smartifyUpgradeReference;
        const desiredPrice = reference?.split(":")[2];
        if (!reference?.startsWith(`sfu:${id}:`) || !desiredPrice || subscription.status !== "active" ||
          !invoice.lines.data.some(line => line.price?.id === desiredPrice && !line.proration) && !invoice.lines.data.some(line => line.price?.id === desiredPrice && line.amount > 0)) {
          return { type: "unknown", externalEventId: event.id, raw: event };
        }
        return { type: "subscription.activated", externalSubscriptionId: reference, externalProviderSubscriptionId: id, externalEventId: event.id, raw: event };
      }
      default:
        return { type: "unknown", externalEventId: event.id, raw: event };
    }
  }

  async verifyCheckoutSession(expected: { externalSessionId: string; studentUserId: string; subscriptionId: string; amountEGP: number }): Promise<"paid" | "pending" | "failed" | "unverified"> {
    if (!this.client) return "unverified";
    if (expected.externalSessionId.startsWith("sfu:")) {
      const [, id, priceId] = expected.externalSessionId.split(":");
      const subscription = await this.client.subscriptions.retrieve(id, { expand: ["latest_invoice"] });
      if (subscription.metadata.smartifyUpgradeReference !== expected.externalSessionId || subscription.metadata.studentUserId !== expected.studentUserId || subscription.metadata.subscriptionId !== expected.subscriptionId ||
        !subscription.items.data.some(item => item.price.id === priceId && item.price.currency === "egp" && item.price.unit_amount === Math.round(expected.amountEGP * 100))) return "pending";
      const invoice = subscription.latest_invoice;
      return subscription.status === "active" && typeof invoice === "object" && invoice?.status === "paid" ? "paid" : "pending";
    }
    const session = await this.client.checkout.sessions.retrieve(expected.externalSessionId);
    if (session.id !== expected.externalSessionId || session.client_reference_id !== expected.subscriptionId ||
        session.metadata?.subscriptionId !== expected.subscriptionId || session.metadata?.studentUserId !== expected.studentUserId ||
        session.currency !== "egp" || session.amount_total !== Math.round(expected.amountEGP * 100)) return "unverified";
    if (session.status === "expired") return "failed";
    return session.status === "complete" && session.payment_status === "paid" ? "paid" : "pending";
  }

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    if (!this.client) {
      throw new ServiceUnavailableException("Payments are not configured yet.");
    }
    await this.client.subscriptions.cancel(externalSubscriptionId);
  }
}
