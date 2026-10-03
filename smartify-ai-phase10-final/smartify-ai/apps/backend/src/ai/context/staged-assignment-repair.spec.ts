/**
 * STAGED REGENERATION + ATOMIC ASSIGNMENT FLIP — regression suite (2026-10-03).
 * An in-memory store whose $transaction runs on a deep copy and commits only
 * on success gives real rollback semantics; student paths use the REAL
 * Practice/Quiz/Question-generator services over that store.
 */
import { PracticeService } from "../../practice/practice.service";
import { QuizzesService } from "../../quizzes/quizzes.service";
import { QuestionDraftGeneratorService } from "../../question-bank/question-draft-generator/question-draft-generator.service";
import { LessonDraftGeneratorService } from "../../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import { discoverStagedLeftovers, flipStagedReplacement, planStagedRepair, stageReplacement, StagedRepairError, type StageDeps, type StagedRepairPlan } from "./staged-assignment-repair";
import { runStagedRepair, scopeFromPlan, parseArgs, verifyCommitted } from "../../scripts/repair-sole-topic-staged";
import { canServeTopicSteps, classifyContentProvenance, evaluateTopicGroundingGate, questionServabilityByTopic } from "./topic-content-provenance.util";
import { DETERMINISTIC_ASSIGNMENT_VERSION } from "./topic-grounding-assignment.util";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

const TOPIC = "topic-earth", UNIT = "unit-earth", SUBJECT = "subject-sci";
const NOTES: GroundingNotes = {
  unitTitle: "Planet Earth", gradeLevel: "Year 1", subject: "Science",
  learningObjectives: ["Identify bodies of water.", "Identify rocks."],
  concepts: [
    { name: "Types of Water Bodies", description: "Oceans, lakes and rivers differ.", sourcePages: [1, 2], importance: "core" },
    { name: "Types of Rocks", description: "There are many kinds of rocks.", sourcePages: [5], importance: "core" },
    { name: "Components of Earth", description: "Earth is made up of soil, rocks and water.", sourcePages: [7], importance: "core" },
  ],
  facts: [{ fact: "Most of the planet is covered in water.", sourcePages: [1], importance: "core" }, { fact: "Soil holds water for plants.", sourcePages: [9], importance: "core" }],
  vocabulary: [{ term: "ocean", meaning: "A very large area of salt water.", sourcePages: [1] }, { term: "geologist", meaning: "A scientist who studies rocks.", sourcePages: [8] }],
  skills: [], topicHints: [], scopeNotes: [],
};
const FP = "fp-unit-earth";
const OLD_UPDATED = new Date("2026-10-02T14:01:12.887Z");
const QV = { type: "MULTIPLE_CHOICE", difficulty: "EASY", promptAr: "سؤال", optionsJson: ["a", "b", "c"], correctAnswerJson: "a", explanationEn: "because", explanationAr: "لأن" };

type State = any;
function freshState(opts: { strict?: boolean } = {}): State {
  const unit = { id: UNIT, subjectId: SUBJECT, nameEn: "Planet Earth", groundingVersion: 1, groundingSourceFingerprint: FP, groundingNotesJson: NOTES, sourcePageStart: 1, sourcePageEnd: 9, sourceFileOverride: null, contentProvenanceEnforcedAt: opts.strict === false ? null : new Date("2026-10-02T20:00:00Z"), subject: { nameEn: "Science", sourceFile: "eg/y1/science.pdf", grade: { nameEn: "Year 1", curriculum: { nameEn: "EG" } } } };
  const assignment = { topicId: TOPIC, unitGroundingVersion: 1, unitSourceFingerprint: FP, assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION, method: "KEYWORD_OVERLAP", confidence: "HIGH", status: "READY", matchedConceptNames: ["Components of Earth"], matchedHintTitles: null, mapperModel: null, mapperPromptVersion: null, reason: "keyword", updatedAt: OLD_UPDATED };
  const s: State = { unit, assignment, topic: { id: TOPIC, unitId: UNIT, nameEn: "Planet Earth", nameAr: "كوكب الأرض", order: 1, teachingStepsJson: [{ id: "old1", type: "INTRO", order: 1, objective: "old" }], generationSource: "TEXTBOOK_GROUNDED", groundingSourceFingerprintUsed: null, groundingAssignmentFingerprintUsed: null }, lessons: [{ id: "lesson-old", topicId: TOPIC, isAiGenerated: true, isPlaceholder: false, nameEn: "Planet Earth", nameAr: "كوكب الأرض" }], objectives: [{ id: "obj-old", lessonId: "lesson-old", descriptionEn: "old objective" }], lessonDrafts: [{ id: "ld-old", status: "published", publishedTopicId: TOPIC, targetUnitId: UNIT }], questionDrafts: [] as any[], questions: [] as any[], extraTopics: [] as any[], seq: 0 };
  const oldProv = evaluateTopicGroundingGate(view(s) as any);
  if (oldProv.state !== "READY") throw new Error("fixture");
  s.topic.groundingSourceFingerprintUsed = oldProv.provenance.groundingSourceFingerprint;
  s.topic.groundingAssignmentFingerprintUsed = oldProv.provenance.groundingAssignmentFingerprint;
  for (let i = 0; i < 8; i++) { s.questionDrafts.push({ id: `qd-old-${i}`, topicId: TOPIC, status: "published", publishedQuestionId: `q-old-cur-${i}`, ...QV, promptEn: `Old current ${i}`, ...oldProv.provenance }); s.questions.push({ id: `q-old-cur-${i}`, topicId: TOPIC, isPlaceholder: false, ...QV, promptEn: `Old current ${i}`, ...oldProv.provenance }); }
  for (let i = 0; i < 7; i++) s.questions.push({ id: `q-legacy-${i}`, topicId: TOPIC, isPlaceholder: false, ...QV, promptEn: `Legacy ${i}`, groundingSourceFingerprint: null, groundingAssignmentFingerprint: null });
  return s;
}
/** The Topic as live student/admin code sees it. */
function view(s: State) {
  return { ...s.topic, groundingAssignment: s.assignment ? { ...s.assignment } : null, topicSourceEvidence: [], questions: s.questions.filter((q: any) => q.topicId === TOPIC), unit: { ...s.unit, topics: [{ id: TOPIC, nameEn: s.topic.nameEn, order: 1 }, ...s.extraTopics] } };
}
const clone = (x: any) => structuredClone(x);
// Dates compared by timestamp: structuredClone yields Dates from another realm under jest.
const isDate = (x: any) => Object.prototype.toString.call(x) === "[object Date]";
const match = (row: any, where: any) => Object.entries(where).every(([k, v]: any) => (isDate(v) ? isDate(row[k]) && row[k].getTime() === v.getTime() : v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v));

