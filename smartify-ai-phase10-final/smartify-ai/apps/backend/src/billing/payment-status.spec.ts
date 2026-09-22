import { BillingService } from "./billing.service";

describe("read-only payment verification", () => {
  function setup(subscription: any = { id: "sub", paymentProvider: "stripe", externalSubscriptionId: "cs_owned", status: "active", monthlyTotalEGP: "500" }) {
    const verifyCheckoutSession = jest.fn().mockResolvedValue("paid");
    const prisma = { client: {
      studentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "student" }) },
      subscription: { findUnique: jest.fn().mockResolvedValue(subscription), update: jest.fn() },
    } };
    const factory = { getProviderByKey: jest.fn().mockResolvedValue({ verifyCheckoutSession }) };
    const packs = { applyPaidPurchase: jest.fn() };
    const referralServiceMock = { earnRewardWithinTransaction: jest.fn().mockResolvedValue(undefined) };
    return { service: new BillingService(prisma as any, factory as any, packs as any, referralServiceMock as any) as any, prisma, factory, packs, verifyCheckoutSession };
  }
  it("does not claim success with no subscription", async () => {
    const { service, factory } = setup(null);
    expect(await service.getPaymentStatus("user")).toEqual({ status: "unverified" });
    expect(factory.getProviderByKey).not.toHaveBeenCalled();
  });
  it("verifies the stored session, owner, amount and subscription rather than client parameters", async () => {
    const { service, verifyCheckoutSession, prisma, packs } = setup();
    expect(await service.getPaymentStatus("user")).toEqual({ status: "verified" });
    expect(verifyCheckoutSession).toHaveBeenCalledWith({ externalSessionId: "cs_owned", studentUserId: "user", subscriptionId: "sub", amountEGP: 500 });
    await service.getPaymentStatus("user");
    expect(prisma.client.subscription.update).not.toHaveBeenCalled();
    expect(packs.applyPaidPurchase).not.toHaveBeenCalled();
  });
  it.each(["pending", "failed", "unverified"])("does not convert provider %s into success", async (status) => {
    const { service, verifyCheckoutSession } = setup();
    verifyCheckoutSession.mockResolvedValue(status);
    expect(await service.getPaymentStatus("user")).toEqual({ status });
  });
  it("waits for fulfillment even if the provider confirms payment", async () => {
    const { service } = setup({ id: "sub", paymentProvider: "stripe", externalSubscriptionId: "cs_owned", status: "pending", monthlyTotalEGP: "500" });
    expect(await service.getPaymentStatus("user")).toEqual({ status: "pending" });
  });
  it("fails closed when credentials are unavailable or the provider cannot be reached", async () => {
    const { service, verifyCheckoutSession } = setup();
    verifyCheckoutSession.mockRejectedValue(new Error("provider unavailable"));
    expect(await service.getPaymentStatus("user")).toEqual({ status: "unverified" });
  });
  it("fails closed for providers without a verification implementation", async () => {
    const { service, factory } = setup();
    factory.getProviderByKey.mockResolvedValue({} as any);
    expect(await service.getPaymentStatus("user")).toEqual({ status: "unverified" });
  });
});
