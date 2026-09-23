import { BadRequestException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  execFile: jest.fn((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: "C:\\tmp\\page-1.png\nC:\\tmp\\page-2.png\n", stderr: "" });
  }),
}));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(() => true),
  mkdtempSync: jest.fn((prefix: string) => `${prefix}abc123`),
  realpathSync: jest.fn((p: string) => p),
  readFileSync: jest.fn(() => Buffer.from("fake-bytes")),
  rmSync: jest.fn(),
}));

jest.mock("pdf-parse", () => jest.fn().mockResolvedValue({ numpages: 40, text: "" }));

import { TocExtractionService, TocExtractionError } from "./toc-extraction.service";

const VALID_SUBJECT = {
  id: "subject-1",
  nameEn: "Science",
  sourceFile: "british-intl/grade-5/science/science.pdf",
  grade: { level: 5, curriculum: { code: "BRITISH_INTL", nameEn: "British International Curriculum" }, nameEn: "Year 5" },
};

const VALID_TOC_JSON = JSON.stringify({
  units: [
    { nameEn: "Plant parts", nameAr: "أجزاء النبات", sourcePageStart: 10, sourcePageEnd: 20, topics: [{ nameEn: "Roots", nameAr: "الجذور" }] },
  ],
});

function makeHarness(opts: { generateImpl?: (args: any) => any; subjectOverrides?: Partial<typeof VALID_SUBJECT>; unitCount?: number; numpages?: number } = {}) {
  const usageCreateCalls: any[] = [];
  const prisma = {
    client: {
      subject: { findUnique: jest.fn().mockResolvedValue({ ...VALID_SUBJECT, ...opts.subjectOverrides }) },
      unit: { count: jest.fn().mockResolvedValue(opts.unitCount ?? 0) },
      aIUsage: { create: jest.fn().mockImplementation(async ({ data }: any) => { usageCreateCalls.push(data); return data; }) },
    },
  } as any;

  const generateSpy = jest.fn().mockImplementation(opts.generateImpl ?? (async () => ({ content: VALID_TOC_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" })));
  const providerFactory = {
    getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate: generateSpy }, providerKey: "openai", model: "gpt-4o-mini" }),
    getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0.00001, costPerOutputToken: 0.00002 }),
  } as any;

  const contextBuilder = {
    buildTocExtractionPrompt: jest.fn().mockReturnValue("toc extraction system prompt"),
    buildFullBookStructureScanPrompt: jest.fn().mockReturnValue("full scan system prompt"),
  } as any;

  const reserveBudget = jest.fn().mockResolvedValue({ ok: true, reservationId: "reservation-1" });
  const reconcileBudget = jest.fn().mockResolvedValue(undefined);
  const releaseBudget = jest.fn().mockResolvedValue(undefined);
  const usageService = { estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.05), reserveBudget, reconcileBudget, releaseBudget } as any;

  const fetchToTempFile = jest.fn().mockResolvedValue({ localPath: "D:\\fake\\science.pdf", isTemporary: false });
  const storage = { fetchToTempFile, exists: jest.fn().mockResolvedValue(true), upload: jest.fn() };
  const storageFactory = { get: jest.fn().mockReturnValue(storage) } as any;

  const pdfParseMock = require("pdf-parse") as jest.Mock;
  pdfParseMock.mockResolvedValue({ numpages: opts.numpages ?? 40, text: "" });

  const service = new TocExtractionService(prisma, providerFactory, contextBuilder, usageService, storageFactory);
  return { service, prisma, contextBuilder, generateSpy, usageCreateCalls, reserveBudget, reconcileBudget, releaseBudget, storage, storageFactory, pdfParseMock };
}

