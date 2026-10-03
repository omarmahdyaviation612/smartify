/**
 * REVIEWED grounding assignments (2026-10-04): first-class method, overwrite
 * protection, grounding-change behavior, and the guarded single-Topic admin tool.
 */
import * as fs from "fs";
import * as path from "path";
import { assignmentIdentityMatches, DETERMINISTIC_ASSIGNMENT_VERSION, resolveAssignedGroundingSlice } from "./topic-grounding-assignment.util";
import { ReviewedAssignmentProtectedError, TopicGroundingAssignmentService } from "./topic-grounding-assignment.service";
import { TopicGroundingMapperService } from "./topic-grounding-mapper.service";
import { TopicGroundingRefinementService } from "./topic-grounding-refinement.service";
import { TopicGroundingValidatorService } from "./topic-grounding-validator.service";
import { canServeTopicSteps, classifyContentProvenance, computeAssignmentFingerprint, evaluateTopicGroundingGate, questionServabilityByTopic } from "./topic-content-provenance.util";
import { applyReviewedAssignment, assignmentRowHash, parseManifest, planReviewedAssignment, ReviewedAssignmentError, validateReferences } from "./reviewed-assignment";
import { parseArgs, runReviewedReassignment } from "../../scripts/reassign-reviewed-topic-assignment";
import { runRemediation } from "../../scripts/topic-grounding-remediation";
import { planTopic, runRegeneration } from "../../scripts/regenerate-topic-content";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

const NOTES: GroundingNotes = {
  unitTitle: "Beauty of Difference", gradeLevel: "Grade 5", subject: "Arabic",
  learningObjectives: ["Appreciate diversity."],
  concepts: [
    { name: "Respect for Others", description: "Valuing individual differences.", sourcePages: [1], importance: "core" },
    { name: "Cultural Diversity", description: "Cultures contribute to global beauty.", sourcePages: [2, 3], importance: "core" },
    { name: "Cultural Diversity", description: "Appreciating various cultures.", sourcePages: [4], importance: "core" },
    { name: "Beauty of Diversity", description: "Diversity enhances beauty in the world.", sourcePages: [6], importance: "core" },
    { name: "Friendship", description: "The value of friendship.", sourcePages: [9], importance: "core" },
  ],
  facts: [
    { fact: "Every individual has unique qualities.", sourcePages: [1], importance: "core" },
    { fact: "The beauty of the world is amplified by its diverse cultures.", sourcePages: [4], importance: "core" },
  ],
  vocabulary: [
    { term: "جمال", meaning: "Beauty", sourcePages: [7] },
    { term: "friendship", meaning: "A bond between friends", sourcePages: [9] },
  ],
  skills: [],
  topicHints: [
    { topicTitle: "Understanding Beauty in Diversity", relevantConcepts: ["Beauty of Diversity"], sourcePages: [6, 7] },
    { topicTitle: "Empty Hint", relevantConcepts: [], sourcePages: [50] },
  ],
  scopeNotes: [],
};
const OTHER_UNIT_NOTES: GroundingNotes = { ...NOTES, concepts: [{ name: "Foreign Concept", description: "Another Unit.", sourcePages: [1], importance: "core" }] };
const FP = "fp-current";
const UNIT = { id: "unit-1", groundingVersion: 1, groundingSourceFingerprint: FP, groundingNotesJson: NOTES, contentProvenanceEnforcedAt: null as Date | null };
const UPDATED = new Date("2026-10-03T10:00:00Z");
const MANIFEST = parseManifest({ concepts: [{ name: "Cultural Diversity", occurrences: 2 }, "Beauty of Diversity"], vocabulary: ["جمال"], facts: ["The beauty of the world is amplified by its diverse cultures."], hints: ["Understanding Beauty in Diversity"] });

