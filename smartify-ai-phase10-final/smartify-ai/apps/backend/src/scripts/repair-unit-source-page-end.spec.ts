import { ALLOWLIST, EXCLUDED_SOURCE_FILE_MISMATCH, preflight, preflightAndApply, type RepairDeps } from "./repair-unit-source-page-end";

type FakeUnit = {
  id: string;
  subjectId: string;
  sourcePageStart: number | null;
  sourcePageEnd: number | null;
  sourceFileOverride: string | null;
  subject: { sourceFile: string | null; grade: { level: number; curriculum: { code: string } } };
};

// One in-memory "database" keyed by unitId, seeded from the real allowlist
// so every row already matches its expected pre-repair state by default.
// Individual tests mutate a fresh copy to simulate specific production
// states without ever touching a real database or R2 bucket.
function seedDb(): Map<string, FakeUnit> {
  const db = new Map<string, FakeUnit>();
  for (const row of ALLOWLIST) {
    db.set(row.unitId, {
      id: row.unitId,
      subjectId: row.subjectId,
      sourcePageStart: row.expectedSourcePageStart,
      sourcePageEnd: null,
      sourceFileOverride: null,
      subject: { sourceFile: `r2-key-for-${row.unitId}.pdf`, grade: { level: 1, curriculum: { code: "TEST" } } },
    });
  }
  return db;
}

function physicalPageCountFor(unitId: string): number {
  const row = ALLOWLIST.find((r) => r.unitId === unitId)!;
  return row.override != null ? row.override : row.expectedSourcePageStart + 20;
}

function makeDeps(db: Map<string, FakeUnit>) {
  const updateSourcePageEnd = jest.fn(async (rows: { unitId: string; sourcePageEnd: number }[]) => {
    for (const r of rows) {
      const existing = db.get(r.unitId);
      if (existing) db.set(r.unitId, { ...existing, sourcePageEnd: r.sourcePageEnd });
    }
  });
  const deps: RepairDeps = {
    findUnit: async (unitId) => db.get(unitId) ?? null,
    storage: { fetchToTempFile: async (sourceRef) => ({ localPath: `/fake/${sourceRef}`, isTemporary: false }) },
    countPages: (localPath: string) => {
      const unitId = [...db.entries()].find(([, u]) => `/fake/${u.subject.sourceFile}` === localPath)?.[0];
      return unitId ? physicalPageCountFor(unitId) : 0;
    },
    updateSourcePageEnd,
  };
  return { deps, updateSourcePageEnd };
}

describe("repair-unit-source-page-end allowlist", () => {
  it("contains exactly 43 rows", () => {
    expect(ALLOWLIST.length).toBe(43);
  });

  it("has no duplicate unitId", () => {
    expect(new Set(ALLOWLIST.map((r) => r.unitId)).size).toBe(43);
  });

  it("excludes BRITISH Y6 English (SOURCE_FILE_MISMATCH)", () => {
    expect(ALLOWLIST.find((r) => r.unitId === EXCLUDED_SOURCE_FILE_MISMATCH.unitId)).toBeUndefined();
    expect(EXCLUDED_SOURCE_FILE_MISMATCH.unitId).toBe("cmucxcugm00hd2qd53jl8ay86");
  });
});

