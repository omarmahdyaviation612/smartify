import { applyOne, dryRunOne, loadScopedTopics, EXCLUDED_SUBJECT_ID, ProviderOutageError, type BackfillReport } from "./prepare-topic-grounding-assignments";

function emptyReport(): BackfillReport {
  return {
    totalTopics: 0,
    eligibleTopics: 0,
    excludedY6English: 0,
    alreadyReady: {},
    deterministicAssigned: {},
    aiMapperRequired: 0,
    aiMapperReady: 0,
    aiMapperBlocked: 0,
    blockedByGrounding: 0,
    staleRecomputed: 0,
    skippedIdempotent: 0,
    failures: [],
    providerCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    actualCostUsd: 0,
  };
}

const NOTES = {
  unitTitle: "Addition",
  subject: "Mathematics",
  gradeLevel: "Grade 2",
  learningObjectives: [],
  concepts: [{ name: "Carrying", description: "d", sourcePages: [10] }],
  facts: [],
  vocabulary: [],
  topicHints: [{ topicTitle: "Carrying Numbers", sourcePages: [10], relevantConcepts: ["Carrying"] }],
} as any;

function makeTopic(overrides: Partial<any> = {}) {
  return {
    id: "topic-1",
    nameEn: "Carrying Numbers",
    order: 1,
    teachingStepsJson: null,
    unit: {
      id: "unit-1",
      subjectId: "subject-1",
      groundingNotesJson: NOTES,
      groundingVersion: 1,
      groundingSourceFingerprint: "fp-1",
      topics: [{ id: "topic-1", nameEn: "Carrying Numbers", order: 1 }],
    },
    groundingAssignment: null,
    ...overrides,
  };
}

describe("dryRunOne — pure classification, zero writes/provider calls by construction (no service params at all)", () => {
  it("an ungrounded Unit's Topic is BLOCKED_BY_GROUNDING", () => {
    const report = emptyReport();
    dryRunOne(makeTopic({ unit: { ...makeTopic().unit, groundingNotesJson: null, groundingVersion: null, groundingSourceFingerprint: null } }), report);
    expect(report.blockedByGrounding).toBe(1);
  });

  it("an existing valid READY row is counted under alreadyReady by its method, not reprocessed", () => {
    const report = emptyReport();
    dryRunOne(makeTopic({ groundingAssignment: { unitGroundingVersion: 1, unitSourceFingerprint: "fp-1", assignmentVersion: 1, method: "HINT_MATCH", status: "READY" } }), report);
    expect(report.alreadyReady["HINT_MATCH"]).toBe(1);
    expect(Object.keys(report.deterministicAssigned)).toHaveLength(0);
  });

  it("a stale-identity row (fingerprint mismatch) is recomputed and counted as staleRecomputed, deterministically resolvable here", () => {
    const report = emptyReport();
    dryRunOne(makeTopic({ groundingAssignment: { unitGroundingVersion: 1, unitSourceFingerprint: "OLD-fp", assignmentVersion: 1, method: "HINT_MATCH", status: "READY" } }), report);
    expect(report.staleRecomputed).toBe(1);
    expect(report.deterministicAssigned["HINT_MATCH"]).toBe(1);
  });

  it("a missing row that deterministic Steps 1-5 cannot resolve counts as aiMapperRequired", () => {
    const report = emptyReport();
    dryRunOne(makeTopic({ nameEn: "Some Unmatched Title", unit: { ...makeTopic().unit, topics: [{ id: "topic-1", nameEn: "Some Unmatched Title", order: 1 }, { id: "topic-2", nameEn: "Other Topic", order: 2 }] }, groundingNotesJson: NOTES }), report);
    expect(report.aiMapperRequired).toBe(1);
  });
});