const mapperRow = (extra: Record<string, unknown> = {}) => ({
  id: "row-1", topicId: "topic-1", unitGroundingVersion: 1, unitSourceFingerprint: FP, assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION, method: "AI_MAPPER", confidence: "HIGH", status: "READY",
  matchedConceptNames: ["Respect for Others"], matchedHintTitles: [], mapperModel: "gpt-4o-mini", mapperPromptVersion: 1, reason: "Compact mapper selected persisted evidence.", updatedAt: UPDATED, ...extra,
});
const reviewedRow = (extra: Record<string, unknown> = {}) => ({
  ...mapperRow(), method: "REVIEWED", mapperModel: null, mapperPromptVersion: null,
  matchedConceptNames: ["Cultural Diversity", "Beauty of Diversity", "جمال"], matchedHintTitles: ["Understanding Beauty in Diversity"], ...extra,
});
function topicWith(assignment: any, extra: Record<string, unknown> = {}): any {
  return {
    id: "topic-1", nameEn: "How Does the World Become More Beautiful?", order: 2, unitId: "unit-1",
    teachingStepsJson: null, groundingSourceFingerprintUsed: null, groundingAssignmentFingerprintUsed: null,
    groundingAssignment: assignment, topicSourceEvidence: [], unit: { ...UNIT }, questions: [], lessons: [], _count: { lessonSessions: 0, quizResults: 0 }, ...extra,
  };
}
const legacyQ = (id: string) => ({ id, topicId: "topic-1", isPlaceholder: false, groundingSourceFingerprint: null, groundingAssignmentFingerprint: null, retiredAt: null, _count: { attempts: 0 } });
const stampedQ = (id: string, prov: any) => ({ ...legacyQ(id), groundingSourceFingerprint: prov.groundingSourceFingerprint, groundingAssignmentFingerprint: prov.groundingAssignmentFingerprint });

/** In-memory transactional store: the callback runs on a clone that replaces the state only if it resolves. */
function txStore(topic: any, hooks: { casCount?: number } = {}) {
  const holder = { s: structuredClone(topic) };
  const api = (s: any) => ({
    topic: { findUnique: async () => structuredClone(s) },
    topicGroundingAssignment: {
      updateMany: async ({ where, data }: any) => {
        const a = s.groundingAssignment;
        const match = a && a.topicId === where.topicId && a.method === where.method && a.status === where.status && new Date(a.updatedAt).getTime() === new Date(where.updatedAt).getTime() && a.unitSourceFingerprint === where.unitSourceFingerprint && a.unitGroundingVersion === where.unitGroundingVersion;
        if (hooks.casCount !== undefined) return { count: hooks.casCount };
        if (!match) return { count: 0 };
        Object.assign(a, data, { updatedAt: new Date("2026-10-04T00:00:00Z") });
        return { count: 1 };
      },
    },
    aIUsage: new Proxy({}, { get: () => { throw new Error("provider accounting touched"); } }),
    aIBudgetReservation: new Proxy({}, { get: () => { throw new Error("budget reservation touched"); } }),
  });
  const prisma = { $transaction: async (fn: any) => { const draft = structuredClone(holder.s); const out = await fn(api(draft)); holder.s = draft; return out; } };
  return { holder, prisma };
}
function dryRunExpect(topic: any) {
  const plan = planReviewedAssignment(topic, MANIFEST);
  return { plan, expect: { rowHash: plan.expectedRowHash, fingerprint: plan.candidate.fingerprint } };
}

