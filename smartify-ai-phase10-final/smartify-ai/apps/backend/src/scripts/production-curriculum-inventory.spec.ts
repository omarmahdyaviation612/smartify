import { collectProductionCurriculumInventory } from "./production-curriculum-inventory";

function harness(readOnlyValue: unknown = "on", snapshot: { curricula: any[]; entitlements: any[] } = { curricula: [], entitlements: [] }) {
  const calls: string[] = [];
  let transactionOptions: unknown;
  const tx: any = {
    $executeRawUnsafe: jest.fn(async (sql: string) => { calls.push(`execute:${sql}`); }),
    $queryRawUnsafe: jest.fn(async (sql: string) => {
      calls.push(`raw:${sql}`);
      return sql.includes("current_setting") ? [{ transactionReadOnly: readOnlyValue }] : [];
    }),
    curriculum: { findMany: jest.fn(async () => { calls.push("curriculum.findMany"); return snapshot.curricula; }) },
  };
  const prisma: any = {
    $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>, options?: unknown) => {
      transactionOptions = options;
      return callback(tx);
    }),
    curriculum: { findMany: jest.fn(() => { throw new Error("root Prisma client must not be queried"); }) },
    $queryRawUnsafe: jest.fn(() => { throw new Error("root Prisma client must not be queried"); }),
  };
  const output: string[] = [];
  return { calls, tx, prisma, output, emit: (line: string) => output.push(line), get transactionOptions() { return transactionOptions; }, snapshot };
}

const emptyManifest = { version: 1, books: [], excluded: [] };

