import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { CheckoutSession, CreateCheckoutParams, PaymentProvider, WebhookEvent } from "../payment-provider.interface";

/**
 * Stub for a possible FUTURE provider. Explicitly not on the near-term
 * roadmap the way Fawry is — InstaPay's official integration
 * requirements aren't available yet, so this stays disabled and hidden
 * from the admin panel's provider list (see admin/platform page) until
 * that changes. Exists only so the interface has somewhere to land once
 * real requirements arrive; no assumptions about InstaPay's actual API
 * shape are baked in here.
 */
@Injectable()
export class InstaPayProvider implements PaymentProvider {
  async createCheckoutSession(_params: CreateCheckoutParams): Promise<CheckoutSession> {
    throw new ServiceUnavailableException("InstaPay is not implemented yet.");
  }
  async verifyAndParseWebhook(_rawBody: Buffer, _headers: Record<string, string | string[] | undefined>): Promise<WebhookEvent> {
    throw new ServiceUnavailableException("InstaPay is not implemented yet.");
  }
  async cancelSubscription(_externalSubscriptionId: string): Promise<void> {
    throw new ServiceUnavailableException("InstaPay is not implemented yet.");
  }
}
