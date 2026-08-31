import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StripeProvider } from "./providers/stripe.provider";
import { PaymobProvider } from "./providers/paymob.provider";
import { PayPalProvider } from "./providers/paypal.provider";
import { FawryProvider } from "./providers/fawry.provider";
import { InstaPayProvider } from "./providers/instapay.provider";
import type { PaymentProvider } from "./payment-provider.interface";

@Injectable()
export class PaymentProviderFactory {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveProvider(): Promise<{ provider: PaymentProvider; providerKey: string }> {
    const config = await this.prisma.client.paymentProviderConfig.findFirst({ where: { isActive: true } });

    if (!config) {
      throw new ServiceUnavailableException(
        "No payment provider is active yet. This is expected until real payment credentials are configured — see 08-phase8-decisions.md and 10-phase10-decisions.md.",
      );
    }

    return { provider: await this.getProviderByKey(config.providerKey), providerKey: config.providerKey };
  }

  async getProviderByKey(providerKey: string): Promise<PaymentProvider> {
    switch (providerKey) {
      case "stripe":
        return new StripeProvider();
      case "paymob":
        return new PaymobProvider();
      case "paypal":
        return new PayPalProvider();
      case "fawry":
        return new FawryProvider();
      case "instapay":
        return new InstaPayProvider();
      default:
        throw new ServiceUnavailableException(`Unknown payment provider key: ${providerKey}`);
    }
  }
}