describe("1-2: REVIEWED is a first-class method on the normal read path", () => {
  it("1: resolves through the runtime slice resolver, gated by Unit identity only (no algorithm version applies)", () => {
    const row = reviewedRow({ assignmentVersion: 999, mapperPromptVersion: 7 });
    expect(assignmentIdentityMatches(row as any, UNIT)).toBe(true);
    expect(assignmentIdentityMatches(row as any, { ...UNIT, groundingSourceFingerprint: "fp-new" })).toBe(false);
    const r = resolveAssignedGroundingSlice(row as any, UNIT, []);
    expect(r.state).toBe("READY");
    if (r.state !== "READY") return;
    expect(r.slice.concepts.map((c) => c.name)).toEqual(["Cultural Diversity", "Cultural Diversity", "Beauty of Diversity"]);
    expect(r.slice.vocabulary.map((v) => v.term)).toEqual(["جمال"]);
    expect(r.slice.facts.map((f) => f.fact)).toEqual(["The beauty of the world is amplified by its diverse cultures."]);
  });

  it("2: gets the normal assignment fingerprint and participates normally in provenance", () => {
    const topic = topicWith(reviewedRow());
    const gate = evaluateTopicGroundingGate(topic);
    expect(gate.state).toBe("READY");
    if (gate.state !== "READY") return;
    expect(gate.provenance.groundingAssignmentFingerprint).toBe(computeAssignmentFingerprint(UNIT, reviewedRow() as any, gate.slice));
    expect(gate.provenance.groundingAssignmentFingerprint.startsWith("tga1:")).toBe(true);
    const asKeyword = evaluateTopicGroundingGate(topicWith(reviewedRow({ method: "KEYWORD_OVERLAP" })));
    expect(asKeyword.state === "READY" && asKeyword.provenance.groundingAssignmentFingerprint).not.toBe(gate.provenance.groundingAssignmentFingerprint);
    expect(classifyContentProvenance(stampedQ("q", gate.provenance), gate.provenance)).toBe("CURRENT");
  });
});