/** Prisma-shaped in-memory store. */
function store(state: { s: State }, hooks: { failOnQuestionCreate?: number } = {}) {
  const api = (s: State) => ({
    unit: { findUnique: async () => ({ ...clone(s.unit), topics: [{ id: TOPIC }, ...s.extraTopics.map((t: any) => ({ id: t.id }))] }) },
    topic: {
      findUnique: async () => clone(view(s)),
      findUniqueOrThrow: async () => clone(view(s)),
      update: async ({ data }: any) => { Object.assign(s.topic, clone(data)); return clone(s.topic); },
    },
    topicGroundingAssignment: { updateMany: async ({ where, data }: any) => { if (!s.assignment || !match(s.assignment, where)) return { count: 0 }; Object.assign(s.assignment, clone(data), { updatedAt: new Date() }); return { count: 1 }; } },
    lessonDraft: {
      findUnique: async ({ where }: any) => clone(s.lessonDrafts.find((d: any) => d.id === where.id) ?? null),
      updateMany: async ({ where, data }: any) => { let n = 0; for (const d of s.lessonDrafts) if (match(d, where)) { Object.assign(d, data); n++; } return { count: n }; },
      update: async ({ where, data }: any) => { const d = s.lessonDrafts.find((x: any) => x.id === where.id); Object.assign(d, data); return clone(d); },
    },
    lesson: {
      findMany: async ({ where }: any) => clone(s.lessons.filter((l: any) => match(l, where))),
      deleteMany: async ({ where }: any) => { const before = s.lessons.length; s.lessons = s.lessons.filter((l: any) => !match(l, where)); return { count: before - s.lessons.length }; },
      create: async ({ data }: any) => { const l = { id: `lesson-${++s.seq}`, ...data }; s.lessons.push(l); return clone(l); },
    },
    learningObjective: {
      deleteMany: async ({ where }: any) => { s.objectives = s.objectives.filter((o: any) => !match(o, where)); return { count: 0 }; },
      create: async ({ data }: any) => { const o = { id: `obj-${++s.seq}`, ...data }; s.objectives.push(o); return clone(o); },
    },
    questionDraft: {
      findMany: async ({ where }: any) => clone(s.questionDrafts.filter((d: any) => match(d, where)).sort((a: any, b: any) => (a.id < b.id ? -1 : 1))),
      update: async ({ where, data }: any) => { const d = s.questionDrafts.find((x: any) => x.id === where.id); Object.assign(d, data); return clone(d); },
    },
    question: {
      create: async ({ data }: any) => {
        if (hooks.failOnQuestionCreate !== undefined && s.questions.filter((q: any) => String(q.id).startsWith("q-new")).length === hooks.failOnQuestionCreate) throw new Error("simulated DB failure");
        const q = { id: `q-new-${++s.seq}`, ...data }; s.questions.push(q); return clone(q);
      },
    },
  });
  return {
    $transaction: async (fn: any, opts?: any) => {
      expect(opts?.isolationLevel).toBe("Serializable");
      const draft = clone(state.s);
      const result = await fn(api(draft));
      state.s = draft; // commit only on success
      return result;
    },
  };
}

/** Fake staging deps writing pending_review drafts into the store (scripted Question yields). */
function stageDeps(state: { s: State }, opts: { lessonThrows?: boolean; yields?: Array<number | Error> } = {}) {
  let call = 0;
  const deps: StageDeps & { calls: { lesson: number; questions: number } } = {
    calls: { lesson: 0, questions: 0 },
    generateLesson: async (_topicId, gate) => {
      deps.calls.lesson++;
      if (opts.lessonThrows) throw new Error("Auto lesson draft generation failed validation after 2 attempt(s).");
      const id = `ld-staged-${++state.s.seq}`;
      state.s.lessonDrafts.push({ id, status: "pending_review", publishedTopicId: null, targetUnitId: UNIT, topicNameEn: "Planet Earth", topicNameAr: "كوكب الأرض", teachingStepsJson: [{ id: "new1", type: "INTRO", order: 1, objective: "water bodies" }], learningObjectivesJson: [{ objectiveEn: "Identify oceans", objectiveAr: "التعرف على المحيطات" }] });
      return { draftId: id, objectivesEn: ["Identify oceans"], metadata: { generationSource: "TEXTBOOK_GROUNDED", groundingVersionUsed: 1, generationPromptVersion: "auto-lesson-v1", provenance: gate.provenance } };
    },
    generateQuestions: async (_topicId, count, gate) => {
      deps.calls.questions++;
      const y = (opts.yields ?? [8])[call++];
      if (y instanceof Error) throw y;
      const ids = [];
      for (let i = 0; i < Math.min(count, y ?? 0); i++) { const id = `qd-staged-${++state.s.seq}`; state.s.questionDrafts.push({ id, topicId: TOPIC, status: "pending_review", publishedQuestionId: null, ...QV, promptEn: `Earth question ${id}`, ...gate.provenance }); ids.push(id); }
      return ids;
    },
    loadQuestionDrafts: async (ids) => clone(state.s.questionDrafts.filter((d: any) => ids.includes(d.id))),
  };
  return deps;
}
const SCOPE = new Set([UNIT]);
const pendingOf = (state: { s: State }) => async () => ({
  questionDrafts: clone(state.s.questionDrafts.filter((d: any) => d.topicId === TOPIC && d.status === "pending_review" && !d.publishedQuestionId)),
  lessonDrafts: clone(state.s.lessonDrafts.filter((d: any) => d.targetUnitId === UNIT && d.status === "pending_review" && !d.publishedTopicId)),
});
const liveOnly = (s: State) => clone({ unit: s.unit, assignment: s.assignment, topic: s.topic, lessons: s.lessons, objectives: s.objectives, questions: s.questions, publishedDrafts: s.questionDrafts.filter((d: any) => d.status === "published"), claimedLessonDrafts: s.lessonDrafts.filter((d: any) => d.status === "published") });

