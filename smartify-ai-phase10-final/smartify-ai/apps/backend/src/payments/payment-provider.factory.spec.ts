import { ServiceUnavailableException } from "@nestjs/common";
import { PaymentProviderFactory } from "./payment-provider.factory";
import { StripeProvider } from "./providers/stripe.provider";
import { FawryProvider } from "./providers/fawry.provider";
import { InstaPayProvider } from "./providers/instapay.provider";
import { PaymobProvider } from "./providers/paymob.provider";
import { PayPalProvider } from "./providers/paypal.provider";

describe("PaymentProviderFactory", () => {
  const findFirst = jest.fn();
  const factory = new PaymentProviderFactory({ client: { paymentProviderConfig: { findFirst } } } as never);

  beforeAll(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.CLERK_SECRET_KEY = "test";
    process.env.CLERK_PUBLISHABLE_KEY = "test";
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = "test";
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
  });

  it.each([
    ["stripe", StripeProvider], ["fawry", FawryProvider], ["instapay", InstaPayProvider],
    ["paymob", PaymobProvider], ["paypal", PayPalProvider],
  ])("isolates the %s implementation", async (key, Provider) => {
    await expect(factory.getProviderByKey(key)).resolves.toBeInstanceOf(Provider);
  });

  it("rejects unknown provider keys", async () => {
    await expect(factory.getProviderByKey("invented")).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("fails closed when no provider is active", async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(factory.getActiveProvider()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
