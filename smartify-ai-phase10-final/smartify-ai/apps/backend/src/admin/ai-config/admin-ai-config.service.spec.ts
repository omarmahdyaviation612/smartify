import { AdminAIConfigService } from "./admin-ai-config.service";

/**
 * Covers the Phase 10 concurrency fix for provider activation: a single
 * atomic SQL UPDATE statement (not a read-then-write pair) is used so
 * two concurrent activations of different providers can't both end up
 * active. These tests confirm the raw-SQL path is used, not that real
 * Postgres concurrency was exercised (that guarantee comes from a single
 * UPDATE statement being inherently atomic in Postgres, which cannot be
 * demonstrated against a mocked client — see 10-phase10-decisions.md).
 */
describe("AdminAIConfigService.updateProvider — atomic activation", () => {
  function makePrismaMock() {
    return {
      client: {
        $executeRaw: jest.fn().mockResolvedValue(1),
        aIProviderConfig: {
          update: jest.fn().mockResolvedValue({ providerKey: "openai" }),
          findUnique: jest.fn().mockResolvedValue({ providerKey: "openai" }),
        },
      },
    } as any;
  }

  it("issues a single atomic UPDATE statement when activating a provider, rather than two separate calls", async () => {
    const prisma = makePrismaMock();
    const service = new AdminAIConfigService(prisma);

    await service.updateProvider("openai", { isActive: true });

    expect(prisma.client.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does not touch the isActive column via a separate updateMany/update call", async () => {
    const prisma = makePrismaMock();
    const service = new AdminAIConfigService(prisma);

    await service.updateProvider("openai", { isActive: true });

    // The typed update() call, if made at all here, should only be for
    // non-isActive fields — isActive itself is handled exclusively by
    // the atomic raw statement above.
    if (prisma.client.aIProviderConfig.update.mock.calls.length > 0) {
      const updateData = prisma.client.aIProviderConfig.update.mock.calls[0][0].data;
      expect(updateData.isActive).toBeUndefined();
    }
  });

  it("skips the atomic UPDATE entirely when the change doesn't touch isActive (e.g. only updating cost rates)", async () => {
    const prisma = makePrismaMock();
    const service = new AdminAIConfigService(prisma);

    await service.updateProvider("openai", { costPerInputToken: 0.0000002 });

    expect(prisma.client.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.client.aIProviderConfig.update).toHaveBeenCalledWith({
      where: { providerKey: "openai" },
      data: { costPerInputToken: 0.0000002 },
    });
  });
});