/** REAL student services over the store's current state, with a provider spy. */
function students(state: { s: State }) {
  const generate = jest.fn();
  const prisma = {
    client: {
      studentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "student-1", fullName: "S", subjects: [{ subjectId: SUBJECT, expiresAt: null }] }) },
      topic: { findUnique: jest.fn(async () => clone(view(state.s))), findMany: jest.fn(async () => [clone(view(state.s))]) },
      question: { findMany: jest.fn(async ({ where }: any) => clone(state.s.questions.filter((q: any) => (where.id ? where.id.in.includes(q.id) : true) && q.topicId === TOPIC).map((q: any) => ({ ...q, topic: clone(view(state.s)) })))), count: jest.fn() },
      questionDraft: { create: jest.fn() },
      questionAttempt: { createMany: jest.fn() },
      quizResult: { create: jest.fn().mockResolvedValue({ id: "r" }) },
      aIUsage: { create: jest.fn().mockResolvedValue(undefined) },
    },
  } as any;
  const usage = { assertWithinBudget: jest.fn(), estimateMaxChatCostUsd: jest.fn(), reserveBudget: jest.fn(), reconcileBudget: jest.fn(), releaseBudget: jest.fn() };
  const qgen = new QuestionDraftGeneratorService(prisma, { getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "m" }), getCostRates: jest.fn() } as any, { buildAutoQuestionBatchGenerationPrompt: jest.fn() } as any, usage as any, { autoPublish: jest.fn() } as any, { ensureTopicHasLesson: jest.fn() } as any);
  const acc = { getPerTopicAccuracy: jest.fn().mockResolvedValue([]), getTopicAccuracy: jest.fn().mockResolvedValue(null) } as any;
  return { practice: new PracticeService(prisma, acc, qgen), quizzes: new QuizzesService(prisma, acc, qgen, { send: jest.fn() } as any), generate, usage, prisma };
}
const served = (qs: any[]) => qs.map((q) => q.id).sort();
const OLD_CUR = Array.from({ length: 8 }, (_, i) => `q-old-cur-${i}`).sort();

async function stagedFixture(opts: { strict?: boolean } = {}) {
  const state = { s: freshState(opts) };
  const plan = planStagedRepair(view(state.s) as any, SCOPE);
  const deps = stageDeps(state);
  const staged = await stageReplacement(plan, deps);
  return { state, plan, staged, deps };
}

describe("STAGED REPAIR — pre-commit state (old live assignment + old CURRENT content only)", () => {
  it("1/6: STRICT Unit, staged content present: Practice serves exactly the 8 old CURRENT Questions, zero lazy generation", async () => {
    const { state } = await stagedFixture();
    const st = students(state);
    const r = await st.practice.getAdaptiveQuestions("u", SUBJECT, TOPIC, 100);
    expect(served(r.questions)).toEqual(OLD_CUR);
    expect(st.generate).not.toHaveBeenCalled();
    expect(st.usage.reserveBudget).not.toHaveBeenCalled();
    expect(canServeTopicSteps(view(state.s) as any)).toBe(true);
  });
  it("7: Quiz topic assessment and lesson check serve old CURRENT only, zero lazy generation", async () => {
    const { state } = await stagedFixture();
    const st = students(state);
    for (const type of ["topic_assessment", "lesson_check"] as const) {
      const r = await st.quizzes.getQuizQuestions("u", SUBJECT, type, TOPIC, () => 0.5);
      expect(r.questions.every((q: any) => OLD_CUR.includes(q.id))).toBe(true);
      expect(r.availableCount).toBe(8);
    }
    expect(st.generate).not.toHaveBeenCalled();
  });
  it("2: staged content lives only in draft tables (no Question rows), and candidate-stamped content would be MISMATCH (not servable) against the old live assignment", async () => {
    const { state, plan } = await stagedFixture();
    expect(state.s.questions.some((q: any) => q.groundingAssignmentFingerprint === plan.candidateAssignmentFingerprint)).toBe(false);
    expect(state.s.questionDrafts.filter((d: any) => d.status === "pending_review")).toHaveLength(8);
    const hypothetical = { topicId: TOPIC, ...plan.candidate.gate.provenance };
    const servable = questionServabilityByTopic([view(state.s) as any], [...state.s.questions, hypothetical]);
    expect(servable(hypothetical)).toBe(false);
    expect(canServeTopicSteps({ ...view(state.s), groundingSourceFingerprintUsed: hypothetical.groundingSourceFingerprint, groundingAssignmentFingerprintUsed: hypothetical.groundingAssignmentFingerprint } as any)).toBe(false);
  });
  it("5: LEGACY is never servable during a STRICT repair (pre-commit)", async () => {
    const { state } = await stagedFixture();
    const servable = questionServabilityByTopic([view(state.s) as any], state.s.questions);
    expect(state.s.questions.filter((q: any) => q.id.startsWith("q-legacy")).some(servable)).toBe(false);
  });
});

