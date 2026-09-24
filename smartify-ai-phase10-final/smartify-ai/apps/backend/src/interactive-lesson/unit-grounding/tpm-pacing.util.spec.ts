import { UnitGroundingTpmPacer } from "./tpm-pacing.util";

describe("UnitGroundingTpmPacer", () => {
  const request = { model: "gpt-4o-mini", unitId: "unit-1", pageStart: 15, pageEnd: 16, estimatedTokens: 76871 };

  it("does not issue a TPM retry at Retry-After when reset-tokens says 79 seconds", async () => {
    const waits: number[] = [];
    const logs: Record<string, unknown>[] = [];
    const pacer = new UnitGroundingTpmPacer({ sleep: async ms => { waits.push(ms); }, jitterMs: () => 0, log: entry => logs.push(entry) });

    await pacer.waitAfterTpm429(request, { limitTokens: 200000, remainingTokens: 0, resetTokensMs: 79000, retryAfterMs: 695 }, 1);

    expect(waits).toEqual([79000]);
    expect(waits[0]).toBeGreaterThan(695);
    expect(logs[0]).toMatchObject({ event: "AI_RATE_LIMIT_WAIT", reason: "tpm_429_reset_tokens", waitMs: 79000, remainingTokens: 0, resetTokensMs: 79000 });
  });

  it("starts the next chunk immediately when remaining capacity is enough", async () => {
    const sleep = jest.fn();
    const pacer = new UnitGroundingTpmPacer({ sleep, jitterMs: () => 0 });
    pacer.recordSuccessfulResponse({ limitTokens: 200000, remainingTokens: 100000, resetTokensMs: 79000 });

    await pacer.waitBeforeNextChunk(request);

    expect(sleep).not.toHaveBeenCalled();
  });

  it("waits for the token reset before the next chunk when capacity is insufficient", async () => {
    const waits: number[] = [];
    const pacer = new UnitGroundingTpmPacer({ sleep: async ms => { waits.push(ms); }, jitterMs: () => 0 });
    pacer.recordSuccessfulResponse({ limitTokens: 200000, remainingTokens: 52000, resetTokensMs: 79000 });

    await pacer.waitBeforeNextChunk(request);

    expect(waits).toEqual([79000]);
  });

  it("uses a bounded exponential fallback when reset metadata is missing", async () => {
    const waits: number[] = [];
    const pacer = new UnitGroundingTpmPacer({ sleep: async ms => { waits.push(ms); }, jitterMs: () => 0 });

    await pacer.waitAfterTpm429(request, { retryAfterMs: 695 }, 2);

    expect(waits).toEqual([2000]);
  });

  it("never waits for insufficient quota", async () => {
    const sleep = jest.fn();
    const pacer = new UnitGroundingTpmPacer({ sleep, jitterMs: () => 0 });

    await expect(pacer.waitAfterTpm429(request, { quota: true, remainingTokens: 0, resetTokensMs: 79000 }, 1)).rejects.toThrow("quota");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("refuses an unbounded wait beyond the configured deadline", async () => {
    const pacer = new UnitGroundingTpmPacer({ sleep: jest.fn(), jitterMs: () => 0, maxWaitMs: 60000 });
    await expect(pacer.waitAfterTpm429(request, { remainingTokens: 0, resetTokensMs: 79000 }, 1)).rejects.toThrow("maximum");
  });
});