describe("3-5: protection from automatic recomputation", () => {
  function service(topicRow: any, opts: { upsertError?: any } = {}) {
    const upsert = jest.fn(async () => { if (opts.upsertError) throw opts.upsertError; return {}; });
    const prisma = { client: { topic: { findUnique: jest.fn().mockResolvedValue(topicRow) }, topicGroundingAssignment: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue({ method: "REVIEWED" }), upsert } } } as any;
    return { svc: new TopicGroundingAssignmentService(prisma), upsert, prisma };
  }
  const prepTopic = (assignment: any, unit: any = UNIT, nameEn = "Beauty of Diversity") => ({
    id: "topic-1", nameEn, order: 2, groundingAssignment: assignment, topicSourceEvidence: [],
    unit: { ...unit, sourcePageStart: 1, sourcePageEnd: 50, topics: [{ id: "topic-0", nameEn: "Respect", order: 1 }, { id: "topic-1", nameEn, order: 2 }] },
  });

  it("3: deterministic preparation (even with a title Steps 1-5 would resolve, and after a deterministic version bump) leaves a valid REVIEWED row untouched", async () => {
    for (const row of [reviewedRow(), reviewedRow({ assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION - 1 })]) {
      const { svc, upsert } = service(prepTopic(row));
      expect(await svc.assignGroundingForTopic("topic-1")).toEqual({ outcome: "UNCHANGED", method: "REVIEWED", status: "READY" });
      expect(upsert).not.toHaveBeenCalled();
    }
  });

  it("3b: the write path itself refuses any non-REVIEWED overwrite of a REVIEWED row", async () => {
    const { svc, upsert } = service(prepTopic(reviewedRow()), { upsertError: Object.assign(new Error("Unique constraint"), { code: "P2002" }) });
    await expect(svc.upsert({ topicId: "topic-1", unitGroundingVersion: 1, unitSourceFingerprint: FP, method: "KEYWORD_OVERLAP", confidence: "HIGH", status: "READY", matchedConceptNames: ["Friendship"], matchedHintTitles: null })).rejects.toBeInstanceOf(ReviewedAssignmentProtectedError);
    expect((upsert.mock.calls[0] as any)[0].where).toEqual({ topicId: "topic-1", method: { not: "REVIEWED" } });
  });

  it("4: the mapper, refinement and validator never run for a REVIEWED row (no provider, no write) — whatever the mapper prompt version", async () => {
    const provider = { getActiveProvider: jest.fn(() => { throw new Error("provider called"); }) } as any;
    const usage = { reserveBudget: jest.fn() } as any;
    const assignment = { upsert: jest.fn() } as any;
    const topic = { ...prepTopic(reviewedRow({ mapperPromptVersion: 99 })), groundingAssignment: reviewedRow({ mapperPromptVersion: 99 }) };
    const prisma = { client: { topic: { findUnique: jest.fn().mockResolvedValue(topic) } } } as any;
    expect((await new TopicGroundingMapperService(prisma, provider, usage, assignment).mapTopic("topic-1")).outcome).toBe("SKIPPED_REVIEWED");
    expect((await new TopicGroundingRefinementService(prisma, provider, usage, assignment).refineCoarseGrounding("topic-1")).outcome).toBe("SKIPPED_REVIEWED");
    expect((await new TopicGroundingValidatorService(prisma, provider, usage, assignment).validateCandidate("topic-1")).outcome).toBe("SKIPPED_REVIEWED");
    expect(provider.getActiveProvider).not.toHaveBeenCalled();
    expect(usage.reserveBudget).not.toHaveBeenCalled();
    expect(assignment.upsert).not.toHaveBeenCalled();
  });

  it("4b: remediation re-validates a stale REVIEWED row only through the assignment service — never the mapper or source extraction", async () => {
    const topic = { ...prepTopic(reviewedRow({ unitSourceFingerprint: "fp-old" })), order: 2, unit: { ...prepTopic(null).unit, subject: { sourceFile: "x.pdf", grade: { level: 5, curriculum: { code: "EG" } } } } };
    const deps = {
      prisma: { client: { topic: { findMany: jest.fn().mockResolvedValue([topic]) } } },
      assignment: { assignGroundingForTopic: jest.fn().mockResolvedValue({ outcome: "ASSIGNED", method: "REVIEWED", status: "READY" }), upsert: jest.fn() },
      mapper: { mapTopic: jest.fn() }, sourceEvidence: { getReusable: jest.fn(), prepareTopicEvidence: jest.fn() }, activeModel: jest.fn(),
    };
    const report = await runRemediation({ topicIds: ["topic-1"], sourceWindows: new Map([["topic-1", { start: 1, end: 5 }]]), apply: true }, deps as any);
    expect(report.topics[0]).toMatchObject({ path: "REVIEWED", after: "READY" });
    expect(deps.assignment.assignGroundingForTopic).toHaveBeenCalledTimes(1);
    expect(deps.mapper.mapTopic).not.toHaveBeenCalled();
    expect(deps.sourceEvidence.prepareTopicEvidence).not.toHaveBeenCalled();
    expect(deps.activeModel).not.toHaveBeenCalled();
  });

  it("5: after a grounding identity change, reviewed evidence that no longer resolves is persisted BLOCKED (still REVIEWED), never READY and never remapped", async () => {
    const regrounded = { ...UNIT, groundingSourceFingerprint: "fp-new", groundingNotesJson: { ...NOTES, concepts: NOTES.concepts.filter((c) => c.name !== "Beauty of Diversity") } };
    const { svc, upsert } = service(prepTopic(reviewedRow(), regrounded));
    expect((await svc.assignGroundingForTopic("topic-1")).outcome).toBe("REVIEWED_INVALIDATED");
    const write = (upsert.mock.calls[0] as any)[0];
    expect(write.update).toMatchObject({ method: "REVIEWED", status: "BLOCKED", unitSourceFingerprint: "fp-new" });
    expect(write.update.reason).toMatch(/^\[REVIEWED:INVALIDATED\].*Beauty of Diversity/);
    // and the read path never treats a partly-resolving reviewed row as READY
    expect(resolveAssignedGroundingSlice(reviewedRow({ unitSourceFingerprint: "fp-new" }) as any, regrounded, []).state).toBe("STALE");
  });

  it("5b: after a grounding identity change, reviewed evidence that still resolves exactly is re-stamped (same references, still REVIEWED)", async () => {
    const regrounded = { ...UNIT, groundingSourceFingerprint: "fp-new" };
    const { svc, upsert } = service(prepTopic(reviewedRow(), regrounded));
    expect(await svc.assignGroundingForTopic("topic-1")).toEqual({ outcome: "ASSIGNED", method: "REVIEWED", status: "READY" });
    expect((upsert.mock.calls[0] as any)[0].update).toMatchObject({ method: "REVIEWED", status: "READY", unitSourceFingerprint: "fp-new", matchedConceptNames: reviewedRow().matchedConceptNames });
  });

  it("5c: a same-identity READY REVIEWED row whose references stopped resolving is invalidated, and a BLOCKED one is left for re-review", async () => {
    const broken = reviewedRow({ matchedConceptNames: ["Not In Grounding"] });
    const a = service(prepTopic(broken));
    expect((await a.svc.assignGroundingForTopic("topic-1")).outcome).toBe("REVIEWED_INVALIDATED");
    const b = service(prepTopic(reviewedRow({ status: "BLOCKED" })));
    expect(await b.svc.assignGroundingForTopic("topic-1")).toEqual({ outcome: "UNCHANGED", method: "REVIEWED", status: "BLOCKED" });
    expect(b.upsert).not.toHaveBeenCalled();
  });
});

