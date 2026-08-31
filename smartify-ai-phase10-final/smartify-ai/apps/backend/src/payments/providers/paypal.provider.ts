import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { CheckoutSession, CreateCheckoutParams, PaymentProvider, WebhookEvent } from "../payment-provider.interface";

/** Stub — reserved for a possible future PayPal integration. See paymob.provider.ts for the same note. */
@Injectable()
export class PayPalProvider implements PaymentProvider {
  async createCheckoutSession(_params: CreateCheckoutParams): Promise<CheckoutSession> {
    throw new ServiceUnavailableException("PayPal is not implemented yet.");
  }
  async verifyAndParseWebhook(_rawBody: Buffer, _headers: Record<string, string | string[] | undefined>): Promise<WebhookEvent> {
    throw new ServiceUnavailableException("PayPal is not implemented yet.");
  }
  async cancelSubscription(_externalSubscriptionId: string): Promise<void> {
    throw new ServiceUnavailableException("PayPal is not implemented yet.");
  }
}
