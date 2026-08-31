import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { CheckoutSession, CreateCheckoutParams, PaymentProvider, WebhookEvent } from "../payment-provider.interface";

/**
 * Stub for the intended PRODUCTION payment provider. Deliberately not
 * implemented: Fawry's authentication scheme, order/payment-key flow,
 * and callback/webhook signature rules are not guesswork-safe — they
 * require Fawry's official integration documentation and test
 * credentials, none of which exist in this project yet.
 *
 * The class exists now so the swap-in story is real: once the docs and
 * credentials are available, this file gets real logic (mirroring how
 * StripeProvider implements the same PaymentProvider interface) and
 * PaymentProviderConfig.fawry.isActive flips to true. Nothing in
 * BillingService, Subscription, PricingPlan, or any other business logic
 * needs to change — that's the entire point of the provider abstraction.
 */
@Injectable()
export class FawryProvider implements PaymentProvider {
  async createCheckoutSession(_params: CreateCheckoutParams): Promise<CheckoutSession> {
    throw new ServiceUnavailableException(
      "Fawry is the planned production payment provider but is not integrated yet — pending official Fawry integration documentation and credentials.",
    );
  }
  async verifyAndParseWebhook(_rawBody: Buffer, _headers: Record<string, string | string[] | undefined>): Promise<WebhookEvent> {
    throw new ServiceUnavailableException("Fawry webhook handling is not implemented yet.");
  }
  async cancelSubscription(_externalSubscriptionId: string): Promise<void> {
    throw new ServiceUnavailableException("Fawry is not implemented yet.");
  }
}
