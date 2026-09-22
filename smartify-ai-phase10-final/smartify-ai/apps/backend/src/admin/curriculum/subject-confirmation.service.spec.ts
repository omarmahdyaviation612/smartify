import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AdminCurriculumService } from "./admin-curriculum.service";

/**
 * Admin New Subject + Textbook Ingestion V1 (2026-09-20) — AdminCurriculumService's
 * own logic for createSubject(isActive), analyzeSubjectTextbook (thin
 * pass-through), and confirmSubjectStructure (server-side re-validation,
 * idempotency guard, atomic transaction). TocExtractionService's own
 * extraction/validation logic is covered separately in
 * subject-ingestion/toc-extraction.service.spec.ts and
 * toc-extraction-validator.spec.ts — this file only tests
 * AdminCurriculumService's use of it.
 */

const VALID_SUBJECT = {
  id: "subject-1",
  nameEn: "English",
  gradeId: "grade-1",
  grade: { curriculumId: "curriculum-1", level: 1, curriculum: { code: "BRITISH_INTL" } },
};
const EXTRA_BOOK_KEY = "british-intl/grade-1/english/extras/the-magic-garden.pdf";

function makeService(
  opts: {
    subject?: typeof VALID_SUBJECT | null;
    existingUnitCount?: number;
    raceCheckCount?: number;
    pdfPageCount?: number;
    extraBookExists?: boolean;
    uploadExtraBookImpl?: (...args: any[]) => any;
  } = {},
) {
  const unitCreateCalls: any[] = [];
  const topicCreateManyCalls: any[] = [];
  const tx = {
    unit: {
      count: jest.fn().mockResolvedValue(opts.raceCheckCount ?? 0),
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        unitCreateCalls.push(data);
        return { id: `unit-${unitCreateCalls.length}`, ...data };
      }),
      aggregate: jest.fn().mockResolvedValue({ _max: { order: 0 } }),
    },
    topic: {
      createMany: jest.fn().mockImplementation(async ({ data }: any) => {
        topicCreateManyCalls.push(data);
        return { count: data.length };
      }),
    },
  };

  const prisma = {
    client: {
      subject: { findUnique: jest.fn().mockResolvedValue(opts.subject === undefined ? VALID_SUBJECT : opts.subject), create: jest.fn() },
      unit: { count: jest.fn().mockResolvedValue(opts.existingUnitCount ?? 0) },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    },
  } as any;

  const tocExtraction = {
    extract: jest.fn().mockResolvedValue({ units: [{ nameEn: "Unit 1", nameAr: "وحدة 1", sourcePageStart: 1, sourcePageEnd: 10, topics: [{ nameEn: "Topic 1", nameAr: "موضوع 1" }] }], pdfPageCount: 50, pagesInspected: { start: 1, end: 10 } }),
    getPageCount: jest.fn().mockResolvedValue(opts.pdfPageCount ?? 100),
  } as any;

  const uploadExtraBook = jest.fn(opts.uploadExtraBookImpl ?? (async ({ subjectId, bookLabel }: any) => ({ subjectId, bookLabel, objectKey: EXTRA_BOOK_KEY })));
  const sourceUpload = { uploadExtraBook } as any;

  const existsSpy = jest.fn().mockResolvedValue(opts.extraBookExists ?? true);
  const storage = { exists: existsSpy };
  const storageFactory = { get: jest.fn().mockReturnValue(storage) } as any;

  const service = new AdminCurriculumService(prisma, {} as any, sourceUpload, tocExtraction, storageFactory);
  return { service, prisma, tx, tocExtraction, sourceUpload, uploadExtraBook, storageFactory, existsSpy, unitCreateCalls, topicCreateManyCalls };
}