describe("applyOne — delegates ALL persistence/provider decisions to the injected services", () => {
  function fakeAssignmentService(outcome: any) {
    return { assignGroundingForTopic: jest.fn().mockResolvedValue(outcome) } as any;
  }
  function fakeMapperService(outcome?: any) {
    return { mapTopic: jest.fn().mockResolvedValue(outcome) } as any;
  }

  it("NOT_GROUNDED outcome is reported BLOCKED_BY_GROUNDING and the mapper is never called", async () => {
    const report = emptyReport();
    const assignmentService = fakeAssignmentService({ outcome: "NOT_GROUNDED", reason: "no grounding" });
    const mapperService = fakeMapperService();
    await applyOne(makeTopic(), assignmentService, mapperService, report);
    expect(report.blockedByGrounding).toBe(1);
    expect(mapperService.mapTopic).not.toHaveBeenCalled();
  });

  it("UNCHANGED (idempotent) outcome makes zero further calls and is counted once, not reprocessed", async () => {
    const report = emptyReport();
    const assignmentService = fakeAssignmentService({ outcome: "UNCHANGED", method: "KEYWORD_OVERLAP", status: "READY" });
    const mapperService = fakeMapperService();
    await applyOne(makeTopic(), assignmentService, mapperService, report);
    expect(report.skippedIdempotent).toBe(1);
    expect(report.alreadyReady["KEYWORD_OVERLAP"]).toBe(1);
    expect(mapperService.mapTopic).not.toHaveBeenCalled();
  });

  it("ASSIGNED (deterministic) outcome writes zero provider calls — the mapper is never invoked", async () => {
    const report = emptyReport();
    const assignmentService = fakeAssignmentService({ outcome: "ASSIGNED", method: "HINT_MATCH", status: "READY" });
    const mapperService = fakeMapperService();
    await applyOne(makeTopic(), assignmentService, mapperService, report);
    expect(report.deterministicAssigned["HINT_MATCH"]).toBe(1);
    expect(mapperService.mapTopic).not.toHaveBeenCalled();
    expect(report.providerCalls).toBe(0);
  });

  it("UNRESOLVED outcome is the ONLY case that invokes the mapper", async () => {
    const report = emptyReport();
    const assignmentService = fakeAssignmentService({ outcome: "UNRESOLVED", reason: "nothing matched" });
    const mapperService = fakeMapperService({ outcome: "READY", matchedConceptNames: ["Carrying"], matchedHintTitles: null, model: "gpt-4o-mini" });
    await applyOne(makeTopic(), assignmentService, mapperService, report);
    expect(mapperService.mapTopic).toHaveBeenCalledTimes(1);
    expect(report.aiMapperReady).toBe(1);
    expect(report.providerCalls).toBe(1);
  });

  it("a LOW-confidence/validation-rejected mapper result is counted BLOCKED, never as a usable assignment", async () => {
    const report = emptyReport();
    const assignmentService = fakeAssignmentService({ outcome: "UNRESOLVED", reason: "nothing matched" });
    const mapperService = fakeMapperService({ outcome: "BLOCKED", reason: "LOW confidence" });
    await applyOne(makeTopic(), assignmentService, mapperService, report);
    expect(report.aiMapperBlocked).toBe(1);
    expect(report.aiMapperReady).toBe(0);
  });

  it("a mapper provider-quota-outage throws ProviderOutageError — the failure is never silently absorbed into a per-Topic BLOCKED count", async () => {
    const report = emptyReport();
    const assignmentService = fakeAssignmentService({ outcome: "UNRESOLVED", reason: "nothing matched" });
    const quotaErr = Object.assign(new Error("insufficient_quota"), { code: "insufficient_quota" });
    const mapperService = { mapTopic: jest.fn().mockRejectedValue(quotaErr) } as any;
    await expect(applyOne(makeTopic(), assignmentService, mapperService, report)).rejects.toBeInstanceOf(ProviderOutageError);
    expect(report.aiMapperBlocked).toBe(0);
    expect(report.failures).toHaveLength(0);
  });

  it("a non-outage mapper error is recorded as a failure, not thrown, so one bad Topic never halts the whole run", async () => {
    const report = emptyReport();
    const assignmentService = fakeAssignmentService({ outcome: "UNRESOLVED", reason: "nothing matched" });
    const mapperService = { mapTopic: jest.fn().mockRejectedValue(new Error("transient network blip")) } as any;
    await applyOne(makeTopic(), assignmentService, mapperService, report);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].topicId).toBe("topic-1");
  });
});

describe("ProviderOutageError", () => {
  it("carries the topicId and reason for operator diagnosis", () => {
    const err = new ProviderOutageError("topic-99", "provider_quota_exhausted");
    expect(err.topicId).toBe("topic-99");
    expect(err.reason).toBe("provider_quota_exhausted");
    expect(err.message).toContain("topic-99");
  });
});

describe("loadScopedTopics — scope flags can never bypass the Y6 English exclusion", () => {
  function fakePrisma(topics: any[]) {
    return {
      client: {
        topic: {
          count: jest.fn().mockResolvedValue(topics.length),
          findMany: jest.fn(({ where }: any) => {
            return Promise.resolve(
              topics.filter((t) => {
                if (where.id && t.id !== where.id) return false;
                if (where.unitId && t.unit.id !== where.unitId) return false;
                const subjectId = where.unit?.subjectId?.not !== undefined ? undefined : where.unit?.subjectId;
                if (subjectId !== undefined && t.unit.subjectId !== subjectId) return false;
                if (where.unit?.subjectId?.not !== undefined && t.unit.subjectId === where.unit.subjectId.not) return false;
                return true;
              }),
            );
          }),
        },
      },
    } as any;
  }

  it("default scope (no flags) excludes every Y6 English Topic via the unconditional where clause", async () => {
    const topics = [makeTopic({ id: "t1" }), makeTopic({ id: "t2", unit: { ...makeTopic().unit, subjectId: EXCLUDED_SUBJECT_ID } })];
    const { all } = await loadScopedTopics(fakePrisma(topics), {});
    expect(all.map((t: any) => t.id)).toEqual(["t1"]);
  });

  it("--subjectId=<the excluded Y6 English subject> returns an EMPTY scope rather than including it", async () => {
    const topics = [makeTopic({ id: "t1", unit: { ...makeTopic().unit, subjectId: EXCLUDED_SUBJECT_ID } })];
    const { all } = await loadScopedTopics(fakePrisma(topics), { subjectId: EXCLUDED_SUBJECT_ID });
    expect(all).toHaveLength(0);
  });

  it("--topicId scoping still excludes Y6 English if that Topic happens to belong to it", async () => {
    const topics = [makeTopic({ id: "t1", unit: { ...makeTopic().unit, subjectId: EXCLUDED_SUBJECT_ID } })];
    const { all } = await loadScopedTopics(fakePrisma(topics), { topicId: "t1" });
    expect(all).toHaveLength(0);
  });
});