describe("STAGED REPAIR — atomic commit", () => {
  it("3/4/5/16/17/23: commit flips assignment + lesson + 8 Questions together; old CURRENT becomes MISMATCH; LEGACY stays excluded; version unchanged; Unit stays STRICT", async () => {
    const { state, plan, staged } = await stagedFixture();
    const strictAt = state.s.unit.contentProvenanceEnforcedAt;
    const r = await flipStagedReplacement(store(state), plan, staged);
    const v = view(state.s);
    const gate = evaluateTopicGroundingGate(v as any);
    expect(gate.state).toBe("READY");
    if (gate.state !== "READY") return;
    expect(gate.provenance.groundingAssignmentFingerprint).toBe(plan.candidateAssignmentFingerprint); // 16
    expect(r.newAssignmentFingerprint).toBe(plan.candidateAssignmentFingerprint);
    expect(state.s.assignment).toMatchObject({ method: "SINGLE_TOPIC_FALLBACK", status: "READY", assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION }); // 23
    expect(canServeTopicSteps(v as any)).toBe(true);
    expect(state.s.topic.teachingStepsJson).toEqual([{ id: "new1", type: "INTRO", order: 1, objective: "water bodies" }]);
    const servable = questionServabilityByTopic([v as any], v.questions);
    const s = v.questions.filter(servable);
    expect(s).toHaveLength(8); // 17
    expect(s.every((q: any) => classifyContentProvenance(q, gate.provenance) === "CURRENT")).toBe(true);
    expect(v.questions.filter((q: any) => q.id.startsWith("q-old-cur")).every((q: any) => classifyContentProvenance(q, gate.provenance) === "MISMATCH" && !servable(q))).toBe(true); // 4
    expect(v.questions.filter((q: any) => q.id.startsWith("q-legacy")).some(servable)).toBe(false); // 5
    expect(state.s.unit.contentProvenanceEnforcedAt).toEqual(strictAt);
    expect(verifyCommitted(view(state.s) as any, plan)).toEqual([]);
  });
  it("18: every historical Question and QuestionDraft row is byte-identical after the flip; only the staged drafts change state", async () => {
    const { state, plan, staged } = await stagedFixture();
    const oldQ = clone(state.s.questions), oldD = clone(state.s.questionDrafts.filter((d: any) => !staged.questionDraftIds.includes(d.id)));
    await flipStagedReplacement(store(state), plan, staged);
    expect(state.s.questions.filter((q: any) => !q.id.startsWith("q-new"))).toEqual(oldQ);
    expect(state.s.questionDrafts.filter((d: any) => !staged.questionDraftIds.includes(d.id))).toEqual(oldD);
    expect(state.s.questionDrafts.filter((d: any) => staged.questionDraftIds.includes(d.id)).every((d: any) => d.status === "published" && d.publishedQuestionId)).toBe(true);
  });
  it("8: answer submission — old CURRENT graded before commit; after commit old ids reveal nothing; new CURRENT graded", async () => {
    const { state, plan, staged } = await stagedFixture();
    const before = await students(state).practice.submitPractice("u", [{ questionId: "q-old-cur-0", answer: "a" }]);
    expect(before.feedback.map((f: any) => f.questionId)).toEqual(["q-old-cur-0"]);
    await flipStagedReplacement(store(state), plan, staged);
    const newId = state.s.questions.find((q: any) => q.id.startsWith("q-new")).id;
    const after = await students(state).practice.submitPractice("u", [{ questionId: "q-old-cur-0", answer: "a" }, { questionId: "q-legacy-0", answer: "a" }, { questionId: newId, answer: "a" }]);
    expect(after.feedback.map((f: any) => f.questionId)).toEqual([newId]);
  });
  it("19: post-commit Practice/Quiz serve the 8 new CURRENT Questions with zero lazy generation", async () => {
    const { state, plan, staged } = await stagedFixture();
    await flipStagedReplacement(store(state), plan, staged);
    const st = students(state);
    const r = await st.practice.getAdaptiveQuestions("u", SUBJECT, TOPIC, 100);
    expect(r.questions).toHaveLength(8);
    expect(r.questions.every((q: any) => q.id.startsWith("q-new"))).toBe(true);
    expect((await st.quizzes.getQuizQuestions("u", SUBJECT, "lesson_check", TOPIC, () => 0.5)).availableCount).toBe(8);
    expect(st.generate).not.toHaveBeenCalled();
  });
  it("TRANSITION Unit: the same flip works without relying on LEGACY fallback, and leaves the Unit TRANSITION for the normal STRICT step", async () => {
    const { state, plan, staged } = await stagedFixture({ strict: false });
    expect(plan.unitMode).toBe("TRANSITION");
    await flipStagedReplacement(store(state), plan, staged);
    const v = view(state.s);
    const servable = questionServabilityByTopic([v as any], v.questions);
    expect(v.questions.filter(servable).every((q: any) => q.id.startsWith("q-new"))).toBe(true);
    expect(state.s.unit.contentProvenanceEnforcedAt).toBeNull();
  });
});

describe("STAGED REPAIR — aborts leave live state untouched", () => {
  const expectAbort = async (mutate: (s: State) => void, code: string, hooks: any = {}) => {
    const { state, plan, staged } = await stagedFixture();
    mutate(state.s);
    const before = liveOnly(state.s);
    await expect(flipStagedReplacement(store(state, hooks), plan, staged)).rejects.toMatchObject({ code });
    expect(liveOnly(state.s)).toEqual(before);
  };
  it("12: CAS conflict (assignment modified after preflight) aborts completely", () => expectAbort((s) => { s.assignment.updatedAt = new Date("2026-10-03T00:00:00Z"); }, "CAS_CONFLICT"));
  it("14: Unit grounding fingerprint changed: abort", () => expectAbort((s) => { s.unit.groundingSourceFingerprint = "fp-regrounded"; }, "PRECONDITION_GROUNDING"));
  it("15: Topic no longer the sole Topic: abort", () => expectAbort((s) => { s.extraTopics.push({ id: "topic-2", nameEn: "Rocks", order: 2 }); }, "PRECONDITION_NOT_SOLE"));
  it("live lesson changed after preflight: abort", () => expectAbort((s) => { s.topic.teachingStepsJson = [{ id: "x" }]; }, "PRECONDITION_CONTENT"));
  it("a staged draft tampered with (provenance changed): abort", () => expectAbort((s) => { s.questionDrafts.find((d: any) => d.status === "pending_review").groundingAssignmentFingerprint = "tga1:other"; }, "STAGED_INVALID"));
  it("13: a failure in the middle of installing Questions rolls back assignment, lesson and every Question", async () => {
    const { state, plan, staged } = await stagedFixture();
    const before = liveOnly(state.s);
    await expect(flipStagedReplacement(store(state, { failOnQuestionCreate: 4 }), plan, staged)).rejects.toThrow("simulated DB failure");
    expect(liveOnly(state.s)).toEqual(before);
    expect(state.s.assignment.method).toBe("KEYWORD_OVERLAP");
  });
});