function validInput(overrides: Partial<{ curriculumId: string; gradeId: string; units: any[] }> = {}) {
  return {
    curriculumId: "curriculum-1",
    gradeId: "grade-1",
    units: [
      {
        nameEn: "Unit 1",
        nameAr: "وحدة 1",
        sourcePageStart: 1,
        sourcePageEnd: 10,
        topics: [{ nameEn: "Topic A", nameAr: "أ" }, { nameEn: "Topic B", nameAr: "ب" }],
      },
    ],
    ...overrides,
  };
}

describe("AdminCurriculumService.createSubject — draft creation", () => {
  it("passes isActive through when the caller supplies it (the New Subject flow's draft-creation use)", async () => {
    const { service, prisma } = makeService();
    await service.createSubject("grade-1", { nameEn: "Science", nameAr: "العلوم", isActive: false });
    expect(prisma.client.subject.create).toHaveBeenCalledWith({ data: { gradeId: "grade-1", nameEn: "Science", nameAr: "العلوم", isActive: false } });
  });

  it("omits isActive entirely when the caller doesn't supply it — every pre-existing caller's behavior is unchanged", async () => {
    const { service, prisma } = makeService();
    await service.createSubject("grade-1", { nameEn: "Science", nameAr: "العلوم" });
    const callArg = prisma.client.subject.create.mock.calls[0][0];
    expect(callArg.data).not.toHaveProperty("isActive");
  });
});

describe("AdminCurriculumService.analyzeSubjectTextbook", () => {
  it("delegates to TocExtractionService using the fixed content-authoring actor, never a real user id", async () => {
    const { service, tocExtraction } = makeService();
    await service.analyzeSubjectTextbook("subject-1");
    expect(tocExtraction.extract).toHaveBeenCalledWith("subject-1", "cmtz6270z0000u9c5h6ua0y67");
  });
});