describe("6-7: content safety", () => {
  it("6: a direct reviewed flip is allowed with no CURRENT content; LEGACY content stays LEGACY", async () => {
    const topic = topicWith(mapperRow(), { teachingStepsJson: [{ id: "s1" }], questions: [legacyQ("q1"), legacyQ("q2")] });
    const { plan, expect: ex } = dryRunExpect(topic);
    expect(plan.content).toMatchObject({ stepsBefore: "LEGACY", stepsAfter: "LEGACY", questionsAfter: { CURRENT: 0, LEGACY: 2 } });
    const st = txStore(topic);
    const out = await applyReviewedAssignment(st.prisma, "topic-1", MANIFEST, ex);
    expect(out).toMatchObject({ method: "REVIEWED", previousMethod: "AI_MAPPER", fingerprint: ex.fingerprint });
    expect(st.holder.s.groundingAssignment).toMatchObject({ method: "REVIEWED", status: "READY", matchedConceptNames: ["Cultural Diversity", "Beauty of Diversity", "جمال", "The beauty of the world is amplified by its diverse cultures."], matchedHintTitles: ["Understanding Beauty in Diversity"] });
    expect(canServeTopicSteps(st.holder.s)).toBe(true); // LEGACY steps, TRANSITION Unit
  });

  it("7: a direct reviewed flip is refused when CURRENT content exists (steps or any Question)", () => {
    const gate: any = evaluateTopicGroundingGate(topicWith(mapperRow()));
    const steps = topicWith(mapperRow(), { teachingStepsJson: [{ id: "s1" }], groundingSourceFingerprintUsed: gate.provenance.groundingSourceFingerprint, groundingAssignmentFingerprintUsed: gate.provenance.groundingAssignmentFingerprint });
    const oneQ = topicWith(mapperRow(), { questions: [legacyQ("q1"), stampedQ("q2", gate.provenance)] });
    for (const t of [steps, oneQ]) expect(() => planReviewedAssignment(t, MANIFEST)).toThrow(/CURRENT_CONTENT_REQUIRES_STAGED_FLIP/);
  });

  it("7b: any student activity refuses the reassignment", () => {
    expect(() => planReviewedAssignment(topicWith(mapperRow(), { _count: { lessonSessions: 1, quizResults: 0 } }), MANIFEST)).toThrow(/ACTIVITY/);
    expect(() => planReviewedAssignment(topicWith(mapperRow(), { questions: [{ ...legacyQ("q1"), _count: { attempts: 2 } }] }), MANIFEST)).toThrow(/ACTIVITY/);
  });
});

