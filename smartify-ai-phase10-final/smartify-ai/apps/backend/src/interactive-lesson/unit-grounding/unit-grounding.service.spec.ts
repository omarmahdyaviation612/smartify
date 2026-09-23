import { BadRequestException } from "@nestjs/common";

jest.mock("@smartify/config", () => ({ loadBackendEnv: () => ({ CURRICULUM_SOURCES_DIR: "D:\\fake-curriculum-sources" }) }));

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  execFile: jest.fn((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: "C:\\tmp\\page-8.png\nC:\\tmp\\page-9.png\n", stderr: "" });
  }),
}));

// Spread the REAL fs module and override only what this test controls —
// jest.mock("fs", () => ({ ...only mocks... })) would wipe out every other
// fs function too, breaking Prisma Client's own internal fs usage (it's
// imported transitively via PrismaService). Path resolution itself now
// lives in LocalCurriculumSourceStorage (mocked directly below via a fake
// CurriculumSourceStorage), so these fs mocks stay focused on the
// Python-render step (mkdtemp/readFileSync/rmSync of the rendered pages).
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(() => true),
  mkdtempSync: jest.fn((prefix: string) => `${prefix}abc123`),
  realpathSync: jest.fn((p: string) => p),
  readFileSync: jest.fn(() => Buffer.from("fake-png-bytes")),
  rmSync: jest.fn(),
}));

import { UnitGroundingService, UnitGroundingExtractionError } from "./unit-grounding.service";

const VALID_UNIT = {
  id: "unit-1",
  subjectId: "subject-1",
  nameEn: "Plant parts",
  sourcePageStart: 8,
  sourcePageEnd: 9,
  sourceFileOverride: null as string | null,
  subject: {
    id: "subject-1",
    nameEn: "Science",
    sourceFile: "science y5 .pdf",
    grade: {
      nameEn: "Year 5",
      level: 5,
      curriculum: { nameEn: "British International Curriculum", code: "BRITISH_INTL" },
    },
  },
};

const VALID_EXTRACTION_JSON = JSON.stringify({
  unitTitle: "Plant parts",
  gradeLevel: "Year 5",
  subject: "Science",
  learningObjectives: ["Identify the main parts of a plant."],
  concepts: [{ name: "Roots", description: "Roots absorb water and nutrients from the soil.", sourcePages: [8], importance: "core" }],
  facts: [],
  vocabulary: [],
  skills: [],
  topicHints: [],
  scopeNotes: [],
});

/**
 * Real Node built-ins (child_process/fs) are mocked at the module level
 * above — this is deliberately a unit test of UnitGroundingService's own
 * decision logic (budget reserve/reconcile, validate-then-persist,
 * malformed-output rejection), not an end-to-end test of the Python
 * renderer or a real OpenAI call (those are exercised for real via
 * `pnpm grounding:extract` against a real Unit — see the plan's
 * verification section).
 */
function makeHarness(
  opts: { generateImpl?: (args: any) => any; unitOverrides?: Partial<typeof VALID_UNIT> & { groundingNotesJson?: unknown }; lockClaimResult?: { count: number } } = {},
) {
  const updateCalls: any[] = [];
  const updateManyCalls: any[] = [];
  const usageCreateCalls: any[] = [];
  const prisma = {
    client: {
      unit: {
        findUnique: jest.fn().mockResolvedValue({ ...VALID_UNIT, ...opts.unitOverrides }),
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          updateCalls.push(data);
          return { ...VALID_UNIT, ...data };
        }),
        updateMany: jest.fn().mockImplementation(async ({ data }: any) => {
          updateManyCalls.push(data);
          // The claim call sets groundingLockedBy; the release call (in the
          // `finally`) sets it back to null — only the claim needs the
          // caller-controllable result, since a real release always succeeds.
          if (data.groundingLockedBy != null) return opts.lockClaimResult ?? { count: 1 };
          return { count: 1 };
        }),
      },
      aIUsage: { create: jest.fn().mockImplementation(async ({ data }: any) => { usageCreateCalls.push(data); return data; }) },
    },
  } as any;

  const generateSpy = jest.fn().mockImplementation(
    opts.generateImpl ?? (async () => ({ content: VALID_EXTRACTION_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" })),
  );
  const providerFactory = {
    getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate: generateSpy }, providerKey: "openai", model: "gpt-4o-mini" }),
    getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0.00001, costPerOutputToken: 0.00002 }),
  } as any;

  const contextBuilder = { buildUnitGroundingExtractionPrompt: jest.fn().mockReturnValue("extraction system prompt") } as any;

  const reserveBudget = jest.fn().mockResolvedValue({ ok: true, reservationId: "reservation-1" });
  const reconcileBudget = jest.fn().mockResolvedValue(undefined);
  const releaseBudget = jest.fn().mockResolvedValue(undefined);
  const usageService = {
    estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.05),
    reserveBudget,
    reconcileBudget,
    releaseBudget,
  } as any;

  const fetchToTempFile = jest.fn().mockResolvedValue({ localPath: "D:\\fake-curriculum-sources\\science y5 .pdf", isTemporary: false });
  const storage = { fetchToTempFile, exists: jest.fn().mockResolvedValue(true), upload: jest.fn() };
  const storageFactory = { get: jest.fn().mockReturnValue(storage) } as any;

  const service = new UnitGroundingService(prisma, providerFactory, contextBuilder, usageService, storageFactory);
  return { service, prisma, contextBuilder, generateSpy, updateCalls, updateManyCalls, usageCreateCalls, reserveBudget, reconcileBudget, releaseBudget, storage, storageFactory };
}