describe("AdminCurriculumService.confirmSubjectStructure", () => {
  it("happy path: creates Units and Topics atomically inside one transaction and returns accurate counts", async () => {
    const { service, tx, unitCreateCalls, topicCreateManyCalls } = makeService();
    const result = await service.confirmSubjectStructure("subject-1", validInput());

    expect(result).toEqual({ subjectId: "subject-1", unitsCreated: 1, topicsCreated: 2 });
    expect(tx.unit.create).toHaveBeenCalledTimes(1);
    expect(unitCreateCalls[0]).toMatchObject({ subjectId: "subject-1", nameEn: "Unit 1", nameAr: "وحدة 1", order: 1, sourcePageStart: 1, sourcePageEnd: 10 });
    expect(topicCreateManyCalls[0]).toEqual([
      { unitId: "unit-1", nameEn: "Topic A", nameAr: "أ", order: 1 },
      { unitId: "unit-1", nameEn: "Topic B", nameAr: "ب", order: 2 },
    ]);
  });

  it("never persists Topic page-range fields — Topic has no such columns", async () => {
    const { service, topicCreateManyCalls } = makeService();
    await service.confirmSubjectStructure(
      "subject-1",
      validInput({ units: [{ nameEn: "U1", nameAr: "و", sourcePageStart: 1, sourcePageEnd: 10, topics: [{ nameEn: "T1", nameAr: "ت", sourcePageStart: 2, sourcePageEnd: 3 }] }] }),
    );
    expect(topicCreateManyCalls[0][0]).not.toHaveProperty("sourcePageStart");
    expect(topicCreateManyCalls[0][0]).not.toHaveProperty("sourcePageEnd");
  });

  it("never touches Subject.isActive — publishing stays a separate, deliberate admin action", async () => {
    const { service, prisma } = makeService();
    await service.confirmSubjectStructure("subject-1", validInput());
    expect(prisma.client.subject.create).not.toHaveBeenCalled();
    expect((prisma.client.subject as any).update).toBeUndefined();
  });

  it("rejects when the Subject does not exist", async () => {
    const { service } = makeService({ subject: null });
    await expect(service.confirmSubjectStructure("missing", validInput())).rejects.toThrow(NotFoundException);
  });

  it("rejects when the submitted gradeId does not match the Subject's real grade", async () => {
    const { service, tx } = makeService();
    await expect(service.confirmSubjectStructure("subject-1", validInput({ gradeId: "wrong-grade" }))).rejects.toThrow(BadRequestException);
    expect(tx.unit.create).not.toHaveBeenCalled();
  });

  it("rejects when the submitted curriculumId does not match the Subject's real curriculum", async () => {
    const { service, tx } = makeService();
    await expect(service.confirmSubjectStructure("subject-1", validInput({ curriculumId: "wrong-curriculum" }))).rejects.toThrow(BadRequestException);
    expect(tx.unit.create).not.toHaveBeenCalled();
  });

  it("re-validates the payload server-side and rejects invalid structure (e.g. duplicate Unit names) even though the client-side Zod schema already passed", async () => {
    const { service, tx } = makeService();
    const input = validInput({
      units: [
        { nameEn: "Unit A", nameAr: "أ", sourcePageStart: 1, sourcePageEnd: 5, topics: [{ nameEn: "T", nameAr: "ت" }] },
        { nameEn: "unit a", nameAr: "أ2", sourcePageStart: 6, sourcePageEnd: 10, topics: [{ nameEn: "T2", nameAr: "ت2" }] },
      ],
    });
    await expect(service.confirmSubjectStructure("subject-1", input)).rejects.toThrow(BadRequestException);
    expect(tx.unit.create).not.toHaveBeenCalled();
  });

  it("re-derives the real PDF page count and rejects a page range the client claims but the real file doesn't have", async () => {
    const { service, tx } = makeService({ pdfPageCount: 20 });
    const input = validInput({ units: [{ nameEn: "Unit 1", nameAr: "و", sourcePageStart: 15, sourcePageEnd: 500, topics: [{ nameEn: "T", nameAr: "ت" }] }] });
    await expect(service.confirmSubjectStructure("subject-1", input)).rejects.toThrow(BadRequestException);
    expect(tx.unit.create).not.toHaveBeenCalled();
  });

  it("refuses confirmation when this Subject already has curriculum structure (checked before the transaction)", async () => {
    const { service, prisma, tx } = makeService({ existingUnitCount: 2 });
    await expect(service.confirmSubjectStructure("subject-1", validInput())).rejects.toThrow(BadRequestException);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    expect(tx.unit.create).not.toHaveBeenCalled();
  });

  it("duplicate/concurrent confirmation: the in-transaction race-check refuses even when the pre-check outside the transaction passed", async () => {
    const { service, tx } = makeService({ existingUnitCount: 0, raceCheckCount: 1 });
    await expect(service.confirmSubjectStructure("subject-1", validInput())).rejects.toThrow(BadRequestException);
    expect(tx.unit.create).not.toHaveBeenCalled();
  });
});

// ==========================================================
// English Extra Book / Story support V1 (2026-09-20)
// ==========================================================

function validExtraBookInput(overrides: Partial<{ bookLabel: string; units: any[] }> = {}) {
  return {
    bookLabel: "The Magic Garden",
    units: [
      {
        nameEn: "Story — The Magic Garden",
        nameAr: "قصة — الحديقة السحرية",
        sourcePageStart: 4,
        sourcePageEnd: 35,
        topics: [{ nameEn: "Chapter 1", nameAr: "الفصل 1" }, { nameEn: "Chapter 2", nameAr: "الفصل 2" }],
      },
    ],
    ...overrides,
  };
}

describe("AdminCurriculumService.uploadExtraBook", () => {
  it("delegates to CurriculumSourceUploadService.uploadExtraBook with the subject, buffer, and book label", async () => {
    const { service, uploadExtraBook } = makeService();
    await service.uploadExtraBook("subject-1", { buffer: Buffer.from("pdf") }, "The Magic Garden");
    expect(uploadExtraBook).toHaveBeenCalledWith({ subjectId: "subject-1", buffer: Buffer.from("pdf"), bookLabel: "The Magic Garden" });
  });
});

