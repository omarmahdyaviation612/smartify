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
        updateMany: jest.fn(({ where, data }: any) => { const row = rows.get(where.unitId); if (!row || (where.leaseOwner && row.leaseOwner !== where.leaseOwner)) return Promise.resolve({ count: 0 }); Object.assign(row, data); return Promise.resolve({ count: 1 }); }),
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
