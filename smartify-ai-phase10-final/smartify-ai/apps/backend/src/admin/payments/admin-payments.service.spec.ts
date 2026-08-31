import { AdminPaymentsService } from "./admin-payments.service";

/** Mirrors admin-ai-config.service.spec.ts — same atomic-activation fix, applied to payment providers. */
describe("AdminPaymentsService.updateProvider — atomic activation", () => {
  function makePrismaMock() {
    return {
      client: {
        $executeRaw: jest.fn().mockResolvedValue(1),
        paymentProviderConfig: {
          update: jest.fn().mockResolvedValue({ providerKey: "stripe" }),
          findUnique: jest.fn().mockResolvedValue({ providerKey: "stripe" }),
        },
      },
    } as any;
  }

  it("issues a single atomic UPDATE statement when activating a provider", async () => {
    const prisma = makePrismaMock();
    const service = new AdminPaymentsService(prisma);

    await service.updateProvider("stripe", { isActive: true });

    expect(prisma.client.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does not issue the atomic UPDATE when only publicConfig changes (no activation)", async () => {
    const prisma = makePrismaMock();
    const service = new AdminPaymentsService(prisma);

    await service.updateProvider("stripe", { publicConfig: { note: "test" } });

    expect(prisma.client.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.client.paymentProviderConfig.update).toHaveBeenCalled();
  });
});