describe("UnitGroundingService.extractUnitGrounding", () => {
  it("success path: validates, persists groundingNotesJson + version/model/fingerprint metadata, and reserves/reconciles budget", async () => {
    const h = makeHarness();
    const result = await h.service.extractUnitGrounding("unit-1", {}, "actor-1");

    expect(result.conceptCount).toBe(1);
    expect(h.updateCalls).toHaveLength(1);
    const persisted = h.updateCalls[0];
    expect(persisted.groundingNotesJson.concepts[0].name).toBe("Roots");
    expect(persisted.groundingVersion).toBe(1);
    expect(persisted.groundingModel).toBe("gpt-4o-mini");
    expect(typeof persisted.groundingSourceFingerprint).toBe("string");
    expect(persisted.groundingSourceFingerprint.length).toBeGreaterThan(0);

    expect(h.reserveBudget).toHaveBeenCalledWith("actor-1", expect.any(Number));
    expect(h.reconcileBudget).toHaveBeenCalledWith("reservation-1", expect.any(Number));
    expect(h.usageCreateCalls[0].feature).toBe("grounding_extraction");
  });

  it("malformed output on every attempt: never marks the Unit as grounded — prefers 'extraction failed' over storing bad data", async () => {
    const h = makeHarness({ generateImpl: async () => ({ content: "not valid json", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }) });
    await expect(h.service.extractUnitGrounding("unit-1", {}, "actor-1")).rejects.toThrow(UnitGroundingExtractionError);
    expect(h.prisma.client.unit.update).not.toHaveBeenCalled();
  });

  it("unrelated-subject leakage in the response: rejected by validation, never persisted", async () => {
    const wrongSubjectJson = JSON.stringify({ ...JSON.parse(VALID_EXTRACTION_JSON), subject: "Mathematics" });
    const h = makeHarness({ generateImpl: async () => ({ content: wrongSubjectJson, inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }) });
    await expect(h.service.extractUnitGrounding("unit-1", {}, "actor-1")).rejects.toThrow(UnitGroundingExtractionError);
    expect(h.prisma.client.unit.update).not.toHaveBeenCalled();
  });

  it("retries once on invalid JSON, then succeeds on the second attempt", async () => {
    let calls = 0;
    const h = makeHarness({
      generateImpl: async () => {
        calls++;
        if (calls === 1) return { content: "not json", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
        return { content: VALID_EXTRACTION_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" };
      },
    });
    const result = await h.service.extractUnitGrounding("unit-1", {}, "actor-1");
    expect(result.conceptCount).toBe(1);
    expect(calls).toBe(2);
  });

  it("rejects before any AI call when the Subject has no sourceFile mapped", async () => {
    const h = makeHarness({ unitOverrides: { subject: { ...VALID_UNIT.subject, sourceFile: null as any } } });
    await expect(h.service.extractUnitGrounding("unit-1", {}, "actor-1")).rejects.toThrow(BadRequestException);
    expect(h.generateSpy).not.toHaveBeenCalled();
  });

  it("rejects before any AI call when the Unit has no known page range and no override is given", async () => {
    const h = makeHarness({ unitOverrides: { sourcePageStart: null as any, sourcePageEnd: null as any } });
    await expect(h.service.extractUnitGrounding("unit-1", {}, "actor-1")).rejects.toThrow(BadRequestException);
    expect(h.generateSpy).not.toHaveBeenCalled();
  });

  it("an explicit page-range override is honored over the Unit's own stored range", async () => {
    const overrideJson = JSON.stringify({ ...JSON.parse(VALID_EXTRACTION_JSON), concepts: [{ name: "Roots", description: "Roots absorb water.", sourcePages: [20], importance: "core" }] });
    const h = makeHarness({ generateImpl: async () => ({ content: overrideJson, inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }) });
    await h.service.extractUnitGrounding("unit-1", { pageRangeOverride: [20, 21] }, "actor-1");
    const promptCall = h.contextBuilder.buildUnitGroundingExtractionPrompt.mock.calls[0][0];
    expect(promptCall.pageRangeStart).toBe(20);
    expect(promptCall.pageRangeEnd).toBe(21);
  });

  // English Extra Book / Story support V1 (2026-09-20) — effective-source resolution regression tests (spec section 25).
  describe("effective-source resolution (Unit.sourceFileOverride)", () => {
    it("A. Unit override present: grounding fetches the override PDF, never the Subject's main textbook", async () => {
      const h = makeHarness({ unitOverrides: { sourceFileOverride: "british-intl/grade-1/english/extras/the-magic-garden.pdf" } });
      await h.service.extractUnitGrounding("unit-1", {}, "actor-1");
      expect(h.storage.fetchToTempFile).toHaveBeenCalledWith("british-intl/grade-1/english/extras/the-magic-garden.pdf", expect.anything());
    });

    it("B. Unit override null: grounding fetches Subject.sourceFile exactly as before", async () => {
      const h = makeHarness();
      await h.service.extractUnitGrounding("unit-1", {}, "actor-1");
      expect(h.storage.fetchToTempFile).toHaveBeenCalledWith("science y5 .pdf", expect.anything());
    });

    it("C. fingerprint reflects the actual effective source's bytes, not just the object key string — a Story Unit and a normal Unit reading DIFFERENT real PDFs get DIFFERENT fingerprints even with the same page range", async () => {
      const normal = makeHarness();
      normal.storage.fetchToTempFile.mockResolvedValue({ localPath: "D:\\fake-curriculum-sources\\normal-textbook.pdf", isTemporary: false });
      const jest_fs = require("fs");
      jest_fs.readFileSync.mockImplementation((p: string) => Buffer.from(p.includes("normal-textbook") ? "NORMAL PDF BYTES" : "STORY PDF BYTES"));
      await normal.service.extractUnitGrounding("unit-1", {}, "actor-1");
      const normalFingerprint = normal.updateCalls[0].groundingSourceFingerprint;

      const story = makeHarness({ unitOverrides: { sourceFileOverride: "british-intl/grade-1/english/extras/the-magic-garden.pdf" } });
      story.storage.fetchToTempFile.mockResolvedValue({ localPath: "D:\\fake-curriculum-sources\\story-book.pdf", isTemporary: false });
      await story.service.extractUnitGrounding("unit-1", {}, "actor-1");
      const storyFingerprint = story.updateCalls[0].groundingSourceFingerprint;

      expect(normalFingerprint).not.toBe(storyFingerprint);
    });

    it("D. rejects before any AI call when neither the Unit override nor the Subject sourceFile is set", async () => {
      const h = makeHarness({ unitOverrides: { sourceFileOverride: null, subject: { ...VALID_UNIT.subject, sourceFile: null as any } } });
      await expect(h.service.extractUnitGrounding("unit-1", {}, "actor-1")).rejects.toThrow(BadRequestException);
      expect(h.generateSpy).not.toHaveBeenCalled();
    });
  });
});

describe("UnitGroundingService.ensureUnitGrounded (production lazy-trigger + single-flight locking)", () => {
  it("already-grounded Unit: returns {used:true} immediately, claims no lock, calls no AI provider (cache checked before any grounding work)", async () => {
    const h = makeHarness({ unitOverrides: { groundingNotesJson: { concepts: [{ name: "cached" }] } } });
    const result = await h.service.ensureUnitGrounded("unit-1", "actor-1");
    expect(result).toEqual({ used: true });
    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.updateManyCalls).toHaveLength(0);
  });

  it("Subject has no sourceFile mapped: falls back to legacy generation without claiming a lock", async () => {
    const h = makeHarness({ unitOverrides: { subject: { ...VALID_UNIT.subject, sourceFile: null as any } } });
    const result = await h.service.ensureUnitGrounded("unit-1", "actor-1");
    expect(result).toEqual({ used: false, reason: "no-source" });
    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.updateManyCalls).toHaveLength(0);
  });

  it("Unit has no known page range: falls back to legacy generation without claiming a lock", async () => {
    const h = makeHarness({ unitOverrides: { sourcePageStart: null as any, sourcePageEnd: null as any } });
    const result = await h.service.ensureUnitGrounded("unit-1", "actor-1");
    expect(result).toEqual({ used: false, reason: "no-page-range" });
    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.updateManyCalls).toHaveLength(0);
  });

  it("ungrounded Unit, lock available: claims the lock, extracts, persists groundingNotesJson, and releases the lock", async () => {
    const h = makeHarness();
    const result = await h.service.ensureUnitGrounded("unit-1", "actor-1");
    expect(result).toEqual({ used: true });
    expect(h.generateSpy).toHaveBeenCalledTimes(1);
    expect(h.updateCalls).toHaveLength(1); // the actual groundingNotesJson persist
    expect(h.updateManyCalls).toHaveLength(2); // claim, then release
    expect(h.updateManyCalls[0].groundingLockedBy).toBe("actor-1");
    expect(h.updateManyCalls[1]).toEqual({ groundingLockedAt: null, groundingLockedBy: null });
  });

  it("extraction fails validation on every attempt: releases the lock and falls back, without ever persisting groundingNotesJson", async () => {
    const h = makeHarness({ generateImpl: async () => ({ content: "not valid json", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }) });
    const result = await h.service.ensureUnitGrounded("unit-1", "actor-1");
    expect(result).toEqual({ used: false, reason: "extraction-failed" });
    expect(h.updateCalls).toHaveLength(0);
    expect(h.updateManyCalls).toHaveLength(2);
    expect(h.updateManyCalls[1]).toEqual({ groundingLockedAt: null, groundingLockedBy: null });
  });

  it("storage fetch failure: releases the lock and falls back, without ever persisting groundingNotesJson", async () => {
    const h = makeHarness();
    h.storage.fetchToTempFile.mockRejectedValueOnce(new Error("object not found"));
    const result = await h.service.ensureUnitGrounded("unit-1", "actor-1");
    expect(result).toEqual({ used: false, reason: "extraction-failed" });
    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.updateCalls).toHaveLength(0);
    expect(h.updateManyCalls).toHaveLength(2);
  });

  it("budget reservation refused: treated as a graceful skip (not thrown), still releases the lock", async () => {
    const h = makeHarness();
    h.reserveBudget.mockResolvedValue({ ok: false, reason: "daily_limit" });
    const result = await h.service.ensureUnitGrounded("unit-1", "cmtz6270z0000u9c5h6ua0y67");
    expect(result).toEqual({ used: false, reason: "extraction-failed" });
    expect(h.updateManyCalls).toHaveLength(2);
  });

  it("cost isolation: reserveBudget and the AIUsage row always use the requesting actor id passed in, never a hardcoded student id", async () => {
    const h = makeHarness();
    await h.service.ensureUnitGrounded("unit-1", "cmtz6270z0000u9c5h6ua0y67");
    expect(h.reserveBudget).toHaveBeenCalledWith("cmtz6270z0000u9c5h6ua0y67", expect.any(Number));
    expect(h.usageCreateCalls[0].userId).toBe("cmtz6270z0000u9c5h6ua0y67");
    expect(h.usageCreateCalls[0].studentId).toBeNull();
  });

  it("lost the lock race (another request is already extracting): waits and reuses that extraction's result instead of extracting again", async () => {
    const h = makeHarness({ lockClaimResult: { count: 0 } });
    // Simulate the winner's extraction finishing shortly after this caller
    // starts polling — the second findUnique call (the poll's first check)
    // reports grounded.
    h.prisma.client.unit.findUnique
      .mockResolvedValueOnce({ ...VALID_UNIT, groundingNotesJson: null }) // ensureUnitGrounded's own initial check
      .mockResolvedValueOnce({ groundingNotesJson: { concepts: [{ name: "from-winner" }] } }); // poll check
    const result = await h.service.ensureUnitGrounded("unit-1", "actor-2");
    expect(result).toEqual({ used: true });
    expect(h.generateSpy).not.toHaveBeenCalled(); // the loser never re-extracts
    expect(h.updateManyCalls).toHaveLength(1); // only the (losing) claim attempt — no release, since this caller never held the lock
  });

  it("lost the lock race and the winner never finishes in time: falls back to legacy generation for this request only", async () => {
    jest.useFakeTimers();
    try {
      const h = makeHarness({ lockClaimResult: { count: 0 } });
      h.prisma.client.unit.findUnique.mockResolvedValue({ ...VALID_UNIT, groundingNotesJson: null }); // never becomes grounded
      const resultPromise = h.service.ensureUnitGrounded("unit-1", "actor-2");
      await jest.advanceTimersByTimeAsync(50_000); // past GROUNDING_WAIT_TIMEOUT_MS without fake real wall-clock time
      const result = await resultPromise;
      expect(result).toEqual({ used: false, reason: "wait-timeout" });
      expect(h.generateSpy).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("concurrent requests to the same ungrounded Unit trigger exactly ONE extraction (single-flight across simultaneous callers)", async () => {
    let grounded: unknown = null;
    let claimsGranted = 0;
    const prisma = {
      client: {
        unit: {
          findUnique: jest.fn().mockImplementation(async () => ({ ...VALID_UNIT, groundingNotesJson: grounded })),
          update: jest.fn().mockImplementation(async ({ data }: any) => {
            grounded = data.groundingNotesJson;
            return { ...VALID_UNIT, ...data };
          }),
          updateMany: jest.fn().mockImplementation(async ({ data }: any) => {
            if (data.groundingLockedBy == null) return { count: 1 }; // release always succeeds
            claimsGranted++;
            return { count: claimsGranted === 1 ? 1 : 0 };
          }),
        },
        aIUsage: { create: jest.fn().mockResolvedValue({}) },
      },
    } as any;
    const generateSpy = jest.fn().mockImplementation(async () => ({ content: VALID_EXTRACTION_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" }));
    const providerFactory = {
      getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate: generateSpy }, providerKey: "openai", model: "gpt-4o-mini" }),
      getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0.00001, costPerOutputToken: 0.00002 }),
    } as any;
    const contextBuilder = { buildUnitGroundingExtractionPrompt: jest.fn().mockReturnValue("extraction system prompt") } as any;
    const usageService = {
      estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.05),
      reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "reservation-1" }),
      reconcileBudget: jest.fn().mockResolvedValue(undefined),
      releaseBudget: jest.fn().mockResolvedValue(undefined),
    } as any;
    const storage = { fetchToTempFile: jest.fn().mockResolvedValue({ localPath: "D:\\fake-curriculum-sources\\science y5 .pdf", isTemporary: false }), exists: jest.fn(), upload: jest.fn() };
    const storageFactory = { get: () => storage } as any;
    const service = new UnitGroundingService(prisma, providerFactory, contextBuilder, usageService, storageFactory);

    const [r1, r2, r3] = await Promise.all([
      service.ensureUnitGrounded("unit-1", "actor-1"),
      service.ensureUnitGrounded("unit-1", "actor-2"),
      service.ensureUnitGrounded("unit-1", "actor-3"),
    ]);

    expect(generateSpy).toHaveBeenCalledTimes(1); // three simultaneous callers, exactly one real extraction
    expect([r1, r2, r3].every((r) => r.used === true)).toBe(true);
  }, 15000);
});

// Exercise real service -> shared runtime -> subprocess wiring as production.
const rendererTestOriginalEnv = process.env.NODE_ENV;
beforeEach(() => { process.env.NODE_ENV = "production"; });
afterEach(() => {
  try {
    const calls = (require("child_process").execFile as jest.Mock).mock.calls;
    for (const [executable, args] of calls) {
      expect(executable).toBe("/app/.pdf-renderer/bin/python");
      expect(args[0]).toBe("/app/packages/database/prisma/tools/render_pdf_pages.py");
    }
  } finally {
    if (rendererTestOriginalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = rendererTestOriginalEnv;
  }
});