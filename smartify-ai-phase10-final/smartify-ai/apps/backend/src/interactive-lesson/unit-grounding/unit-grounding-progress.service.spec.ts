import { UnitGroundingProgressService } from "./unit-grounding-progress.service";

describe("UnitGroundingProgressService", () => {
  const identity = { sourceKey: "book.pdf", sourceFingerprint: "fp", sourcePageStart: 1, sourcePageEnd: 4, promptVersion: "v1", providerModel: "gpt-4o-mini", rendererVersion: "renderer-v1" };
  const make = () => {
    const rows = new Map<string, any>();
    const prisma: any = { client: {
      unitGroundingProgress: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(rows.get(where.unitId) ?? null)),
        create: jest.fn(({ data }: any) => { const row = { id: "p1", ...data }; rows.set(data.unitId, row); return Promise.resolve(row); }),
        delete: jest.fn(({ where }: any) => { rows.delete(where.unitId); return Promise.resolve({}); }),
        updateMany: jest.fn(({ where, data }: any) => {
          const row = rows.get(where.unitId);
          if (!row || (where.leaseOwner && row.leaseOwner !== where.leaseOwner)) return Promise.resolve({ count: 0 });
          // Resolve Prisma's `{ increment: N }` field-update shape the way
          // real Postgres/Prisma would (mirrors the same pattern in
          // interactive-lesson.service.spec.ts's LessonSession mock),
          // so markRetryable's retryCount increment actually increments
          // in this mock instead of being overwritten with the raw
          // operator object.
          for (const [field, value] of Object.entries(data)) {
            row[field] = value && typeof value === "object" && "increment" in (value as any) ? (row[field] ?? 0) + (value as any).increment : value;
          }
          return Promise.resolve({ count: 1 });
        }),
      },
      unit: { update: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(prisma.client)),
    } };
    return { service: new UnitGroundingProgressService(prisma), prisma, rows };
  };

  it("initializes one progress record and invalidates identity changes", async () => {
    const h = make();
    await h.service.initialize("u1", identity, [{ chunkId: "c1" }]);
    expect((await h.service.initialize("u1", identity, [{ chunkId: "c1" }])).id).toBe("p1");
    await h.service.initialize("u1", { ...identity, sourceFingerprint: "new" }, [{ chunkId: "c1" }]);
    expect(h.prisma.client.unitGroundingProgress.delete).toHaveBeenCalledWith({ where: { unitId: "u1" } });
  });

  it("claims, persists, and does not duplicate a completed chunk", async () => {
    const h = make();
    await h.service.initialize("u1", identity, [{ chunkId: "c1", pageStart: 1, pageEnd: 2 }]);
    expect(await h.service.claimNextChunk("u1", "a", 1000)).toMatchObject({ chunkId: "c1" });
    expect(await h.service.persistChunk("u1", "a", { chunkId: "c1", pageStart: 1, pageEnd: 2, notes: { concepts: [] } })).toBe(true);
    const row = await h.service.get("u1");
    expect(row?.completedChunksJson).toHaveLength(1);
  });

  /**
   * Production hotfix (2026-09-25): a real, successful chunk is genuine
   * forward progress — retryCount must reset to 0 so
   * UnitGroundingService's retry ceiling only ever trips on CONSECUTIVE
   * failures since the last success, never on stale failure history from
   * earlier chunks that have since succeeded.
   */
  it("resets retryCount to 0 when a chunk is successfully persisted, even after prior failures", async () => {
    const h = make();
    await h.service.initialize("u1", identity, [{ chunkId: "c1", pageStart: 1, pageEnd: 2 }]);
    await h.service.claimNextChunk("u1", "a", 1000);
    await h.service.markRetryable("u1", "a", new Date(Date.now() + 5000), "SomeTransientError");
    expect((await h.service.get("u1"))?.retryCount).toBe(1);

    // Re-claim after the failure and this time succeed.
    h.rows.get("u1").status = "IN_PROGRESS";
    h.rows.get("u1").leaseOwner = "a";
    await h.service.persistChunk("u1", "a", { chunkId: "c1", pageStart: 1, pageEnd: 2, notes: { concepts: [] } });
    expect((await h.service.get("u1"))?.retryCount).toBe(0);
  });

  /**
   * Production hotfix (2026-09-25): the terminal status a missing-source
   * (or retry-ceiling-exceeded) failure transitions to — mirrors
   * markRetryable's shape but with status "CONFIGURATION_ERROR" and no
   * nextEligibleAt, so nothing ever auto-resumes it.
   */
  it("markConfigurationError sets a terminal status with the given error code and releases the lease", async () => {
    const h = make();
    await h.service.initialize("u1", identity, [{ chunkId: "c1" }]);
    await h.service.claimNextChunk("u1", "a", 1000);
    await h.service.markConfigurationError("u1", "a", "source_object_not_found");
    const row = await h.service.get("u1");
    expect(row?.status).toBe("CONFIGURATION_ERROR");
    expect(row?.lastErrorCode).toBe("source_object_not_found");
    expect(row?.leaseOwner).toBeNull();
    expect(row?.leaseExpiresAt).toBeNull();
  });

  it("finalizes only after a valid lease and writes complete grounding", async () => {
    const h = make();
    await h.service.initialize("u1", identity, []);
    await h.service.claimNextChunk("u1", "owner", 1000);
    h.rows.get("u1").status = "IN_PROGRESS";
    h.rows.get("u1").leaseOwner = "owner";
    h.prisma.client.unit.update.mockResolvedValue({});
    expect(await h.service.finalize("u1", "owner", { groundingNotesJson: { concepts: [] }, groundingVersion: 1, groundingModel: identity.providerModel, groundingPromptVersion: identity.promptVersion, groundingSourceFingerprint: identity.sourceFingerprint })).toBe(true);
    expect(h.prisma.client.unit.update).toHaveBeenCalled();
    expect(await h.service.get("u1")).toBeNull();
  });
});