describe("repair-unit-source-page-end preflight/apply", () => {
  it("default (dry-run) performs zero writes even when 43/43 preflight would pass", async () => {
    const { deps, updateSourcePageEnd } = makeDeps(seedDb());
    const result = await preflightAndApply(deps, { apply: false });
    expect(result.status).toBe("READY_TO_APPLY");
    expect(updateSourcePageEnd).not.toHaveBeenCalled();
  });

  it("43/43 valid preflight permits apply, writing all 43 rows in one call", async () => {
    const { deps, updateSourcePageEnd } = makeDeps(seedDb());
    const result = await preflightAndApply(deps, { apply: true });
    expect(result.status).toBe("READY_TO_APPLY");
    expect(updateSourcePageEnd).toHaveBeenCalledTimes(1);
    expect(updateSourcePageEnd.mock.calls[0][0]).toHaveLength(43);
  });

  it("transaction payload updates ONLY unitId + sourcePageEnd, nothing else", async () => {
    const { deps, updateSourcePageEnd } = makeDeps(seedDb());
    await preflightAndApply(deps, { apply: true });
    for (const call of updateSourcePageEnd.mock.calls[0][0]) {
      expect(Object.keys(call).sort()).toEqual(["sourcePageEnd", "unitId"]);
    }
  });

  it("post-write verification: all 43 rows read back with their exact proposed value", async () => {
    const db = seedDb();
    const { deps } = makeDeps(db);
    await preflightAndApply(deps, { apply: true });
    for (const row of ALLOWLIST) {
      const expected = row.override ?? physicalPageCountFor(row.unitId);
      expect(db.get(row.unitId)!.sourcePageEnd).toBe(expected);
    }
  });

  it("a single mismatched sourcePageStart fails closed — zero writes", async () => {
    const db = seedDb();
    const target = ALLOWLIST[5];
    db.get(target.unitId)!.sourcePageStart = target.expectedSourcePageStart + 1;
    const { deps, updateSourcePageEnd } = makeDeps(db);
    const result = await preflightAndApply(deps, { apply: true });
    expect(result.status).toBe("FAIL_CLOSED");
    expect(result.errors.some((e) => e.includes(target.unitId))).toBe(true);
    expect(updateSourcePageEnd).not.toHaveBeenCalled();
  });

  it("a missing/null resolved source key fails closed — zero writes", async () => {
    const db = seedDb();
    const target = ALLOWLIST[10];
    db.get(target.unitId)!.subject.sourceFile = null;
    const { deps, updateSourcePageEnd } = makeDeps(db);
    const result = await preflightAndApply(deps, { apply: true });
    expect(result.status).toBe("FAIL_CLOSED");
    expect(result.errors.some((e) => e.includes(target.unitId))).toBe(true);
    expect(updateSourcePageEnd).not.toHaveBeenCalled();
  });

  it("an unexpected non-null sourcePageEnd (not the proposed value) fails closed — zero writes", async () => {
    const db = seedDb();
    const target = ALLOWLIST[20];
    db.get(target.unitId)!.sourcePageEnd = 1; // clearly not the proposed value
    const { deps, updateSourcePageEnd } = makeDeps(db);
    const result = await preflightAndApply(deps, { apply: true });
    expect(result.status).toBe("FAIL_CLOSED");
    expect(result.errors.some((e) => e.includes(target.unitId) && e.includes("UNEXPECTED"))).toBe(true);
    expect(updateSourcePageEnd).not.toHaveBeenCalled();
  });

  it("exact ALREADY_APPLIED state (a prior successful apply) is safe and idempotent — zero further writes", async () => {
    const db = seedDb();
    const { deps: firstDeps } = makeDeps(db);
    await preflightAndApply(firstDeps, { apply: true });

    const { deps: secondDeps, updateSourcePageEnd: secondUpdate } = makeDeps(db);
    const result = await preflightAndApply(secondDeps, { apply: true });
    expect(result.status).toBe("ALREADY_APPLIED");
    expect(secondUpdate).not.toHaveBeenCalled();
  });

  it("mixed state (some rows PENDING, some already at their proposed value) fails closed rather than silently continuing", async () => {
    const db = seedDb();
    const target = ALLOWLIST[30];
    db.get(target.unitId)!.sourcePageEnd = target.override ?? physicalPageCountFor(target.unitId);
    const { deps, updateSourcePageEnd } = makeDeps(db);
    const result = await preflightAndApply(deps, { apply: true });
    expect(result.status).toBe("FAIL_CLOSED");
    expect(result.errors.some((e) => e.toLowerCase().includes("mixed state"))).toBe(true);
    expect(updateSourcePageEnd).not.toHaveBeenCalled();
  });

  it("preflight alone (no apply flag) never calls updateSourcePageEnd", async () => {
    const { deps, updateSourcePageEnd } = makeDeps(seedDb());
    await preflight(deps);
    expect(updateSourcePageEnd).not.toHaveBeenCalled();
  });
});
