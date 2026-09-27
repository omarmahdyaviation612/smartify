import { warmUpUnit, ProviderOutageError } from "./warm-up-curriculum";

/**
 * 2026-09-26 provider-outage incident: the bulk warm-up must halt the
 * ENTIRE run the instant a PROVIDER_OUTAGE result is seen, never continue
 * to the next Unit (that's exactly what happened without this fix — 16
 * Units wrongly converted to CONFIGURATION_ERROR while the loop kept
 * marching forward through an OpenAI account-level outage).
 */
describe("warmUpUnit — provider-outage halting (2026-09-26 hotfix)", () => {
  const report = { unitsGrounded: [], unitsAlreadyGrounded: [], unitsSkippedConfigurationError: [], unitsSkippedExcluded: [], topicsAuthored: [], topicsAlreadyAuthored: [], topicsFailed: [], totalChunksProcessed: 0, totalCooldownWaits: 0 };

  it("throws ProviderOutageError (never returns) the moment prepareTopicGrounding reports PROVIDER_OUTAGE", async () => {
    const draftGenerator = { prepareTopicGrounding: jest.fn().mockResolvedValue({ status: "PROVIDER_OUTAGE", reason: "provider_quota_exhausted" }) } as any;

    await expect(warmUpUnit(draftGenerator, "unit-1", "topic-1", 10, { ...report }, true)).rejects.toBeInstanceOf(ProviderOutageError);
    expect(draftGenerator.prepareTopicGrounding).toHaveBeenCalledTimes(1); // never retried against the same outage
  });

  it("carries the unitId/reason for operator diagnosis", async () => {
    const draftGenerator = { prepareTopicGrounding: jest.fn().mockResolvedValue({ status: "PROVIDER_OUTAGE", reason: "provider_quota_exhausted" }) } as any;

    try {
      await warmUpUnit(draftGenerator, "unit-42", "topic-1", 10, { ...report }, true);
      fail("expected warmUpUnit to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderOutageError);
      expect((err as ProviderOutageError).unitId).toBe("unit-42");
      expect((err as ProviderOutageError).reason).toBe("provider_quota_exhausted");
    }
  });

  it("a normal PREPARING (cooldown) result does not throw — only PROVIDER_OUTAGE does", async () => {
    const draftGenerator = { prepareTopicGrounding: jest.fn()
      .mockResolvedValueOnce({ status: "PREPARING", retryAfterMs: 1 })
      .mockResolvedValueOnce({ status: "READY" }) } as any;

    await expect(warmUpUnit(draftGenerator, "unit-1", "topic-1", 10, { ...report }, true)).resolves.toBe("READY");
  });

  it("a genuine CONFIGURATION_ERROR (not an outage) still returns normally rather than throwing — unrelated Unit failures are not conflated with a provider outage", async () => {
    const draftGenerator = { prepareTopicGrounding: jest.fn().mockResolvedValue({ status: "CONFIGURATION_ERROR", reason: "source_object_not_found" }) } as any;

    await expect(warmUpUnit(draftGenerator, "unit-1", "topic-1", 10, { ...report }, true)).resolves.toBe("CONFIGURATION_ERROR");
  });

  it("dry run (apply=false) never calls the provider at all, so a live outage can never even be observed mid-dry-run", async () => {
    const draftGenerator = { prepareTopicGrounding: jest.fn() } as any;

    await expect(warmUpUnit(draftGenerator, "unit-1", "topic-1", 10, { ...report }, false)).resolves.toBe("READY");
    expect(draftGenerator.prepareTopicGrounding).not.toHaveBeenCalled();
  });
});