describe("AdminCurriculumService.analyzeExtraBook", () => {
  it("resolves the deterministic key, verifies it exists, then delegates to TocExtractionService with sourceOverride + fullScanFallback + the platform actor", async () => {
    const { service, tocExtraction, existsSpy } = makeService();
    await service.analyzeExtraBook("subject-1", "The Magic Garden");
    expect(existsSpy).toHaveBeenCalledWith(EXTRA_BOOK_KEY, expect.anything());
    expect(tocExtraction.extract).toHaveBeenCalledWith("subject-1", "cmtz6270z0000u9c5h6ua0y67", { sourceOverride: EXTRA_BOOK_KEY, fullScanFallback: true });
  });

  it("H/I. refuses when the derived key does not exist in storage — an arbitrary/wrong-scope book label can never be analyzed", async () => {
    const { service, tocExtraction } = makeService({ extraBookExists: false });
    await expect(service.analyzeExtraBook("subject-1", "Never Uploaded")).rejects.toThrow(BadRequestException);
    expect(tocExtraction.extract).not.toHaveBeenCalled();
  });
});

describe("AdminCurriculumService.confirmExtraBookStructure", () => {
  it("A/E. appends new Units+Topics under the existing Subject, with correct Topic nesting", async () => {
    const { service, tx, unitCreateCalls, topicCreateManyCalls } = makeService();
    const result = await service.confirmExtraBookStructure("subject-1", validExtraBookInput());

    expect(result).toEqual({ subjectId: "subject-1", unitsCreated: 1, topicsCreated: 2, sourceFileOverride: EXTRA_BOOK_KEY });
    expect(tx.unit.create).toHaveBeenCalledTimes(1);
    expect(topicCreateManyCalls[0]).toEqual([
      { unitId: "unit-1", nameEn: "Chapter 1", nameAr: "الفصل 1", order: 1 },
      { unitId: "unit-1", nameEn: "Chapter 2", nameAr: "الفصل 2", order: 2 },
    ]);
  });

  it("B. every new Unit receives the same correct sourceFileOverride — the verified extra-book key, never the Subject's main textbook", async () => {
    const { service, unitCreateCalls } = makeService();
    await service.confirmExtraBookStructure(
      "subject-1",
      validExtraBookInput({
        units: [
          { nameEn: "Unit A", nameAr: "أ", sourcePageStart: 1, sourcePageEnd: 5, topics: [{ nameEn: "T", nameAr: "ت" }] },
          { nameEn: "Unit B", nameAr: "ب", sourcePageStart: 6, sourcePageEnd: 10, topics: [{ nameEn: "T2", nameAr: "ت2" }] },
        ],
      }),
    );
    expect(unitCreateCalls).toHaveLength(2);
    expect(unitCreateCalls.every((u) => u.sourceFileOverride === EXTRA_BOOK_KEY)).toBe(true);
  });

  it("continues Unit.order after the Subject's existing highest order, instead of colliding with existing Units", async () => {
    const { service, tx, unitCreateCalls } = makeService();
    tx.unit.aggregate.mockResolvedValue({ _max: { order: 7 } });
    await service.confirmExtraBookStructure("subject-1", validExtraBookInput());
    expect(unitCreateCalls[0].order).toBe(8);
  });

  it("C. existing Units are never read/written outside the count/aggregate checks — no Unit.update call exists on the mock at all", async () => {
    const { service, tx } = makeService();
    await service.confirmExtraBookStructure("subject-1", validExtraBookInput());
    expect((tx.unit as any).update).toBeUndefined();
  });

  it("D. Subject.sourceFile is never touched — no Subject.update call exists on the mock at all", async () => {
    const { service, prisma } = makeService();
    await service.confirmExtraBookStructure("subject-1", validExtraBookInput());
    expect((prisma.client.subject as any).update).toBeUndefined();
    expect(prisma.client.subject.create).not.toHaveBeenCalled();
  });

  it("F. transaction atomicity: the whole append happens inside one $transaction call", async () => {
    const { service, prisma } = makeService();
    await service.confirmExtraBookStructure("subject-1", validExtraBookInput());
    expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
  });

  it("G. duplicate confirmation protected: refuses when a Unit already carries this exact sourceFileOverride (checked before the transaction)", async () => {
    // existingUnitCount is irrelevant here (Subject legitimately already has main-textbook Units) — the
    // idempotency signal is specifically "any Unit with THIS sourceFileOverride", modeled via a scoped count.
    const { service, prisma, tx } = makeService();
    prisma.client.unit.count.mockResolvedValue(1); // simulates a Unit already carrying EXTRA_BOOK_KEY
    await expect(service.confirmExtraBookStructure("subject-1", validExtraBookInput())).rejects.toThrow(BadRequestException);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    expect(tx.unit.create).not.toHaveBeenCalled();
  });

  it("G. duplicate/concurrent confirmation: the in-transaction race-check refuses even when the pre-check outside the transaction passed", async () => {
    const { service, tx } = makeService({ raceCheckCount: 1 });
    await expect(service.confirmExtraBookStructure("subject-1", validExtraBookInput())).rejects.toThrow(BadRequestException);
    expect(tx.unit.create).not.toHaveBeenCalled();
  });

  it("H. refuses when the derived key does not exist in storage — confirmation cannot be forged by supplying an arbitrary bookLabel that was never uploaded", async () => {
    const { service, tx } = makeService({ extraBookExists: false });
    await expect(service.confirmExtraBookStructure("subject-1", validExtraBookInput())).rejects.toThrow(BadRequestException);
    expect(tx.unit.create).not.toHaveBeenCalled();
  });

  it("re-derives the real PDF page count of the EXTRA book (not the main textbook) and rejects an out-of-range page", async () => {
    const { service, tx } = makeService({ pdfPageCount: 20 });
    const input = validExtraBookInput({ units: [{ nameEn: "Unit 1", nameAr: "و", sourcePageStart: 15, sourcePageEnd: 500, topics: [{ nameEn: "T", nameAr: "ت" }] }] });
    await expect(service.confirmExtraBookStructure("subject-1", input)).rejects.toThrow(BadRequestException);
    expect(tx.unit.create).not.toHaveBeenCalled();
  });

  it("re-validates the payload server-side (e.g. rejects a Unit with no Topics) even though the client-side Zod schema already passed", async () => {
    const { service, tx } = makeService();
    const input = validExtraBookInput({ units: [{ nameEn: "Unit A", nameAr: "أ", sourcePageStart: 1, sourcePageEnd: 5, topics: [] }] });
    await expect(service.confirmExtraBookStructure("subject-1", input)).rejects.toThrow(BadRequestException);
    expect(tx.unit.create).not.toHaveBeenCalled();
  });

  it("J/K/L. never persists groundingNotesJson or teachingStepsJson — those columns are never in either create() call's data", async () => {
    const { service, unitCreateCalls, topicCreateManyCalls } = makeService();
    await service.confirmExtraBookStructure("subject-1", validExtraBookInput());
    expect(unitCreateCalls[0]).not.toHaveProperty("groundingNotesJson");
    expect(topicCreateManyCalls[0][0]).not.toHaveProperty("teachingStepsJson");
  });

  it("manual-structure mode (spec section 11/27): confirming a hand-authored structure NEVER calls TocExtractionService.extract — zero AI calls, zero AIUsage, regardless of whether Analyze was ever used", async () => {
    const { service, tocExtraction } = makeService();
    await service.confirmExtraBookStructure("subject-1", validExtraBookInput());
    expect(tocExtraction.extract).not.toHaveBeenCalled();
    // getPageCount is the only TocExtractionService call this path makes, and it performs no AI call itself (see toc-extraction.service.spec.ts's own "no AI call" assertions for that method).
    expect(tocExtraction.getPageCount).toHaveBeenCalledTimes(1);
  });
});
