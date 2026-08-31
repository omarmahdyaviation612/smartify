import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { CheckoutSession, CreateCheckoutParams, PaymentProvider, WebhookEvent } from "../payment-provider.interface";

/**
 * Stub — reserved for a possible future Paymob integration. Not the
 * current production target (Fawry is — see fawry.provider.ts), kept
 * only because it was scoped in earlier phases as an Egypt-relevant
 * option. Wired into PaymentProviderFactory's switch statement but never
 * selectable while PaymentProviderConfig.isActive stays false for it.
 */
@Injectable()
export class PaymobProvider implements PaymentProvider {
  async createCheckoutSession(_params: CreateCheckoutParams): Promise<CheckoutSession> {
    throw new ServiceUnavailableException("Paymob is not implemented yet.");
  }
  async verifyAndParseWebhook(_rawBody: Buffer, _headers: Record<string, string | string[] | undefined>): Promise<WebhookEvent> {
    throw new ServiceUnavailableException("Paymob is not implemented yet.");
  }
  async cancelSubscription(_externalSubscriptionId: string): Promise<void> {
    throw new ServiceUnavailableException("Paymob is not implemented yet.");
  }
}