describe("STAGED REPAIR — staging failures (provider work before any live write)", () => {
  const baseDeps = (state: { s: State }, opts: any, flip = jest.fn()) => ({ ...stageDeps(state, opts), loadTopic: async () => clone(view(state.s)), loadLessonDraft: async (id: string) => clone(state.s.lessonDrafts.find((d: any) => d.id === id)), loadPendingStaged: pendingOf(state), flip });
  it.each([
    ["9/10: lesson generation failure", { lessonThrows: true }],
    ["11: Question generation fails in both bounded batches", { yields: [new Error("failed validation"), new Error("failed validation")] }],
    ["bounded batches exhausted below 8", { yields: [5, 1] }],
  ])("%s: no flip, live assignment and content untouched, FAILED reported", async (_n, opts) => {
    const state = { s: freshState() };
    const before = liveOnly(state.s);
    const flip = jest.fn();
    const out = await runStagedRepair({ topicIds: [TOPIC], apply: true }, SCOPE, baseDeps(state, opts, flip) as any);
    expect(out.stoppedOnFailure).toBe(true);
    expect(out.results[0].status).toBe("FAILED");
    expect(flip).not.toHaveBeenCalled();
    expect(liveOnly(state.s)).toEqual(before);
  });
  it("bounded completion: a short first batch is completed by exactly one more batch requesting only the rest", async () => {
    const state = { s: freshState() };
    const plan = planStagedRepair(view(state.s) as any, SCOPE);
    const deps = stageDeps(state, { yields: [3, 8] });
    const spy = jest.spyOn(deps, "generateQuestions");
    const staged = await stageReplacement(plan, deps);
    expect(spy.mock.calls.map((c) => c[1])).toEqual([8, 5]);
    expect(staged.questionDraftIds).toHaveLength(8);
  });
  it("dry run: zero provider calls and zero writes; reports both fingerprints, slices, content and expected work", async () => {
    const state = { s: freshState() };
    const before = clone(state.s);
    const deps = baseDeps(state, {});
    const out = await runStagedRepair({ topicIds: [TOPIC], apply: false }, SCOPE, deps as any);
    expect(out.results[0]).toMatchObject({ status: "PLANNED", unitMode: "STRICT", oldSlice: { concepts: 1 }, candidateSlice: { concepts: 3, facts: 2, vocabulary: 2 }, currentContent: { steps: "CURRENT", currentQuestions: 8, legacyQuestions: 7 }, expectedProviderWork: { lessonGenerations: 1, questionsToStage: 8 } });
    expect(out.results[0].baselineAssignment.fingerprint).not.toBe(out.results[0].candidateAssignment.fingerprint);
    expect(deps.calls).toEqual({ lesson: 0, questions: 0 });
    expect(state.s).toEqual(before);
  });
  it("COMPLETED end-to-end through the tool with a real transactional store", async () => {
    const state = { s: freshState() };
    const out = await runStagedRepair({ topicIds: [TOPIC], apply: true }, SCOPE, { ...baseDeps(state, {}), flip: (plan: StagedRepairPlan, staged: any) => flipStagedReplacement(store(state), plan, staged) } as any);
    expect(out.results[0].status).toBe("COMPLETED");
    expect(out.results[0].flip.currentServableQuestions).toBe(8);
  });
});

describe("STAGED REPAIR — scope and eligibility refusals", () => {
  it("20: multi-Topic Unit refused", () => { const s = freshState(); s.extraTopics.push({ id: "t2", nameEn: "Rocks", order: 2 }); expect(() => planStagedRepair(view(s) as any, SCOPE)).toThrow(/sole-Topic/); });
  it("21: a Topic outside the repair scope (non-Wave-B Unit) refused", () => { expect(() => planStagedRepair(view(freshState()) as any, new Set(["some-other-unit"]))).toThrow(StagedRepairError); });
  it("22: BLOCKED Topic refused", () => { const s = freshState(); s.assignment.status = "BLOCKED"; expect(() => planStagedRepair(view(s) as any, SCOPE)).toThrow(/not READY/); });
  it("an AI_MAPPER or already whole-Unit assignment is refused", () => {
    for (const method of ["AI_MAPPER", "SINGLE_TOPIC_FALLBACK"]) { const s = freshState(); s.assignment.method = method; expect(() => planStagedRepair(view(s) as any, SCOPE)).toThrow(); }
  });
  it("tool args: explicit bounded allowlist + required plan scope; scope comes from the plan's Unit ids", () => {
    expect(parseArgs(["--plan=p.json", "--topicIds=cmucxctf800092qd5centl3fq"])).toEqual({ plan: "p.json", topicIds: ["cmucxctf800092qd5centl3fq"], apply: false, reuseStaged: false });
    expect(parseArgs(["--plan=p.json", "--topicIds=cmucxctf800092qd5centl3fq", "--apply", "--reuse-staged"]).reuseStaged).toBe(true);
    for (const bad of [["--topicIds=cmucxctf800092qd5centl3fq"], ["--plan=p.json"], ["--plan=p.json", "--unitIds=cmucxctf300072qd5jelu3k9c"]]) expect(() => parseArgs(bad)).toThrow();
    expect(scopeFromPlan({ books: [{ expectedUnits: [{ unitId: "a" }, { unitId: "b" }] }] })).toEqual(new Set(["a", "b"]));
  });
});

