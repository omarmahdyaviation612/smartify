import { runScopedBilingualBackfill, runScopedCoarseRefinementBackfill } from "./topic-grounding-scoped-backfill";

/**
 * Proves the "existing 678 READY assignments are structurally untouched"
 * constraint: running either scoped executor with a target list that does
 * NOT include a given topicId never even QUERIES that topicId — not just
 * "doesn't change its row", but never calls prisma with it at all.
 */
describe("scoped backfill runners never touch a topicId outside the explicit target list", () => {
  it("Part 1 (bilingual) only calls prisma.topic.findUnique for ids in the given list", async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: "target-1", unitId: "u1" });
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { client: { topic: { findUnique }, groundingConceptAlias: { findMany } } } as any;
    const aliasService = { hasCurrentAliases: jest.fn().mockResolvedValue(true), generateAliasesForUnit: jest.fn() } as any;
    const validatorService = { validateCandidate: jest.fn().mockResolvedValue({ outcome: "SKIPPED_NO_SINGLE_CANDIDATE", reason: "x" }) } as any;

    const targetIds = ["target-1"];
    const otherRealTopicId = "already-ready-topic-not-in-list";

    await runScopedBilingualBackfill({ prisma, aliasService, validatorService }, targetIds);

    // Every prisma call's `where.id` must be in the target list — the
    // out-of-scope id must never appear anywhere in the call arguments.
    for (const call of findUnique.mock.calls) {
      expect(call[0].where.id).not.toBe(otherRealTopicId);
      expect(targetIds).toContain(call[0].where.id);
    }
    expect(validatorService.validateCandidate).toHaveBeenCalledTimes(1);
    expect(validatorService.validateCandidate).toHaveBeenCalledWith("target-1", []);
  });

  it("Part 2 (coarse refinement) calls refineCoarseGrounding exactly once per given id, never for any other id", async () => {
    const refineCoarseGrounding = jest.fn().mockResolvedValue({ outcome: "SKIPPED_DETERMINISTIC", reason: "x" });
    const refinementService = { refineCoarseGrounding } as any;

    const targetIds = ["b-1", "b-2"];
    await runScopedCoarseRefinementBackfill(refinementService, targetIds);

    expect(refineCoarseGrounding).toHaveBeenCalledTimes(2);
    expect(refineCoarseGrounding.mock.calls.map((c) => c[0]).sort()).toEqual([...targetIds].sort());
    expect(refineCoarseGrounding).not.toHaveBeenCalledWith("already-ready-topic-not-in-list");
  });

  it("Part 1 generates aliases at most once per Unit even across multiple target topicIds in the same Unit", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ id: "t-a", unitId: "u1" })
      .mockResolvedValueOnce({ id: "t-b", unitId: "u1" });
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { client: { topic: { findUnique }, groundingConceptAlias: { findMany } } } as any;
    const aliasService = { hasCurrentAliases: jest.fn().mockResolvedValue(false), generateAliasesForUnit: jest.fn().mockResolvedValue({ outcome: "GENERATED", count: 2 }) } as any;
    const validatorService = { validateCandidate: jest.fn().mockResolvedValue({ outcome: "SKIPPED_NO_SINGLE_CANDIDATE", reason: "x" }) } as any;

    await runScopedBilingualBackfill({ prisma, aliasService, validatorService }, ["t-a", "t-b"]);
    expect(aliasService.generateAliasesForUnit).toHaveBeenCalledTimes(1);
    expect(aliasService.generateAliasesForUnit).toHaveBeenCalledWith("u1");
  });
});