describe("8-9: explicit, dry-run-by-default tool", () => {
  it("8: dry-run is the default and never opens a write transaction", async () => {
    const args = parseArgs(["--topicId=cmucxcvrg017r2qd5sqbruixe", "--evidence=m.json"]);
    expect(args.apply).toBe(false);
    const transaction = { $transaction: jest.fn() };
    const out = await runReviewedReassignment(args, MANIFEST, { loadTopic: async () => topicWith(mapperRow()), transaction });
    expect(out.mode).toBe("DRY_RUN");
    expect(transaction.$transaction).not.toHaveBeenCalled();
  });

  it("9: --apply requires the dry-run CAS values; exactly one Topic per invocation", () => {
    expect(() => parseArgs(["--topicId=cmucxcvrg017r2qd5sqbruixe", "--evidence=m.json", "--apply"])).toThrow(/requires --expectRow/);
    expect(() => parseArgs(["--topicId=cmucxcvrg017r2qd5sqbruixe", "--evidence=m.json", "--expectRow=x"])).toThrow(/only valid with --apply/);
    expect(() => parseArgs(["--topicId=cmucxcvrg017r2qd5sqbruixe", "--topicId=cmucxcwwu01of2qd5umy4uouw", "--evidence=m.json"])).toThrow(/exactly once/);
    expect(() => parseArgs(["--topicId=cmucxcvrg017r2qd5sqbruixe,cmucxcwwu01of2qd5umy4uouw", "--evidence=m.json"])).toThrow(/malformed/);
    expect(() => parseArgs(["--evidence=m.json"])).toThrow(/--topicId/);
    expect(parseArgs(["--topicId=cmucxcvrg017r2qd5sqbruixe", "--evidence=m.json", "--apply", "--expectRow=abc", "--expectFingerprint=tga1:x"])).toMatchObject({ apply: true, expectRow: "abc", expectFingerprint: "tga1:x" });
  });
});

describe("10-12: evidence must be exact, from this Unit, and non-empty", () => {
  const errs = (m: any) => validateReferences(NOTES, parseManifest(m)).errors;
  it("10: exact existence, uniqueness and unambiguous resolution", () => {
    expect(errs({ concepts: ["Beauty of Diversity"] })).toEqual([]);
    expect(errs({ concepts: ["beauty of diversity"] })[0]).toMatch(/^NOT_FOUND/);
    expect(errs({ concepts: ["Beauty of Diversity "] })[0]).toMatch(/^NOT_FOUND/);
    expect(errs({ concepts: ["Cultural Diversity"] })[0]).toMatch(/^AMBIGUOUS_DUPLICATE .* occurs 2x/);
    expect(errs({ concepts: [{ name: "Cultural Diversity", occurrences: 2 }] })).toEqual([]);
    expect(errs({ concepts: ["Friendship"] })[0]).toMatch(/^AMBIGUOUS_POOL .* vocabulary/);
    expect(errs({ concepts: ["Beauty of Diversity", "Beauty of Diversity"] })[0]).toMatch(/^DUPLICATE_REFERENCE/);
    expect(() => parseManifest({ concepts: ["x"], pages: [1] })).toThrow(/unknown manifest key/);
    expect(() => parseManifest({ concepts: [""] })).toThrow(/invalid/);
  });

  it("11: evidence from another Unit is refused; a Topic/Unit mismatch is refused", () => {
    expect(validateReferences(OTHER_UNIT_NOTES, parseManifest({ concepts: ["Beauty of Diversity"] })).errors[0]).toMatch(/^NOT_FOUND/);
    expect(() => planReviewedAssignment(topicWith(mapperRow()), parseManifest({ concepts: ["Foreign Concept"] }))).toThrow(ReviewedAssignmentError);
    expect(() => planReviewedAssignment(topicWith(mapperRow(), { unitId: "unit-2" }), MANIFEST)).toThrow(/^UNIT/);
  });

  it("12: an empty selection or an empty resolved slice is refused", () => {
    expect(() => parseManifest({})).toThrow(/selects nothing/);
    expect(() => parseManifest({ concepts: [] })).toThrow(/selects nothing/);
    expect(() => planReviewedAssignment(topicWith(mapperRow()), parseManifest({ hints: ["Empty Hint"] }))).toThrow(/CANDIDATE_NOT_READY/);
  });
});