describe("STAGED REPAIR — generators honour the staged gate and keep normal accounting (24)", () => {
  const candidate = () => planStagedRepair(view(freshState()) as any, SCOPE).candidate.gate;
  function qgen(liveTopic: any, generateImpl?: any) {
    const generate = jest.fn().mockImplementation(generateImpl ?? (async () => ({ content: JSON.stringify({ questions: [{ ...QV, promptEn: "Which is an ocean on Earth?" }] }), inputTokens: 5, outputTokens: 5 })));
    const usage = { assertWithinBudget: jest.fn(), estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01), reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "r" }), reconcileBudget: jest.fn().mockResolvedValue(undefined), releaseBudget: jest.fn().mockResolvedValue(undefined) };
    const prisma = { client: { topic: { findUnique: jest.fn().mockResolvedValue(liveTopic) }, questionDraft: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: "qd", ...data })) }, aIUsage: { create: jest.fn().mockResolvedValue(undefined) } } } as any;
    const svc = new QuestionDraftGeneratorService(prisma, { getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "m" }), getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0, costPerOutputToken: 0 }) } as any, { buildAutoQuestionBatchGenerationPrompt: jest.fn().mockReturnValue("p") } as any, usage as any, {} as any, {} as any);
    return { svc, generate, usage, prisma };
  }
  const liveTopic = (lessons: any[] = [{ isPlaceholder: false, objectives: [{ descriptionEn: "old" }] }]) => ({ ...view(freshState()), nameEn: "Planet Earth", lessons, unit: { ...view(freshState()).unit, _count: { topics: 1 } } });

  it("staged Question drafts carry the CANDIDATE provenance (live assignment is still the old one) and use the staged lesson objectives", async () => {
    const gate = candidate();
    const h = qgen(liveTopic());
    await h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", { gate, lessonObjectives: ["Identify oceans"] });
    expect(h.prisma.client.questionDraft.create.mock.calls[0][0].data).toMatchObject(gate.provenance);
  });
  it("only the staged path may generate for a Topic whose live Lesson does not exist yet", async () => {
    await expect(qgen(liveTopic([])).svc.generateAutoQuestionBatch(TOPIC, 1, "actor")).rejects.toThrow(/no real lesson/);
    await expect(qgen(liveTopic([])).svc.generateAutoQuestionBatch(TOPIC, 1, "actor", { gate: candidate() })).resolves.toBeDefined();
  });
  it("24: provider spend is reserved and reconciled normally even when the later publish fails; nothing is released or compensated", async () => {
    const state = { s: freshState() };
    const plan = planStagedRepair(view(state.s) as any, SCOPE);
    const h = qgen(liveTopic(), async () => ({ content: JSON.stringify({ questions: Array.from({ length: 8 }, (_, i) => ({ ...QV, promptEn: `Earth ocean question ${i}` })) }), inputTokens: 5, outputTokens: 5 }));
    await h.svc.generateAutoQuestionBatch(TOPIC, 8, "actor", { gate: plan.candidate.gate, lessonObjectives: [] });
    expect(h.usage.reserveBudget).toHaveBeenCalledTimes(1);
    expect(h.usage.reconcileBudget).toHaveBeenCalledTimes(1);
    const staged = await stageReplacement(plan, stageDeps(state));
    state.s.assignment.updatedAt = new Date("2026-10-03T01:00:00Z"); // publish will fail on CAS
    await expect(flipStagedReplacement(store(state), plan, staged)).rejects.toMatchObject({ code: "CAS_CONFLICT" });
    expect(h.usage.releaseBudget).not.toHaveBeenCalled();
    expect(h.usage.reconcileBudget).toHaveBeenCalledTimes(1);
  });
  it("lesson staging: generateAutoDraft with a staged gate never reads the live gate and stamps the candidate provenance", async () => {
    const gate = candidate();
    const generate = jest.fn().mockResolvedValue({ content: JSON.stringify({ topicNameEn: "Planet Earth", learningObjectives: [{ objectiveEn: "Identify oceans on Earth", objectiveAr: "التعرف على المحيطات" }, { objectiveEn: "Identify rocks", objectiveAr: "التعرف على الصخور" }], steps: [{ id: "s1", type: "INTRO", order: 1, objective: "Introduce Earth water bodies" }, { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain types of water bodies" }, { id: "s3", type: "CHECK", order: 3, objective: "Check types of rocks" }, { id: "s4", type: "COMPLETE", order: 4, objective: "Wrap up components of Earth" }] }), inputTokens: 5, outputTokens: 5 });
    const topicFind = jest.fn();
    const prisma = { client: { topic: { findUnique: topicFind }, unit: { findUnique: jest.fn().mockResolvedValue({ id: UNIT, nameEn: "Planet Earth", subjectId: SUBJECT, sourceFileOverride: null, groundingNotesJson: NOTES, groundingVersion: 1, subject: { nameEn: "Science", sourceFile: "eg/y1/science.pdf", grade: { nameEn: "Year 1", curriculum: { nameEn: "EG" } } }, _count: { topics: 1 } }) }, lessonDraft: { create: jest.fn().mockResolvedValue({ id: "ld" }) }, aIUsage: { create: jest.fn().mockResolvedValue(undefined) } } } as any;
    const usage = { assertWithinBudget: jest.fn(), estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01), reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "r" }), reconcileBudget: jest.fn().mockResolvedValue(undefined), releaseBudget: jest.fn() };
    const svc = new LessonDraftGeneratorService(prisma, { getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "m" }), getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0, costPerOutputToken: 0 }) } as any, { buildAutoLessonGenerationPrompt: jest.fn().mockReturnValue("p") } as any, usage as any, {} as any, {} as any);
    const r = await svc.generateAutoDraft({ id: TOPIC, nameEn: "Planet Earth", nameAr: "كوكب الأرض", unitId: UNIT }, { preferredLang: "en", studentAgeRange: "6-12" }, "actor", { gate });
    expect(topicFind).not.toHaveBeenCalled();
    expect(r.provenance).toEqual(gate.provenance);
    expect(usage.reconcileBudget).toHaveBeenCalledTimes(1);
  });
});

/**
 * 2026-10-03 ACCUMULATED POOL VALIDATION — grounding consistency for a staged
 * completion batch is judged on the FINAL candidate pool (already-accepted
 * staged Questions of THIS plan + the new batch), never on the batch alone;
 * every other rule is unchanged.
 */