describe("TocExtractionService.extract", () => {
  it("success path: validates, returns the candidate structure with page-count/window metadata, and reserves/reconciles budget against the given actor", async () => {
    const h = makeHarness();
    const result = await h.service.extract("subject-1", "actor-1");

    expect(result.units).toHaveLength(1);
    expect(result.units[0].nameEn).toBe("Plant parts");
    expect(result.pdfPageCount).toBe(40);
    expect(result.pagesInspected).toEqual({ start: 1, end: 10 });

    expect(h.reserveBudget).toHaveBeenCalledWith("actor-1", expect.any(Number));
    expect(h.reconcileBudget).toHaveBeenCalledWith("reservation-1", expect.any(Number));
    expect(h.usageCreateCalls[0].feature).toBe("curriculum_toc_extraction");
    expect(h.usageCreateCalls[0].userId).toBe("actor-1");
    expect(h.usageCreateCalls[0].studentId).toBeNull();
  });

  it("rejects before any AI call when the Subject has no sourceFile mapped", async () => {
    const h = makeHarness({ subjectOverrides: { sourceFile: null as any } });
    await expect(h.service.extract("subject-1", "actor-1")).rejects.toThrow(BadRequestException);
    expect(h.generateSpy).not.toHaveBeenCalled();
  });

  it("rejects when the Subject does not exist", async () => {
    const h = makeHarness();
    h.prisma.client.subject.findUnique.mockResolvedValue(null);
    await expect(h.service.extract("missing", "actor-1")).rejects.toThrow(NotFoundException);
  });

  it("rejects before any AI call when the Subject already has curriculum structure", async () => {
    const h = makeHarness({ unitCount: 3 });
    await expect(h.service.extract("subject-1", "actor-1")).rejects.toThrow(BadRequestException);
    expect(h.generateSpy).not.toHaveBeenCalled();
  });

  it("falls back to a second page window when the first window finds no table of contents, and succeeds there", async () => {
    let calls = 0;
    const h = makeHarness({
      generateImpl: async () => {
        calls++;
        if (calls === 1) return { content: JSON.stringify({ units: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // window 1: valid JSON, but genuinely no TOC found — no retry needed
        return { content: VALID_TOC_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" }; // window 2: succeeds
      },
    });
    const result = await h.service.extract("subject-1", "actor-1");
    expect(result.units).toHaveLength(1);
    expect(result.pagesInspected).toEqual({ start: 11, end: 20 });
    expect(calls).toBe(2); // window 1 (1 attempt, valid-but-empty, no retry) + window 2 (1 attempt, succeeds)
  });

  it("retries once within a window on invalid JSON, then succeeds on the second attempt", async () => {
    let calls = 0;
    const h = makeHarness({
      generateImpl: async () => {
        calls++;
        if (calls === 1) return { content: "not json", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
        return { content: VALID_TOC_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" };
      },
    });
    const result = await h.service.extract("subject-1", "actor-1");
    expect(result.units).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("both windows find nothing: rejects with a clear, safe error, never a raw provider/stack detail", async () => {
    const h = makeHarness({ generateImpl: async () => ({ content: JSON.stringify({ units: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }) });
    await expect(h.service.extract("subject-1", "actor-1")).rejects.toThrow(BadRequestException);
    await expect(h.service.extract("subject-1", "actor-1")).rejects.toThrow(/table of contents/);
  });

  it("a PDF short enough to fit in one window never attempts a second window", async () => {
    const h = makeHarness({ numpages: 8, generateImpl: async () => ({ content: JSON.stringify({ units: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }) });
    await expect(h.service.extract("subject-1", "actor-1")).rejects.toThrow(BadRequestException);
    expect(h.generateSpy).toHaveBeenCalledTimes(1);
  });

  it("budget reservation refused: propagates immediately as a safe ServiceUnavailableException, never silently treated as 'no TOC found'", async () => {
    const h = makeHarness();
    h.reserveBudget.mockResolvedValue({ ok: false, reason: "user_exceeded" });
    await expect(h.service.extract("subject-1", "actor-1")).rejects.toThrow(ServiceUnavailableException);
    expect(h.generateSpy).not.toHaveBeenCalled();
  });

  it("cost isolation: the AIUsage row and budget reservation always use the requesting actor id passed in, never a hardcoded id", async () => {
    const h = makeHarness();
    await h.service.extract("subject-1", "cmtz6270z0000u9c5h6ua0y67");
    expect(h.reserveBudget).toHaveBeenCalledWith("cmtz6270z0000u9c5h6ua0y67", expect.any(Number));
    expect(h.usageCreateCalls[0].userId).toBe("cmtz6270z0000u9c5h6ua0y67");
  });

  it("never writes to the database — no Unit/Topic create call exists on the service or its Prisma mock", async () => {
    const h = makeHarness();
    await h.service.extract("subject-1", "actor-1");
    expect(h.prisma.client.unit.create).toBeUndefined();
  });
});

describe("TocExtractionService.extract — sourceOverride (English Extra Book / Story support V1)", () => {
  it("fetches the override PDF instead of the Subject's main textbook when sourceOverride is given", async () => {
    const h = makeHarness();
    await h.service.extract("subject-1", "actor-1", { sourceOverride: "british-intl/grade-1/english/extras/the-magic-garden.pdf" });
    expect(h.storage.fetchToTempFile).toHaveBeenCalledWith("british-intl/grade-1/english/extras/the-magic-garden.pdf", expect.anything());
  });

  it("skips the 'Subject already has curriculum structure' guard when sourceOverride is given — an extra book is added to a Subject that already has main-textbook Units", async () => {
    const h = makeHarness({ unitCount: 5 });
    const result = await h.service.extract("subject-1", "actor-1", { sourceOverride: "british-intl/grade-1/english/extras/the-magic-garden.pdf" });
    expect(result.units).toHaveLength(1);
    expect(h.prisma.client.unit.count).not.toHaveBeenCalled();
  });

  it("without sourceOverride, still enforces the zero-Units guard exactly as before", async () => {
    const h = makeHarness({ unitCount: 3 });
    await expect(h.service.extract("subject-1", "actor-1")).rejects.toThrow(BadRequestException);
  });
});

describe("TocExtractionService.extract — fullScanFallback (Extra Book full-book structure-scan fallback)", () => {
  // numpages=40 (harness default): TOC windows cover [1-10],[11-20] = 2 calls before any fallback;
  // full-scan chunks (12 pages each) cover [1-12],[13-24],[25-36],[37-40] = 4 more calls.
  function tocEmptyThenScanChunks(chunks: Array<Array<{ titleEn: string; titleAr: string; pdfPage: number }>>) {
    let calls = 0;
    return async () => {
      calls++;
      if (calls <= 2) return { content: JSON.stringify({ units: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
      const chunkIndex = calls - 3;
      return { content: JSON.stringify({ headings: chunks[chunkIndex] ?? [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
    };
  }

  it("TOC success → fallback never runs, even when fullScanFallback is true", async () => {
    const h = makeHarness(); // default generateImpl returns a valid TOC on the very first call
    const result = await h.service.extract("subject-1", "actor-1", { fullScanFallback: true });
    expect(result.units).toHaveLength(1);
    expect(result.units[0].nameEn).toBe("Plant parts");
    expect(h.contextBuilder.buildFullBookStructureScanPrompt).not.toHaveBeenCalled();
    expect(h.generateSpy).toHaveBeenCalledTimes(1);
  });

  it("without fullScanFallback, a TOC miss still fails outright — the fallback is opt-in only", async () => {
    const h = makeHarness({ generateImpl: async () => ({ content: JSON.stringify({ units: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }) });
    await expect(h.service.extract("subject-1", "actor-1")).rejects.toThrow(BadRequestException);
    expect(h.contextBuilder.buildFullBookStructureScanPrompt).not.toHaveBeenCalled();
  });

  it("no TOC found → the bounded full-book structure scan runs and its result is returned", async () => {
    const h = makeHarness({
      generateImpl: tocEmptyThenScanChunks([
        [{ titleEn: "Chapter 1", titleAr: "الفصل 1", pdfPage: 4 }],
        [{ titleEn: "Chapter 2", titleAr: "الفصل 2", pdfPage: 15 }],
        [{ titleEn: "Chapter 3", titleAr: "الفصل 3", pdfPage: 28 }],
        [],
      ]),
    });
    const result = await h.service.extract("subject-1", "actor-1", { fullScanFallback: true });

    expect(result.units.map((u) => u.nameEn)).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
    expect(h.contextBuilder.buildFullBookStructureScanPrompt).toHaveBeenCalled();
    expect(h.generateSpy).toHaveBeenCalledTimes(6); // 2 TOC-window calls + 4 full-scan chunk calls
    expect(result.pagesInspected).toEqual({ start: 1, end: 40 }); // whole 40-page book scanned
  });

  it("chapter starts detected across MULTIPLE chunks (chunk 0 finds one, chunk 1 finds the next) merge correctly into one continuous, correctly-ranged structure spanning the chunk boundary", async () => {
    const h = makeHarness({
      generateImpl: tocEmptyThenScanChunks([
        [{ titleEn: "Chapter 1", titleAr: "1", pdfPage: 4 }], // detected in chunk 0 (pages 1-12)
        [{ titleEn: "Chapter 2", titleAr: "2", pdfPage: 15 }], // detected in chunk 1 (pages 13-24) — a DIFFERENT AI call/response than chunk 0's
        [],
        [],
      ]),
    });
    const result = await h.service.extract("subject-1", "actor-1", { fullScanFallback: true });
    expect(result.units.map((u) => u.nameEn)).toEqual(["Chapter 1", "Chapter 2"]);
    // Chapter 1's range correctly extends PAST its own chunk's boundary (page 12) up to page 14, right before Chapter 2 (detected in the NEXT chunk) begins — proving the two chunks' results were combined, not treated as independent/boundary-clipped ranges.
    expect(result.units[0]).toMatchObject({ sourcePageStart: 4, sourcePageEnd: 14 });
    expect(result.units[1]).toMatchObject({ sourcePageStart: 15, sourcePageEnd: 40 });
  });

  it("duplicate headings (a running header re-detected across chunks) are removed before validation", async () => {
    const h = makeHarness({
      generateImpl: tocEmptyThenScanChunks([
        [{ titleEn: "Anna and the Dolphin", titleAr: "آنا والدلفين", pdfPage: 4 }],
        [{ titleEn: "Anna and the Dolphin", titleAr: "آنا والدلفين", pdfPage: 13 }], // same running title re-detected in the next chunk
        [{ titleEn: "Chapter 2", titleAr: "2", pdfPage: 28 }],
        [],
      ]),
    });
    const result = await h.service.extract("subject-1", "actor-1", { fullScanFallback: true });
    expect(result.units).toHaveLength(2);
    expect(result.units[0]).toMatchObject({ nameEn: "Anna and the Dolphin", sourcePageStart: 4, sourcePageEnd: 27 });
  });

  it("invalid merged result (e.g. the same non-adjacent title surviving as two distinct Units) fails safely — no crash, no bad data returned, safe error message", async () => {
    const h = makeHarness({
      generateImpl: tocEmptyThenScanChunks([
        [{ titleEn: "Interlude", titleAr: "فاصل", pdfPage: 4 }],
        [{ titleEn: "Chapter 1", titleAr: "1", pdfPage: 15 }],
        [{ titleEn: "Interlude", titleAr: "فاصل", pdfPage: 28 }], // legitimately non-adjacent, but duplicate-named — rejected by validateTocExtraction
        [],
      ]),
    });
    let caught: unknown;
    try {
      await h.service.extract("subject-1", "actor-1", { fullScanFallback: true });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).message).not.toMatch(/stack|Prisma|undefined is not/);
  });

  it("a single chunk that fails validation on every attempt (including its own corrective retry) does not abort the whole scan — it just contributes no headings", async () => {
    // Explicit call-by-call mock (not the generic per-chunk helper above) because this chunk
    // consumes TWO calls of its own (initial attempt + corrective retry), which would desync a
    // naive "call N = chunk N" mapping — calls: 1-2 TOC windows, 3 chunk0 (valid), 4-5 chunk1
    // (invalid both attempts), 6 chunk2 (valid), 7 chunk3 (empty, in range).
    let calls = 0;
    const h = makeHarness({
      generateImpl: async () => {
        calls++;
        if (calls <= 2) return { content: JSON.stringify({ units: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
        if (calls === 3) return { content: JSON.stringify({ headings: [{ titleEn: "Chapter 1", titleAr: "1", pdfPage: 4 }] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
        if (calls === 4 || calls === 5) return { content: JSON.stringify({ headings: [{ titleEn: "missing required fields" }] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
        if (calls === 6) return { content: JSON.stringify({ headings: [{ titleEn: "Chapter 3", titleAr: "3", pdfPage: 28 }] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
        return { content: JSON.stringify({ headings: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
      },
    });
    const result = await h.service.extract("subject-1", "actor-1", { fullScanFallback: true });
    expect(result.units.map((u) => u.nameEn)).toEqual(["Chapter 1", "Chapter 3"]);
    expect(calls).toBe(7);
  });

  it("both the fast TOC search and the full scan find nothing → a safe, clear error, never a raw internal detail", async () => {
    const h = makeHarness({ generateImpl: async () => ({ content: JSON.stringify({ units: [], headings: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }) });
    await expect(h.service.extract("subject-1", "actor-1", { fullScanFallback: true })).rejects.toThrow(/Enter Structure Manually/);
  });

  it("no DB writes happen during Analyze, even when the full scan runs — only aIUsage.create (accounting), never Unit/Topic", async () => {
    const h = makeHarness({
      generateImpl: tocEmptyThenScanChunks([[{ titleEn: "Chapter 1", titleAr: "1", pdfPage: 4 }], [], [], []]),
    });
    await h.service.extract("subject-1", "actor-1", { fullScanFallback: true });
    expect(h.prisma.client.unit.create).toBeUndefined();
    expect((h.prisma.client as any).topic).toBeUndefined();
  });

  it("every full-scan chunk bills AIUsage to the requesting (platform) actor only — never a student id", async () => {
    const h = makeHarness({
      generateImpl: tocEmptyThenScanChunks([[{ titleEn: "Chapter 1", titleAr: "1", pdfPage: 4 }], [], [], []]),
    });
    await h.service.extract("subject-1", "cmtz6270z0000u9c5h6ua0y67", { fullScanFallback: true });
    expect(h.usageCreateCalls.length).toBeGreaterThan(0);
    expect(h.usageCreateCalls.every((c) => c.userId === "cmtz6270z0000u9c5h6ua0y67" && c.studentId === null)).toBe(true);
  });

  it("a full-scan chunk's budget refusal propagates immediately as a safe ServiceUnavailableException", async () => {
    const h = makeHarness({ generateImpl: async () => ({ content: JSON.stringify({ units: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }) });
    let calls = 0;
    h.reserveBudget.mockImplementation(async () => {
      calls++;
      return calls <= 2 ? { ok: true, reservationId: `r${calls}` } : { ok: false, reason: "user_exceeded" };
    });
    await expect(h.service.extract("subject-1", "actor-1", { fullScanFallback: true })).rejects.toThrow(ServiceUnavailableException);
  });

  // BUG FIX regression (2026-09-20): a real Extra Book Analyze run on a real
  // book hit a genuine OpenAI 429 rate-limit error partway through a
  // multi-chunk full scan. Before the fix, provider.generate() throwing
  // inside scanChunkWithRetry propagated all the way up through
  // fullBookStructureScan → extract() → the controller, aborting the ENTIRE
  // request (frontend: "An unexpected error occurred") and losing every
  // other chunk's already-completed work. A transient provider-call failure
  // on one chunk must be treated like a validation failure: retried, then
  // gracefully absorbed (contributing zero headings) — never fatal to the
  // whole scan.
  it("a provider-call error (e.g. a 429 rate limit) on ONE chunk does not abort the whole scan — later chunks still run and their results are still used", async () => {
    let calls = 0;
    const h = makeHarness({
      generateImpl: async () => {
        calls++;
        if (calls <= 2) return { content: JSON.stringify({ units: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // TOC windows
        if (calls === 3) return { content: JSON.stringify({ headings: [{ titleEn: "Chapter 1", titleAr: "1", pdfPage: 4 }] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // chunk0: valid
        if (calls === 4 || calls === 5) throw new Error("429 Rate limit reached for gpt-4o-mini ... Please try again in 885ms."); // chunk1: provider fails on both attempts
        if (calls === 6) return { content: JSON.stringify({ headings: [{ titleEn: "Chapter 3", titleAr: "3", pdfPage: 28 }] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // chunk2: valid
        return { content: JSON.stringify({ headings: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // chunk3: empty
      },
    });

    const result = await h.service.extract("subject-1", "actor-1", { fullScanFallback: true });

    expect(result.units.map((u) => u.nameEn)).toEqual(["Chapter 1", "Chapter 3"]);
    expect(calls).toBe(7);
  });

  it("a provider-call error releases that attempt's budget reservation before retrying/giving up (no stranded reservation)", async () => {
    let calls = 0;
    const h = makeHarness({
      generateImpl: async () => {
        calls++;
        if (calls <= 2) return { content: JSON.stringify({ units: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
        throw new Error("429 rate limited");
      },
    });
    // Every chunk's provider call fails on every attempt here, so the whole
    // scan ultimately finds nothing and extract() throws its own safe
    // "no structure found" error — that outer failure is expected and not
    // what this test is about; what matters is that every reservation this
    // path created was also released, never left stranded.
    await expect(h.service.extract("subject-1", "actor-1", { fullScanFallback: true })).rejects.toThrow(BadRequestException);
    expect(h.releaseBudget.mock.calls.length).toBeGreaterThan(0);
  });

  it("respects the documented page ceiling for a very long book — never scans indefinitely", async () => {
    const h = makeHarness({
      numpages: 5000,
      generateImpl: async () => ({ content: JSON.stringify({ units: [], headings: [] }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }),
    });
    await expect(h.service.extract("subject-1", "actor-1", { fullScanFallback: true })).rejects.toThrow(BadRequestException);
    // 2 TOC-window calls + at most 20 full-scan chunk calls (MAX_FULL_SCAN_CHUNKS) — never one call per each of 5000 pages.
    expect(h.generateSpy.mock.calls.length).toBeLessThanOrEqual(2 + 20);
  });
});

describe("TocExtractionService.getPageCount", () => {
  it("returns the real page count without making any AI call", async () => {
    const h = makeHarness({ numpages: 123 });
    const count = await h.service.getPageCount("subject-1");
    expect(count).toBe(123);
    expect(h.generateSpy).not.toHaveBeenCalled();
  });

  it("rejects when the Subject has no sourceFile", async () => {
    const h = makeHarness({ subjectOverrides: { sourceFile: null as any } });
    await expect(h.service.getPageCount("subject-1")).rejects.toThrow(BadRequestException);
  });

  it("with sourceOverride, fetches THAT PDF instead of Subject.sourceFile, and works even when the Subject has no main textbook at all", async () => {
    const h = makeHarness({ subjectOverrides: { sourceFile: null as any }, numpages: 55 });
    const count = await h.service.getPageCount("subject-1", { sourceOverride: "british-intl/grade-1/english/extras/the-magic-garden.pdf" });
    expect(count).toBe(55);
    expect(h.storage.fetchToTempFile).toHaveBeenCalledWith("british-intl/grade-1/english/extras/the-magic-garden.pdf", expect.anything());
  });

  it("rejects when the Subject does not exist", async () => {
    const h = makeHarness();
    h.prisma.client.subject.findUnique.mockResolvedValue(null);
    await expect(h.service.getPageCount("missing")).rejects.toThrow(NotFoundException);
  });
});

describe("TocExtractionError", () => {
  it("carries the last validation errors for diagnostics", () => {
    const err = new TocExtractionError("failed", ["reason 1", "reason 2"]);
    expect(err.lastErrors).toEqual(["reason 1", "reason 2"]);
    expect(err.name).toBe("TocExtractionError");
  });
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