describe("13-15: atomic apply, zero provider calls, normal authoring afterwards", () => {
  it("13: CAS failures roll back and write nothing", async () => {
    const topic = topicWith(mapperRow());
    const { expect: ex } = dryRunExpect(topic);
    const changedRow = txStore(topicWith(mapperRow({ updatedAt: new Date("2026-10-03T11:00:00Z") })));
    await expect(applyReviewedAssignment(changedRow.prisma, "topic-1", MANIFEST, ex)).rejects.toThrow(/CAS_ROW_CHANGED/);
    expect(changedRow.holder.s.groundingAssignment.method).toBe("AI_MAPPER");
    const raced = txStore(topic, { casCount: 0 });
    await expect(applyReviewedAssignment(raced.prisma, "topic-1", MANIFEST, ex)).rejects.toThrow(/CAS_CONFLICT/);
    expect(raced.holder.s.groundingAssignment).toEqual(topic.groundingAssignment);
    const otherCandidate = txStore(topic);
    await expect(applyReviewedAssignment(otherCandidate.prisma, "topic-1", MANIFEST, { ...ex, fingerprint: "tga1:other" })).rejects.toThrow(/CAS_CANDIDATE_CHANGED/);
    expect(otherCandidate.holder.s.groundingAssignment.method).toBe("AI_MAPPER");
    expect(ex.rowHash).toBe(assignmentRowHash(topic.groundingAssignment));
  });

  it("14: no provider call during reassignment (no provider import; accounting tables never touched)", async () => {
    for (const f of ["reviewed-assignment.ts", "../../scripts/reassign-reviewed-topic-assignment.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, f), "utf8");
      expect(src).not.toMatch(/ai-provider|AIProviderFactory|AIUsageService|usage\//);
    }
    const st = txStore(topicWith(mapperRow()));
    await expect(applyReviewedAssignment(st.prisma, "topic-1", MANIFEST, dryRunExpect(topicWith(mapperRow())).expect)).resolves.toMatchObject({ method: "REVIEWED" });
  });

  it("15: normal content authoring then works against the REVIEWED assignment and its content is CURRENT/servable", async () => {
    const topic = topicWith(mapperRow(), { teachingStepsJson: [{ id: "legacy" }], questions: [legacyQ("old-1")] });
    const st = txStore(topic);
    await applyReviewedAssignment(st.prisma, "topic-1", MANIFEST, dryRunExpect(topic).expect);
    const reviewed = st.holder.s;
    expect(planTopic(reviewed, { lesson: true, questions: true })).toMatchObject({ gate: "READY", steps: "LEGACY", lessonAction: "REGENERATE", questionsToGenerate: 8 });
    let live = structuredClone(reviewed);
    const deps = {
      loadTopic: async () => structuredClone(live),
      regenerateLesson: async (t: any) => { const g: any = evaluateTopicGroundingGate(t); live.teachingStepsJson = [{ id: "new" }]; live.groundingSourceFingerprintUsed = g.provenance.groundingSourceFingerprint; live.groundingAssignmentFingerprintUsed = g.provenance.groundingAssignmentFingerprint; },
      generateQuestions: async (_id: string, n: number) => { const g: any = evaluateTopicGroundingGate(live); for (let i = 0; i < n; i++) live.questions.push(stampedQ(`new-${i}`, g.provenance)); return n; },
    };
    const out = await runRegeneration({ topicIds: ["topic-1"], apply: true, lesson: true, questions: true }, deps);
    expect(out.results[0]).toMatchObject({ status: "COMPLETED", final: { steps: "CURRENT", currentQuestions: 8 } });
    expect(canServeTopicSteps(live)).toBe(true);
    const servable = questionServabilityByTopic([live], live.questions);
    expect(live.questions.filter((q: any) => servable(q)).map((q: any) => q.id)).toEqual(live.questions.filter((q: any) => q.id.startsWith("new-")).map((q: any) => q.id));
  });
});