describe("production curriculum inventory transaction safety", () => {
  it("sets and verifies read-only mode before inventory reads, all through the transaction client", async () => {
    const h = harness();
    const result = await collectProductionCurriculumInventory({
      prisma: h.prisma,
      emit: h.emit,
      runId: "test-run",
      manifest: emptyManifest,
      now: new Date("2026-10-06T00:00:00.000Z"),
    });

    expect(result.exitCode).toBe(0);
    expect(h.calls.slice(0, 4)).toEqual([
      "execute:SET TRANSACTION READ ONLY",
      "execute:SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
      'raw:SELECT current_setting(\'transaction_read_only\') AS "transactionReadOnly"',
      "curriculum.findMany",
    ]);
    expect(h.prisma.curriculum.findMany).not.toHaveBeenCalled();
    expect(h.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(h.transactionOptions).toEqual({ maxWait: 10_000, timeout: 120_000 });
    expect(h.output.filter((line) => line.startsWith("INVENTORY_START "))).toHaveLength(1);
    expect(h.output.filter((line) => line.startsWith("INVENTORY_SUCCESS "))).toHaveLength(1);
    expect(h.output.filter((line) => line.startsWith("INVENTORY_FAILURE "))).toHaveLength(0);
  });

  it("aborts before inventory reads when read-only mode cannot be verified", async () => {
    const h = harness("off");
    const result = await collectProductionCurriculumInventory({
      prisma: h.prisma,
      emit: h.emit,
      runId: "test-run",
      manifest: emptyManifest,
      now: new Date("2026-10-06T00:00:00.000Z"),
    });

    expect(result.exitCode).not.toBe(0);
    expect(h.tx.curriculum.findMany).not.toHaveBeenCalled();
    expect(h.output.filter((line) => line.startsWith("INVENTORY_FAILURE "))).toHaveLength(1);
    expect(h.output.filter((line) => line.startsWith("INVENTORY_SUCCESS "))).toHaveLength(0);
  });

  it("aborts before database reads when an explicitly requested manifest is unavailable", async () => {
    const h = harness();
    const result = await collectProductionCurriculumInventory({
      prisma: h.prisma,
      emit: h.emit,
      runId: "missing-manifest-run",
      manifest: null,
      manifestState: "NOT_AVAILABLE",
      manifestRequired: true,
      now: new Date("2026-10-06T00:00:00.000Z"),
    });

    expect(result.exitCode).not.toBe(0);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.tx.curriculum.findMany).not.toHaveBeenCalled();
    expect(h.output.filter((line) => line.startsWith("INVENTORY_FAILURE "))).toEqual([
      "INVENTORY_FAILURE missing-manifest-run MANIFEST_NOT_AVAILABLE",
    ]);
    expect(h.output.filter((line) => line.startsWith("INVENTORY_SUCCESS "))).toHaveLength(0);
  });

  it("maps a populated curriculum snapshot and aggregate entitlement counts into the report", async () => {
    const snapshot = {
      curricula: [{
        id: "curriculum-1", code: "EG", nameEn: "Egyptian", nameAr: "مصري", isActive: true,
        grades: [{
          id: "grade-1", level: 1, nameEn: "Grade 1", nameAr: "الصف الأول", isActive: true,
          subjects: [{
            id: "subject-1", nameEn: "Arabic", nameAr: "عربي", isActive: true, sourceFile: "arabic.pdf", priceEGP: 125,
            units: [{
              id: "unit-1", order: 1, nameEn: "Reading", nameAr: "قراءة", sourcePageStart: 1, sourcePageEnd: 12,
              sourceFileOverride: null, groundingNotesJson: { notes: ["grounded"] }, groundingVersion: 2,
              groundingSourceFingerprint: "fingerprint-1", groundingGeneratedAt: null, groundingModel: null,
              groundingPromptVersion: null, contentProvenanceEnforcedAt: null, topics: [{
                id: "topic-1", order: 1, nameEn: "Short vowels", nameAr: "الحركات القصيرة",
                teachingStepsJson: null, generationSource: null,
                groundingSourceFingerprintUsed: null, groundingAssignmentFingerprintUsed: null,
                groundingAssignment: null, topicSourceEvidence: [], questions: [], lessons: [],
                _count: { lessonSessions: 0, quizResults: 0 },
              }],
            }],
          }],
        }],
      }],
      entitlements: [{
        subjectId: "subject-1", grantRows: 3n, activeRows: 2n, expiredRows: 1n,
        matchingProfileScopeRows: 2n, activeMatchingProfileScopeRows: 1n,
      }],
    };
    const h = harness("on", snapshot);
    h.tx.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      h.calls.push(`raw:${sql}`);
      return sql.includes("current_setting") ? [{ transactionReadOnly: "on" }] : snapshot.entitlements;
    });
    const exists = jest.fn(async () => true);

    const result = await collectProductionCurriculumInventory({
      prisma: h.prisma,
      emit: h.emit,
      runId: "populated-run",
      manifest: emptyManifest,
      now: new Date("2026-10-06T00:00:00.000Z"),
      sourceStorage: { exists } as any,
    });

    const line = h.output.find((item) => item.startsWith("INVENTORY_REPORT "));
    const report: any = JSON.parse(line!.slice("INVENTORY_REPORT ".length));
    expect(result.exitCode).toBe(0);
    expect(report.summaries).toMatchObject({
      curricula: 1, grades: 1, subjects: 1, units: 1, groundedUnits: 1,
      topics: 1, unavailableTopics: 1, missingAssignments: 1, missingLessons: 1,
    });
    expect(report.curricula[0].grades[0].subjects[0]).toMatchObject({
      id: "subject-1",
      publication: { activeHierarchy: true },
      pricing: { state: "SET", priceEGP: "125" },
      discoveryAndEntitlement: {
        assignedRows: 3,
        activeEntitlementRows: 2,
        expiredEntitlementRows: 1,
        activeEntitlementRowsInOwningScope: 1,
      },
    });
    expect(report.curricula[0].grades[0].subjects[0].units[0]).toMatchObject({
      id: "unit-1",
      observedState: "PRESENT_IN_DATABASE",
      source: { objectState: "PRESENT", pageRange: { start: 1, end: 12 } },
      grounding: { state: "FINGERPRINT_PRESENT_FRESHNESS_UNKNOWN_SOURCE_BYTES_NOT_READ" },
    });
    expect(report.curricula[0].grades[0].subjects[0].units[0].topics[0]).toMatchObject({
      id: "topic-1",
      assignment: { persisted: false, status: "MISSING", safeReasonCode: "ASSIGNMENT_ROW_MISSING" },
      groundingGate: "MISSING",
      unavailableReasonCode: "ASSIGNMENT_ROW_MISSING",
      lesson: { teachingStepsPresent: false, servable: false },
      questions: { storedNonPlaceholder: 0, provenanceEvaluated: false, runtimeServableCount: 0 },
      unavailableOrStaleDetail: true,
    });
    expect(exists).toHaveBeenCalledTimes(2);
  });

  it("emits one sanitized failure marker for a failed inventory query", async () => {
    const h = harness();
    h.tx.curriculum.findMany.mockRejectedValueOnce(new Error("raw database detail must not escape"));
    const result = await collectProductionCurriculumInventory({
      prisma: h.prisma,
      emit: h.emit,
      runId: "test-run",
      manifest: emptyManifest,
      now: new Date("2026-10-06T00:00:00.000Z"),
    });

    expect(result.exitCode).not.toBe(0);
    expect(h.output.filter((line) => line.startsWith("INVENTORY_FAILURE "))).toHaveLength(1);
    expect(h.output.filter((line) => line.startsWith("INVENTORY_SUCCESS "))).toHaveLength(0);
    expect(h.output.join("\n")).not.toContain("raw database detail");
  });

  it("does not report success when a later transaction read is incomplete", async () => {
    const h = harness();
    h.tx.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      h.calls.push(`raw:${sql}`);
      if (sql.includes("current_setting")) return [{ transactionReadOnly: "on" }];
      throw new Error("private connection detail");
    });
    const result = await collectProductionCurriculumInventory({
      prisma: h.prisma,
      emit: h.emit,
      runId: "test-run",
      manifest: emptyManifest,
      now: new Date("2026-10-06T00:00:00.000Z"),
    });

    expect(result.exitCode).not.toBe(0);
    expect(h.output.filter((line) => line.startsWith("INVENTORY_SUCCESS "))).toHaveLength(0);
    expect(h.output.filter((line) => line.startsWith("INVENTORY_FAILURE "))).toHaveLength(1);
    expect(h.output.join("\n")).not.toContain("private connection detail");
  });
});