describe("ACCUMULATED POOL — generator (real QuestionDraftGeneratorService)", () => {
  const gate = () => planStagedRepair(view(freshState()) as any, SCOPE).candidate.gate;
  const ANCHORED = (i: number) => ({ ...QV, promptEn: `Which of these is one of the types of rocks? (${i})` });
  const PLAIN = (i: number) => ({ ...QV, promptEn: `What is 15 minus ${i}?` });
  function harness(batches: any[][], live: any = { ...view(freshState()), nameEn: "Planet Earth", lessons: [{ isPlaceholder: false, objectives: [] }], unit: { ...view(freshState()).unit, _count: { topics: 1 } } }) {
    let call = 0;
    const generate = jest.fn().mockImplementation(async () => ({ content: JSON.stringify({ questions: batches[Math.min(call++, batches.length - 1)] }), inputTokens: 5, outputTokens: 5 }));
    const usage = { assertWithinBudget: jest.fn(), estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01), reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "r" }), reconcileBudget: jest.fn().mockResolvedValue(undefined), releaseBudget: jest.fn().mockResolvedValue(undefined) };
    const prisma = { client: { topic: { findUnique: jest.fn().mockResolvedValue(live) }, question: { findMany: jest.fn().mockResolvedValue([]) }, questionDraft: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: `qd-${Math.random()}`, ...data })) }, aIUsage: { create: jest.fn().mockResolvedValue(undefined) } } } as any;
    const svc = new QuestionDraftGeneratorService(prisma, { getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "m" }), getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0, costPerOutputToken: 0 }) } as any, { buildAutoQuestionBatchGenerationPrompt: jest.fn().mockReturnValue("p") } as any, usage as any, { autoPublish: jest.fn() } as any, { ensureTopicHasLesson: jest.fn() } as any);
    return { svc, generate, usage, prisma };
  }
  const anchored7 = Array.from({ length: 7 }, (_, i) => ({ promptEn: ANCHORED(i).promptEn, explanationEn: ANCHORED(i).explanationEn }));
  const plain7 = Array.from({ length: 7 }, (_, i) => ({ promptEn: PLAIN(i).promptEn, explanationEn: PLAIN(i).explanationEn }));

  it("1/19: an initial anchored 8-Question batch passes exactly as before (no pool)", async () => {
    const h = harness([Array.from({ length: 8 }, (_, i) => ANCHORED(i))]);
    expect((await h.svc.generateAutoQuestionBatch(TOPIC, 8, "actor", { gate: gate() })).drafts).toHaveLength(8);
  });
  it("2: an initial completely ungrounded batch still fails, with no draft written", async () => {
    const h = harness([Array.from({ length: 8 }, (_, i) => PLAIN(i))]);
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 8, "actor", { gate: gate() })).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });
  it("3: 7 grounded staged + 1 curriculum-valid non-anchor Question: the final pool passes", async () => {
    const h = harness([[PLAIN(99)]]);
    const r = await h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", { gate: gate(), acceptedPool: anchored7 });
    expect(r.drafts).toHaveLength(1);
  });
  it("3b: the SAME single non-anchor Question without the pool fails (the batch boundary was the only difference)", async () => {
    const h = harness([[PLAIN(99)]]);
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", { gate: gate() })).rejects.toThrow(/failed validation/);
  });
  it("4: 7 ungrounded staged + 1 non-anchor Question: the final pool fails", async () => {
    const h = harness([[PLAIN(99)]]);
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", { gate: gate(), acceptedPool: plain7 })).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });
  it("5: 7 ungrounded staged + 1 anchored Question: passes exactly because the combined pool satisfies the unchanged anchor rule", async () => {
    const h = harness([[ANCHORED(99)]]);
    expect((await h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", { gate: gate(), acceptedPool: plain7 })).drafts).toHaveLength(1);
  });
  it("6: verbatim-copy protection is still enforced on the final pool", async () => {
    const h = harness([[{ ...QV, promptEn: "Earth is made up of soil, rocks and water. True or False?" }]]);
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", { gate: gate(), acceptedPool: anchored7 })).rejects.toThrow(/failed validation/);
  });
  it("7: a structurally invalid new Question cannot be rescued by the accepted pool", async () => {
    const h = harness([[{ ...ANCHORED(99), optionsJson: ["a", "b"] }]]);
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", { gate: gate(), acceptedPool: anchored7 })).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });
  it("13: a one-Question completion persists at most the one requested Question even if the model returns more", async () => {
    const h = harness([[PLAIN(1), PLAIN(2), PLAIN(3)]]);
    expect((await h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", { gate: gate(), acceptedPool: anchored7 })).drafts).toHaveLength(1);
    expect(h.prisma.client.questionDraft.create).toHaveBeenCalledTimes(1);
  });
  it("14/15: retries stay bounded at 2 provider calls, each reserved and reconciled; nothing released", async () => {
    const h = harness([[PLAIN(1)]]);
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", { gate: gate(), acceptedPool: plain7 })).rejects.toThrow();
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(h.usage.reserveBudget).toHaveBeenCalledTimes(2);
    expect(h.usage.reconcileBudget).toHaveBeenCalledTimes(2);
    expect(h.usage.releaseBudget).not.toHaveBeenCalled();
  });
  it("20: the student lazy top-up never uses a pool — grounded Questions already stored do not rescue an ungrounded new batch", async () => {
    const cur = gate().provenance;
    const live = { ...view(freshState()), nameEn: "Planet Earth", lessons: [{ isPlaceholder: false, objectives: [] }], unit: { ...view(freshState()).unit, _count: { topics: 1 } } };
    const h = harness([[PLAIN(1)]], live);
    h.prisma.client.question.findMany = jest.fn().mockResolvedValue([]);
    await h.svc.ensurePoolForTopic(TOPIC, "student");
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled(); // per-batch rule, exactly as before
    expect(cur).toBeDefined();
  });
});

describe("ACCUMULATED POOL — staging, leftovers and reuse", () => {
  /** Stage a 7-Question failed run's leftovers exactly like production: 7 candidate drafts + 1 pending lesson draft. */
  function withLeftovers() {
    const state = { s: freshState() };
    const plan = planStagedRepair(view(state.s) as any, SCOPE);
    state.s.lessonDrafts.push({ id: "ld-leftover", status: "pending_review", publishedTopicId: null, targetUnitId: UNIT, topicNameEn: "Planet Earth", topicNameAr: "كوكب الأرض", teachingStepsJson: [{ id: "x", type: "INTRO", order: 1, objective: "x" }], learningObjectivesJson: [{ objectiveEn: "a", objectiveAr: "ب" }] });
    for (let i = 0; i < 7; i++) state.s.questionDrafts.push({ id: `qd-left-${i}`, topicId: TOPIC, status: "pending_review", publishedQuestionId: null, ...QV, promptEn: `Leftover rocks question ${i}`, ...plan.candidate.gate.provenance });
    return { state, plan };
  }
  const deps = (state: { s: State }, opts: any = {}) => ({ ...stageDeps(state, opts), loadTopic: async () => clone(view(state.s)), loadLessonDraft: async (id: string) => clone(state.s.lessonDrafts.find((d: any) => d.id === id)), loadPendingStaged: pendingOf(state) });

  it("leftover discovery: exactly the 7 candidate drafts are reusable; the LessonDraft is reported but never reusable", async () => {
    const { state, plan } = withLeftovers();
    const p = await pendingOf(state)();
    const lo = discoverStagedLeftovers(plan, p.questionDrafts, p.lessonDrafts);
    expect(lo.reusableQuestionDraftIds).toHaveLength(7);
    expect(lo.pendingLessonDraftIds).toEqual(["ld-leftover"]);
    expect(lo.ambiguous).toEqual([]);
  });
  it.each([
    ["8: a foreign-candidate pending draft", (s: State) => s.questionDrafts.push({ id: "qd-foreign", topicId: TOPIC, status: "pending_review", publishedQuestionId: null, ...QV, promptEn: "f", groundingSourceFingerprint: FP, groundingAssignmentFingerprint: "tga1:other" })],
    ["a provenance-less pending draft", (s: State) => s.questionDrafts.push({ id: "qd-null", topicId: TOPIC, status: "pending_review", publishedQuestionId: null, ...QV, promptEn: "n", groundingSourceFingerprint: null, groundingAssignmentFingerprint: null })],
    ["an invalid candidate draft", (s: State) => Object.assign(s.questionDrafts.find((d: any) => d.id === "qd-left-0"), { optionsJson: ["a"] })],
    ["a duplicate staged prompt", (s: State) => Object.assign(s.questionDrafts.find((d: any) => d.id === "qd-left-1"), { promptEn: "Leftover rocks question 0" })],
    ["12: more reusable drafts than the target", (s: State) => { const prov = planStagedRepair(view(s) as any, SCOPE).candidate.gate.provenance; for (let i = 7; i < 10; i++) s.questionDrafts.push({ id: `qd-left-${i}`, topicId: TOPIC, status: "pending_review", publishedQuestionId: null, ...QV, promptEn: `Leftover rocks question ${i}`, ...prov }); }],
  ])("ambiguous leftovers stop the tool before any provider call (%s) — nothing reused or deleted", async (_n, mutate) => {
    const { state } = withLeftovers();
    mutate(state.s);
    const before = clone(state.s);
    const d = deps(state);
    const out = await runStagedRepair({ topicIds: [TOPIC], apply: true, reuseStaged: true }, SCOPE, { ...d, flip: jest.fn() } as any);
    expect(out.results[0].error.code).toBe("STAGED_LEFTOVERS_AMBIGUOUS");
    expect(d.calls).toEqual({ lesson: 0, questions: 0 });
    expect(state.s).toEqual(before);
  });
  it("reuse requires the explicit --reuse-staged flag", async () => {
    const { state } = withLeftovers();
    const d = deps(state);
    const out = await runStagedRepair({ topicIds: [TOPIC], apply: true }, SCOPE, { ...d, flip: jest.fn() } as any);
    expect(out.results[0].error.code).toBe("STAGED_LEFTOVERS_PRESENT");
    expect(d.calls).toEqual({ lesson: 0, questions: 0 });
  });
  it("dry run with leftovers: plans ONLY 1 new Question, reports the lesson as not reusable, zero calls and writes", async () => {
    const { state } = withLeftovers();
    const before = clone(state.s);
    const d = deps(state);
    const out = await runStagedRepair({ topicIds: [TOPIC], apply: false, reuseStaged: true }, SCOPE, { ...d, flip: jest.fn() } as any);
    expect(out.results[0]).toMatchObject({ status: "PLANNED", expectedProviderWork: { questionsReused: 7, questionsToStage: 1, lessonGenerations: 1 }, stagedLeftovers: { reusableQuestionDrafts: expect.arrayContaining(["qd-left-0"]), pendingLessonDrafts: ["ld-leftover"] } });
    expect(out.results[0].stagedLeftovers.lessonReuse).toMatch(/NOT_REUSED/);
    expect(d.calls).toEqual({ lesson: 0, questions: 0 });
    expect(state.s).toEqual(before);
  });
  it("9/10/11: the accepted pool passed to completion contains ONLY this plan's staged drafts — never LEGACY, old live CURRENT or MISMATCH rows", async () => {
    const { state, plan } = withLeftovers();
    const d = deps(state, { yields: [1] });
    const spy = jest.spyOn(d, "generateQuestions");
    await stageReplacement(plan, d, { reuseQuestionDraftIds: Array.from({ length: 7 }, (_, i) => `qd-left-${i}`) });
    const pool = (spy.mock.calls[0][4] as Array<{ promptEn: string }>).map((q) => q.promptEn);
    expect(pool.sort()).toEqual(Array.from({ length: 7 }, (_, i) => `Leftover rocks question ${i}`).sort());
    expect(pool.some((p) => /Old current|Legacy/.test(p))).toBe(false);
    expect(spy.mock.calls[0][1]).toBe(1); // only the missing Question is requested
  });
  it("8: a foreign draft id passed for reuse is refused (cannot contribute)", async () => {
    const { state, plan } = withLeftovers();
    state.s.questionDrafts.push({ id: "qd-foreign", topicId: TOPIC, status: "pending_review", publishedQuestionId: null, ...QV, promptEn: "f", groundingSourceFingerprint: FP, groundingAssignmentFingerprint: "tga1:other" });
    await expect(stageReplacement(plan, deps(state), { reuseQuestionDraftIds: ["qd-left-0", "qd-foreign"] })).rejects.toMatchObject({ code: "STAGED_REUSE" });
  });
  it("12: the staged pool never exceeds the target: reusing 8 makes zero Question calls", async () => {
    const { state, plan } = withLeftovers();
    state.s.questionDrafts.push({ id: "qd-left-7", topicId: TOPIC, status: "pending_review", publishedQuestionId: null, ...QV, promptEn: "Leftover rocks question 7", ...plan.candidate.gate.provenance });
    const d = deps(state);
    const staged = await stageReplacement(plan, d, { reuseQuestionDraftIds: Array.from({ length: 8 }, (_, i) => `qd-left-${i}`) });
    expect(d.calls.questions).toBe(0);
    expect(staged.questionDraftIds).toHaveLength(8);
  });
  it("16: a failed completion (both bounded batches fail) leaves live assignment and content unchanged and flips nothing", async () => {
    const { state } = withLeftovers();
    const before = liveOnly(state.s);
    const flip = jest.fn();
    const out = await runStagedRepair({ topicIds: [TOPIC], apply: true, reuseStaged: true }, SCOPE, { ...deps(state, { yields: [new Error("failed validation"), new Error("failed validation")] }), flip } as any);
    expect(out.results[0].error.code).toBe("STAGED_INCOMPLETE");
    expect(flip).not.toHaveBeenCalled();
    expect(liveOnly(state.s)).toEqual(before);
  });
  it("17/18: reuse 7 + generate 1 -> atomic flip -> exactly 8 CURRENT servable, the old leftover LessonDraft untouched, zero student top-up", async () => {
    const { state } = withLeftovers();
    const d = deps(state, { yields: [1] });
    const out = await runStagedRepair({ topicIds: [TOPIC], apply: true, reuseStaged: true }, SCOPE, { ...d, flip: (plan: StagedRepairPlan, staged: any) => flipStagedReplacement(store(state), plan, staged) } as any);
    expect(out.results[0].status).toBe("COMPLETED");
    expect(d.calls).toEqual({ lesson: 1, questions: 1 });
    const v = view(state.s);
    const servable = questionServabilityByTopic([v as any], v.questions);
    expect(v.questions.filter(servable)).toHaveLength(8);
    expect(state.s.lessonDrafts.find((l: any) => l.id === "ld-leftover")).toMatchObject({ status: "pending_review", publishedTopicId: null });
    const st = students(state);
    expect((await st.practice.getAdaptiveQuestions("u", SUBJECT, TOPIC, 100)).questions).toHaveLength(8);
    expect(st.generate).not.toHaveBeenCalled();
  });
});
