import { BadRequestException, Controller, Param, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { SkipThrottle } from "@nestjs/throttler";
import { PaymentProviderFactory } from "../payments/payment-provider.factory";
import { BillingService } from "./billing.service";

/**
 * Generic webhook receiver — one route per provider key
 * (/webhooks/billing/stripe, /webhooks/billing/fawry once implemented,
 * ...), each verified by that provider's own signature scheme. The
 * controller passes the FULL request headers to the provider rather than
 * plucking out a named header itself — which header matters (Stripe's
 * "stripe-signature", whatever Fawry/InstaPay eventually use) is decided
 * entirely inside each provider class, never here. Mirrors the Clerk
 * webhook pattern from Phase 2: this is a sync boundary, not a place
 * business rules are decided ad hoc.
 */
@Controller("webhooks/billing")
@SkipThrottle()
export class BillingWebhookController {
  constructor(
    private readonly providerFactory: PaymentProviderFactory,
    private readonly billingService: BillingService,
  ) {}

  @Post(":providerKey")
  async handle(@Req() req: Request, @Param("providerKey") providerKey: string) {
    const provider = await this.providerFactory.getProviderByKey(providerKey);

    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException("Webhook body must be raw — check main.ts body-parser configuration.");
    }

    const event = await provider.verifyAndParseWebhook(req.body, req.headers);
    await this.billingService.applyWebhookEvent(providerKey, event);

    return { received: true };
  }
}
