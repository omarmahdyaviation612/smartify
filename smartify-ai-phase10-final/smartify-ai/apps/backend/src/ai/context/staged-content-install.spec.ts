import { subjectAccessFixture } from "../../common/subject-access.fixtures.testspec";
/**
 * CONTENT-ONLY STAGED LEGACY -> CURRENT INSTALL — regression suite (2026-10-04).
 * In-memory store whose $transaction runs on a deep copy and commits only on
 * success (real rollback semantics), the REAL production installers, and the
 * REAL Practice/Quiz services for runtime behaviour.
 */
import { PracticeService } from "../../practice/practice.service";
import { QuizzesService } from "../../quizzes/quizzes.service";
import { QuestionDraftGeneratorService } from "../../question-bank/question-draft-generator/question-draft-generator.service";
import { installAutoDraftIntoTopic } from "../../interactive-lesson/lesson-draft-generator/lesson-publish.service";
import { installAutoQuestionDraft } from "../../question-bank/question-draft-generator/question-publish.service";
import { assignmentRowHash, installStagedContent, planContentStaging, stageContent, stagedIdentity, validateStagedContent, type ContentInstallers } from "./staged-content-install";
import { parseArgs, runContentStaging, MAX_TOPICS_PER_RUN, type ContentDeps } from "../../scripts/stage-topic-content";
import { checkRepairable } from "../../scripts/replace-current-questions";
import { StagedRepairError, type StageDeps } from "./staged-assignment-repair";
import { classifyContentProvenance, evaluateTopicGroundingGate, questionServabilityByTopic } from "./topic-content-provenance.util";
import { DETERMINISTIC_ASSIGNMENT_VERSION } from "./topic-grounding-assignment.util";
import type { GroundingNotes } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

const TOPIC = "topicaddsub00000000001", UNIT = "unitaddsub000000000001", SUBJECT = "subject-maths";
const NOTES: GroundingNotes = {
  unitTitle: "Addition and subtraction", gradeLevel: "Year 3", subject: "Mathematics",
  learningObjectives: ["Add and subtract numbers."],
  concepts: [
    { name: "Addition", description: "Combining numbers to find a total.", sourcePages: [138], importance: "core" },
    { name: "Subtraction", description: "Taking one number away from another.", sourcePages: [140], importance: "core" },
  ],
  facts: [{ fact: "Adding ten to a number increases its tens digit by one.", sourcePages: [138], importance: "core" }],
  vocabulary: [{ term: "sum", meaning: "The result of an addition.", sourcePages: [138] }],
  skills: [], topicHints: [], scopeNotes: [],
};
const FP = "fp-y3-u14";
const UPDATED = new Date("2026-10-02T12:00:00.000Z");
const QV = { type: "MULTIPLE_CHOICE", difficulty: "EASY", promptAr: "سؤال", optionsJson: ["35", "25", "45"], correctAnswerJson: "35", explanationAr: "لأن" };
const assignmentRow = (method: string, extra: Record<string, unknown> = {}) => ({
  id: "asg-1", topicId: TOPIC, unitGroundingVersion: 1, unitSourceFingerprint: FP, assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION, method, confidence: "HIGH", status: "READY",
  matchedConceptNames: method === "SINGLE_TOPIC_FALLBACK" ? ["Addition", "Subtraction", "sum", "Adding ten to a number increases its tens digit by one."] : ["Addition", "Subtraction"],
  matchedHintTitles: null, mapperModel: null, mapperPromptVersion: null, reason: method, createdAt: UPDATED, updatedAt: UPDATED, ...extra,
});

type State = any;
function freshState(opts: { legacy?: number; method?: string } = {}): State {
  const s: State = {
    unit: { id: UNIT, subjectId: SUBJECT, groundingVersion: 1, groundingSourceFingerprint: FP, groundingNotesJson: NOTES, contentProvenanceEnforcedAt: null },
    assignment: assignmentRow(opts.method ?? "KEYWORD_OVERLAP"),
    topic: { id: TOPIC, unitId: UNIT, nameEn: "Addition and subtraction", nameAr: "الجمع والطرح", teachingStepsJson: [{ id: "old1", type: "INTRO", order: 1, objective: "legacy" }], groundingSourceFingerprintUsed: null, groundingAssignmentFingerprintUsed: null },
    lessons: [{ id: "lesson-old", topicId: TOPIC, isAiGenerated: true, isPlaceholder: false }], objectives: [{ id: "obj-old", lessonId: "lesson-old", descriptionEn: "old" }],
    lessonDrafts: [{ id: "ld-old", status: "published", publishedTopicId: TOPIC, targetUnitId: UNIT }],
    questionDrafts: [] as any[], questions: [] as any[], seq: 0, commits: [] as number[],
  };
  for (let i = 0; i < (opts.legacy ?? 8); i++) s.questions.push({ id: `q-legacy-${i}`, topicId: TOPIC, isPlaceholder: false, ...QV, promptEn: `Legacy ${i}`, explanationEn: "old", groundingSourceFingerprint: null, groundingAssignmentFingerprint: null, retiredAt: null });
  return s;
}
const view = (s: State) => ({ ...s.topic, groundingAssignment: s.assignment ? { ...s.assignment } : null, topicSourceEvidence: [], questions: s.questions.filter((q: any) => q.topicId === TOPIC), unit: { ...s.unit } });
const clone = (x: any) => structuredClone(x);
const isDate = (x: any) => Object.prototype.toString.call(x) === "[object Date]";
const match = (row: any, where: any) => Object.entries(where).every(([k, v]: any) => (isDate(v) ? isDate(row[k]) && row[k].getTime() === v.getTime() : v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v));
const servedCurrent = (s: State) => { const t = view(s) as any; const g = evaluateTopicGroundingGate(t); if (g.state !== "READY") return -1; const sv = questionServabilityByTopic([t], t.questions); return t.questions.filter((q: any) => sv(q) && classifyContentProvenance(q, g.provenance) === "CURRENT").length; };

/** Prisma-shaped store: every committed transaction records the served CURRENT count. */
function store(state: { s: State }, hooks: { failOnQuestionCreate?: number; failLesson?: boolean } = {}) {
  const api = (s: State) => ({
    topic: { findUnique: async () => clone(view(s)), update: async ({ data }: any) => { Object.assign(s.topic, clone(data)); return clone(s.topic); } },
    lessonDraft: {
      findUnique: async ({ where }: any) => clone(s.lessonDrafts.find((d: any) => d.id === where.id) ?? null),
      updateMany: async ({ where, data }: any) => { let n = 0; for (const d of s.lessonDrafts) if (match(d, where)) { Object.assign(d, data); n++; } return { count: n }; },
      update: async ({ where, data }: any) => { const d = s.lessonDrafts.find((x: any) => x.id === where.id); Object.assign(d, data); return clone(d); },
    },
    lesson: {
      findMany: async ({ where }: any) => clone(s.lessons.filter((l: any) => match(l, where))),
      deleteMany: async ({ where }: any) => { const n = s.lessons.length; s.lessons = s.lessons.filter((l: any) => !match(l, where)); return { count: n - s.lessons.length }; },
      create: async ({ data }: any) => { if (hooks.failLesson) throw new Error("simulated lesson install failure"); const l = { id: `lesson-${++s.seq}`, ...data }; s.lessons.push(l); return clone(l); },
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
        const q = { id: `q-new-${++s.seq}`, retiredAt: null, ...data }; s.questions.push(q); return clone(q);
      },
    },
    aIUsage: new Proxy({}, { get: () => { throw new Error("provider accounting touched during commit"); } }),
  });
  return {
    $transaction: async (fn: any, opts?: any) => {
      expect(opts?.isolationLevel).toBe("Serializable");
      const draft = clone(state.s);
      const result = await fn(api(draft));
      state.s = draft; // commit only on success
      state.s.commits.push(servedCurrent(state.s));
      return result;
    },
  };
}
const INSTALLERS: ContentInstallers = { installLesson: (tx, d, t, o, m) => installAutoDraftIntoTopic(tx, d, t, o, m), installQuestion: (tx, d) => installAutoQuestionDraft(tx, d) };

/** Fake provider-side staging: writes pending_review drafts stamped with the gate provenance. */
function stageDeps(state: { s: State }, opts: { question?: (i: number) => Record<string, unknown> } = {}) {
  const deps: StageDeps & { calls: { lesson: number; questions: number } } = {
    calls: { lesson: 0, questions: 0 },
    generateLesson: async (_t, gate) => {
      deps.calls.lesson++;
      const id = `ldstaged${String(++state.s.seq).padStart(16, "0")}`;
      state.s.lessonDrafts.push({ id, status: "pending_review", publishedTopicId: null, targetUnitId: UNIT, topicNameEn: "Addition and subtraction", topicNameAr: "الجمع والطرح",
        teachingStepsJson: [{ id: "s1", type: "INTRO", order: 1, objective: "Introduce addition of two-digit numbers." }, { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain subtraction as taking away." }],
        learningObjectivesJson: [{ objectiveEn: "Add two-digit numbers", objectiveAr: "جمع أعداد من رقمين" }] });
      return { draftId: id, objectivesEn: ["Add two-digit numbers"], metadata: { generationSource: "TEXTBOOK_GROUNDED", groundingVersionUsed: 1, generationPromptVersion: "auto-lesson-v1", provenance: gate.provenance } };
    },
    generateQuestions: async (_t, count, gate) => {
      deps.calls.questions++;
      const ids = [];
      for (let i = 0; i < count; i++) {
        const id = `qdstaged${String(++state.s.seq).padStart(16, "0")}`;
        state.s.questionDrafts.push({ id, topicId: TOPIC, status: "pending_review", publishedQuestionId: null, ...QV, promptEn: `What is the addition of 25 and 10 in case ${state.s.seq}?`, explanationEn: "Add them: 25 + 10 = 35.", ...gate.provenance, ...(opts.question?.(i) ?? {}) });
        ids.push(id);
      }
      return ids;
    },
    loadQuestionDrafts: async (ids) => clone(state.s.questionDrafts.filter((d: any) => ids.includes(d.id)).sort((a: any, b: any) => (a.id < b.id ? -1 : 1))),
  };
  return deps;
}
function contentDeps(state: { s: State }, hooks: Parameters<typeof store>[1] = {}, stageOpts: Parameters<typeof stageDeps>[1] = {}): ContentDeps & { calls: { lesson: number; questions: number } } {
  const sd = stageDeps(state, stageOpts);
  return Object.assign(sd, {
    loadTopic: async () => clone(view(state.s)),
    loadLessonDraft: async (id: string) => clone(state.s.lessonDrafts.find((d: any) => d.id === id) ?? null),
    loadPendingQuestionDrafts: async () => clone(state.s.questionDrafts.filter((d: any) => d.status === "pending_review" && !d.publishedQuestionId)),
    transaction: store(state, hooks),
    installers: INSTALLERS,
  });
}
/** REAL student services over the store's current state, with a provider spy. */
function students(state: { s: State }) {
  const generate = jest.fn();
  const prisma = {
    client: {
      studentProfile: { findUnique: jest.fn().mockResolvedValue({ id: "student-1", fullName: "S", subjects: [{ subjectId: SUBJECT, expiresAt: null }] }) },
      topic: { findUnique: jest.fn(async () => clone(view(state.s))), findMany: jest.fn(async () => [clone(view(state.s))]) },
      question: { findMany: jest.fn(async ({ where }: any) => clone(state.s.questions.filter((q: any) => (where.id ? where.id.in.includes(q.id) : true) && q.topicId === TOPIC).map((q: any) => ({ ...q, topic: clone(view(state.s)) })))), count: jest.fn() },
      questionDraft: { create: jest.fn() }, questionAttempt: { createMany: jest.fn() }, quizResult: { create: jest.fn().mockResolvedValue({ id: "r" }) }, aIUsage: { create: jest.fn() },
    },
  } as any;
  const usage = { assertWithinBudget: jest.fn(), estimateMaxChatCostUsd: jest.fn(), reserveBudget: jest.fn(), reconcileBudget: jest.fn(), releaseBudget: jest.fn() };
  const qgen = new QuestionDraftGeneratorService(prisma, { getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "m" }), getCostRates: jest.fn() } as any, { buildAutoQuestionBatchGenerationPrompt: jest.fn() } as any, usage as any, { autoPublish: jest.fn() } as any, { ensureTopicHasLesson: jest.fn() } as any);
  const acc = { getPerTopicAccuracy: jest.fn().mockResolvedValue([]), getTopicAccuracy: jest.fn().mockResolvedValue(null) } as any;
  return { practice: new PracticeService(subjectAccessFixture(prisma), acc, qgen), quizzes: new QuizzesService(subjectAccessFixture(prisma), acc, qgen, { send: jest.fn() } as any), generate, usage };
}
const ids = (qs: any[]) => qs.map((q) => q.id).sort();
const liveOnly = (s: State) => clone({ assignment: s.assignment, topic: s.topic, lessons: s.lessons, objectives: s.objectives, questions: s.questions, unit: s.unit });

/** stage via the tool, return the parsed commit spec. */
async function staged(opts: { legacy?: number; method?: string; question?: (i: number) => Record<string, unknown> } = {}) {
  const state = { s: freshState(opts) };
  const out = await runContentStaging({ mode: "STAGE", topicIds: [TOPIC] }, contentDeps(state, {}, { question: opts.question }));
  return { state, out, spec: out.results[0].staged?.commitSpec as string | undefined };
}
async function commit(state: { s: State }, spec: string, hooks: Parameters<typeof store>[1] = {}) {
  const deps = contentDeps(state, hooks);
  const out = await runContentStaging(parseArgs([`--commit=${spec}`]), deps);
  return { out, deps };
}

describe("1-2, 5, 19-23: staged content installs atomically to exactly 8 CURRENT; the assignment is byte-identical", () => {
  it.each([
    [8, "KEYWORD_OVERLAP"], [7, "KEYWORD_OVERLAP"], [8, "SINGLE_TOPIC_FALLBACK"], [7, "SINGLE_TOPIC_FALLBACK"], [8, "REVIEWED"],
  ])("TRANSITION + %i LEGACY + 0 CURRENT (%s): stage -> commit -> exactly 8 CURRENT, LEGACY kept but not served", async (legacy, method) => {
    const { state, out, spec } = await staged({ legacy, method });
    expect(out.results[0].status).toBe("STAGED");
    const before = clone(state.s.assignment);
    const legacyBefore = clone(state.s.questions);
    const { out: c } = await commit(state, spec!);
    expect(c.results[0].status).toBe("COMMITTED");
    expect(servedCurrent(state.s)).toBe(8);
    expect(state.s.commits).toEqual([8]); // the only committed transaction lands directly on 8 — never 1..7
    expect(state.s.assignment).toEqual(before); // 19-21: byte-identical, incl. updatedAt
    expect(assignmentRowHash(state.s.assignment)).toBe(c.results[0].install.assignmentHashAfter);
    for (const q of legacyBefore) expect(state.s.questions.find((x: any) => x.id === q.id)).toEqual(q); // 22: historical, untouched, not retired
    const t = view(state.s) as any;
    const sv = questionServabilityByTopic([t], t.questions);
    expect(legacyBefore.some((q: any) => sv(q))).toBe(false); // 23
    expect(classifyContentProvenance({ groundingSourceFingerprint: t.groundingSourceFingerprintUsed, groundingAssignmentFingerprint: t.groundingAssignmentFingerprintUsed }, (evaluateTopicGroundingGate(t) as any).provenance)).toBe("CURRENT");
  });
});

describe("3-4, 24: runtime before and after", () => {
  it("3-4: before commit the complete LEGACY pool is served and staged drafts are not", async () => {
    for (const legacy of [8, 7]) {
      const { state } = await staged({ legacy });
      expect(state.s.questionDrafts.filter((d: any) => d.status === "pending_review")).toHaveLength(8);
      const st = students(state);
      const r = await st.practice.getAdaptiveQuestions("u", SUBJECT, TOPIC, 100);
      expect(ids(r.questions)).toEqual(state.s.questions.map((q: any) => q.id).sort());
      expect(r.questions.every((q: any) => q.id.startsWith("q-legacy"))).toBe(true);
      expect(st.generate).not.toHaveBeenCalled();
    }
  });
  it("24: after the flip, direct submission of old LEGACY IDs is not graded; the CURRENT pool is served", async () => {
    const { state, spec } = await staged();
    await commit(state, spec!);
    const st = students(state);
    const r = await st.practice.getAdaptiveQuestions("u", SUBJECT, TOPIC, 100);
    expect(r.questions).toHaveLength(8);
    expect(r.questions.every((q: any) => q.id.startsWith("q-new"))).toBe(true);
    const fb = await st.practice.submitPractice("u", [{ questionId: "q-legacy-0", answer: "35" }, { questionId: r.questions[0].id, answer: "35" }]);
    expect(fb.feedback.map((f: any) => f.questionId)).toEqual([r.questions[0].id]);
    for (const type of ["topic_assessment", "lesson_check"] as const) {
      const q = await st.quizzes.getQuizQuestions("u", SUBJECT, type, TOPIC, () => 0.5);
      expect(q.questions.every((x: any) => x.id.startsWith("q-new"))).toBe(true);
    }
    expect(st.generate).not.toHaveBeenCalled();
  });
});

describe("6-9: any install failure rolls back everything", () => {
  it.each([[0, "#1"], [3, "#4"], [7, "#8"]])("failure publishing Question %s (index %i) -> nothing committed", async (n) => {
    const { state, spec } = await staged();
    const live = liveOnly(state.s), drafts = clone(state.s.questionDrafts);
    const { out } = await commit(state, spec!, { failOnQuestionCreate: n });
    expect(out.results[0].status).toBe("FAILED");
    expect(liveOnly(state.s)).toEqual(live);
    expect(state.s.questionDrafts).toEqual(drafts);
    expect(state.s.commits).toEqual([]);
  });
  it("5b: a faulty installer that lands on 7 CURRENT is caught by the post-condition and rolled back", async () => {
    const { state, spec } = await staged();
    const [, l, qs, identity] = spec!.split(":");
    const plan = planContentStaging(view(state.s));
    const live = liveOnly(state.s);
    let n = 0;
    const faulty: ContentInstallers = { ...INSTALLERS, installQuestion: async (tx, d) => (++n === 4 ? { id: "skipped" } : INSTALLERS.installQuestion(tx, d)) };
    await expect(installStagedContent(store(state) as any, plan, { lessonDraftId: l, questionDraftIds: qs.split("|"), identity }, faulty)).rejects.toThrow(/POSTCONDITION/);
    expect(liveOnly(state.s)).toEqual(live);
    expect(state.s.commits).toEqual([]);
  });
  it("9: lesson install failure -> nothing committed", async () => {
    const { state, spec } = await staged();
    const live = liveOnly(state.s);
    const { out } = await commit(state, spec!, { failLesson: true });
    expect(out.results[0].status).toBe("FAILED");
    expect(liveOnly(state.s)).toEqual(live);
    expect(state.s.commits).toEqual([]);
  });
});

describe("10-13: commit-time compare-and-check refuses with zero serving mutation", () => {
  const refuse = async (mutate: (s: State) => void, code: RegExp) => {
    const { state, spec } = await staged();
    mutate(state.s);
    const live = liveOnly(state.s);
    const { out } = await commit(state, spec!);
    expect(out.results[0].status).toBe("FAILED");
    expect(out.results[0].error.code).toMatch(code);
    expect(liveOnly(state.s)).toEqual(live);
    expect(state.s.commits).toEqual([]);
  };
  it("10: assignment row changed after staging (same slice, new updatedAt / reason)", () => refuse((s) => { s.assignment.updatedAt = new Date("2026-10-04T00:00:00Z"); s.assignment.reason = "touched"; }, /STAGED_IDENTITY/));
  it("11a: grounding content changed (same identity) -> assignment fingerprint differs", () => refuse((s) => { s.unit.groundingNotesJson = { ...NOTES, facts: [...NOTES.facts, { fact: "Another fact on page 138.", sourcePages: [138], importance: "core" }] }; }, /STAGED_IDENTITY/));
  it("11b: Unit grounding fingerprint changed -> assignment stale -> gate refuses", () => refuse((s) => { s.unit.groundingSourceFingerprint = "fp-new"; }, /GATE/));
  it("12a: assignment BLOCKED", () => refuse((s) => { s.assignment.status = "BLOCKED"; }, /GATE/));
  it("12b: assignment STALE (version)", () => refuse((s) => { s.assignment.unitGroundingVersion = 2; }, /GATE/));
  it("13: a CURRENT Question appeared after staging", () => refuse((s) => { const g: any = evaluateTopicGroundingGate(view(s) as any); s.questions.push({ id: "q-sneaky", topicId: TOPIC, isPlaceholder: false, ...QV, promptEn: "Sneaky addition?", explanationEn: "x", ...g.provenance, retiredAt: null }); }, /CURRENT_CONTENT_EXISTS/));
  it("13b: the live LEGACY lesson changed after staging", () => refuse((s) => { s.topic.teachingStepsJson = [{ id: "x", type: "INTRO", order: 1, objective: "changed" }]; }, /STAGED_IDENTITY/));
  it.each([
    ["CAS_ASSIGNMENT", (s: State) => { s.assignment.updatedAt = new Date("2026-10-04T00:00:00Z"); }],
    ["CAS_PROVENANCE", (s: State) => { s.unit.groundingNotesJson = { ...NOTES, facts: [...NOTES.facts, { fact: "Another fact on page 138.", sourcePages: [138], importance: "core" }] }; }],
    ["CAS_LESSON", (s: State) => { s.topic.teachingStepsJson = [{ id: "x", type: "INTRO", order: 1, objective: "changed" }]; }],
  ])("in-transaction compare-and-check against the stage-time plan: %s", async (code, mutate) => {
    const { state, spec } = await staged();
    const [, l, qs, identity] = spec!.split(":");
    const stagePlan = planContentStaging(view(state.s));
    (mutate as any)(state.s);
    const live = liveOnly(state.s);
    await expect(installStagedContent(store(state) as any, stagePlan, { lessonDraftId: l, questionDraftIds: qs.split("|"), identity }, INSTALLERS)).rejects.toThrow(new RegExp(code));
    expect(liveOnly(state.s)).toEqual(live);
    expect(state.s.commits).toEqual([]);
  });
  it("a modified staged draft no longer matches the reviewed identity", () => refuse((s) => { s.questionDrafts.find((d: any) => d.status === "pending_review").correctAnswerJson = "25"; }, /STAGED_IDENTITY/));
});

describe("14-18: invalid staged content can never be committed", () => {
  it("14: 7 or 9 staged drafts refuse (CLI and install)", async () => {
    const { state, spec } = await staged();
    const [t, l, qs, h] = spec!.split(":");
    const seven = qs.split("|").slice(0, 7);
    expect(() => parseArgs([`--commit=${t}:${l}:${seven.join("|")}:${h}`])).toThrow(/exactly 8/);
    expect(() => parseArgs([`--commit=${t}:${l}:${[...qs.split("|"), "qdextra0000000000000000"].join("|")}:${h}`])).toThrow(/exactly 8/);
    const plan = planContentStaging(view(state.s));
    const lesson = state.s.lessonDrafts.find((d: any) => d.id === l), drafts = state.s.questionDrafts.filter((d: any) => seven.includes(d.id));
    await expect(installStagedContent(store(state) as any, plan, { lessonDraftId: l, questionDraftIds: seven, identity: stagedIdentity(plan, lesson, drafts) }, INSTALLERS)).rejects.toThrow(/STAGED_INVALID/);
    expect(state.s.commits).toEqual([]);
  });
  const bad = async (question: (i: number) => Record<string, unknown>, err: RegExp) => {
    const { state, out } = await staged({ question });
    expect(out.results[0].status).toBe("FAILED");
    expect(out.results[0].error.code).toBe("STAGED_INVALID");
    expect(JSON.stringify(out.results[0].error.detail)).toMatch(err);
    expect(out.results[0].staged.commitSpec).toBeDefined(); // reported for review, but…
    const live = liveOnly(state.s);
    const { out: c } = await commit(state, out.results[0].staged.commitSpec);
    expect(c.results[0].status).toBe("FAILED"); // …the install refuses it too
    expect(liveOnly(state.s)).toEqual(live);
  };
  it("15: an arithmetic-INVALID candidate (the production defect's own shape)", () => bad((i) => (i === 2 ? { promptEn: "25 plus 10 equals 35. True or False?", optionsJson: ["True", "False"], correctAnswerJson: "False", type: "TRUE_FALSE", explanationEn: "Addition: 25 plus 10 equals 35 is False." } : {}), /arithmetic INVALID/));
  it("16: duplicate staged prompts", () => bad((i) => (i < 2 ? { promptEn: "What is the addition of 25 and 10?" } : {}), /duplicate staged prompt/));
  it("17: final-pool grounding failure (no anchor anywhere)", () => bad(() => ({ promptEn: `Which planet is largest, case ${Math.random()}?`, explanationEn: "Jupiter is largest." }), /final pool grounding/));
  it("18: a staged draft with another provenance is never committable (staging drops it; an edited draft fails validation and identity)", async () => {
    const { state, spec } = await staged({ question: (i) => (i === 5 ? { groundingAssignmentFingerprint: "tga1:other" } : {}) });
    const plan = planContentStaging(view(state.s));
    const [, l, qs] = spec!.split(":");
    expect(state.s.questionDrafts.filter((d: any) => qs.split("|").includes(d.id)).every((d: any) => d.groundingAssignmentFingerprint === plan.gate.provenance.groundingAssignmentFingerprint)).toBe(true);
    const drafts = state.s.questionDrafts.filter((d: any) => qs.split("|").includes(d.id)).map((d: any, i: number) => (i === 0 ? { ...d, groundingAssignmentFingerprint: "tga1:other" } : d));
    expect(validateStagedContent(plan, state.s.lessonDrafts.find((d: any) => d.id === l), drafts).join(" ")).toMatch(/candidate provenance/);
    state.s.questionDrafts.find((d: any) => d.id === drafts[0].id).groundingAssignmentFingerprint = "tga1:other";
    const live = liveOnly(state.s);
    const { out } = await commit(state, spec!);
    expect(out.results[0].error.code).toBe("STAGED_IDENTITY");
    expect(liveOnly(state.s)).toEqual(live);
  });
  it("validateStagedContent itself flags each class", () => {
    const state = { s: freshState() }; const plan = planContentStaging(view(state.s));
    expect(validateStagedContent(plan, null, [])).toEqual(expect.arrayContaining(["staged LessonDraft missing", "expected exactly 8 staged QuestionDrafts, found 0"]));
  });
});

describe("25-28: tool modes, provider isolation and the unchanged CURRENT replacement path", () => {
  it("25: the atomic CURRENT replacement tool still refuses LEGACY targets (behaviour unchanged)", () => {
    const state = { s: freshState() };
    expect(() => checkRepairable({ ...view(state.s), questions: state.s.questions.map((q: any) => ({ ...q, _count: { attempts: 0 } })) }, ["q-legacy-0"])).toThrow(/not an active CURRENT Question/);
  });
  it("26: --commit makes no provider call", async () => {
    const { state, spec } = await staged();
    const { deps } = await commit(state, spec!);
    expect(deps.calls).toEqual({ lesson: 0, questions: 0 });
  });
  it("27: dry-run makes zero provider calls and zero writes", async () => {
    const state = { s: freshState() };
    const before = clone(state.s);
    const deps = contentDeps(state);
    const out = await runContentStaging(parseArgs([`--topicIds=${TOPIC}`]), deps);
    expect(out.results[0].status).toBe("PLANNED");
    expect(deps.calls).toEqual({ lesson: 0, questions: 0 });
    expect(state.s).toEqual(before);
  });
  it("28: --stage writes pending drafts only; serving content is untouched and nothing is installed", async () => {
    const state = { s: freshState() };
    const live = liveOnly(state.s);
    const out = await runContentStaging(parseArgs([`--topicIds=${TOPIC}`, "--stage"]), contentDeps(state));
    expect(out.results[0].status).toBe("STAGED");
    expect(liveOnly(state.s)).toEqual(live);
    expect(state.s.commits).toEqual([]);
    expect(state.s.questionDrafts.every((d: any) => d.status === "pending_review" && !d.publishedQuestionId)).toBe(true);
    expect(out.results[0].staged.questions).toHaveLength(8);
    expect(out.results[0].staged.lesson.steps.length).toBeGreaterThan(0);
  });
  it("stage refuses when pending staged drafts already exist (nothing reused or deleted); a Topic with CURRENT content is refused", async () => {
    const { state } = await staged();
    const again = await runContentStaging({ mode: "STAGE", topicIds: [TOPIC] }, contentDeps(state));
    expect(again.results[0].error.code).toBe("STAGED_LEFTOVERS_PRESENT");
    const { spec } = await staged();
    const s2 = await staged(); await commit(s2.state, s2.spec!);
    expect(() => planContentStaging(view(s2.state.s))).toThrow(StagedRepairError);
    expect(spec).toBeDefined();
  });
  it("CLI: explicit Topics only, max 10, stage and commit are separate invocations", () => {
    expect(() => parseArgs([])).toThrow(/--topicIds/);
    expect(() => parseArgs([`--topicIds=${Array.from({ length: MAX_TOPICS_PER_RUN + 1 }, (_, i) => `topic${String(i).padStart(17, "0")}`).join(",")}`])).toThrow(/at most/);
    expect(() => parseArgs([`--topicIds=${TOPIC}`, `--commit=${TOPIC}:x:y:z`])).toThrow(/exclusive/);
    expect(() => parseArgs([`--commit=${TOPIC}:notahash`])).toThrow(/malformed/);
    expect(parseArgs([`--topicIds=${TOPIC}`, "--stage"])).toEqual({ mode: "STAGE", topicIds: [TOPIC] });
  });
  it("stageContent reuses the staged-repair primitive (one lesson, bounded Question batches)", async () => {
    const state = { s: freshState() };
    const deps = stageDeps(state);
    const r = await stageContent(planContentStaging(view(state.s)), deps);
    expect(r.questionDraftIds).toHaveLength(8);
    expect(deps.calls).toEqual({ lesson: 1, questions: 1 });
  });
});

// ---------------------------------------------------------------------------
// SURGICAL QUESTION RE-STAGE (2026-10-04): keep the staged lesson + good drafts,
// reject explicitly listed drafts, generate only the missing count.
// ---------------------------------------------------------------------------
import { QuestionPublishService } from "../../question-bank/question-draft-generator/question-publish.service";
import { checkGroundingConsistency } from "./grounding-consistency-validator";
import { planSurgicalRestage } from "./staged-content-install";

/** Content deps + surgical extras; the REAL QuestionPublishService.reject() over the store; generation calls recorded. */
function surgicalDeps(state: { s: State }, opts: { replacement?: (i: number) => Record<string, unknown>; failGeneration?: boolean; activity?: number } = {}) {
  const base = contentDeps(state);
  const calls = { lesson: 0, questionBatches: [] as Array<{ count: number; acceptedPool: string[] }> };
  const publisher = new QuestionPublishService({ client: { questionDraft: {
    findUnique: async ({ where }: any) => clone(state.s.questionDrafts.find((d: any) => d.id === where.id) ?? null),
    update: async ({ where, data }: any) => { const d = state.s.questionDrafts.find((x: any) => x.id === where.id); Object.assign(d, data); return clone(d); },
  } } } as any);
  const deps: ContentDeps = {
    ...base,
    generateLesson: async (...a) => { calls.lesson++; return base.generateLesson(...a); },
    generateQuestions: async (_t, count, gate, _objectives, acceptedPool) => {
      calls.questionBatches.push({ count, acceptedPool: acceptedPool.map((q) => q.promptEn) });
      if (opts.failGeneration) throw new Error("Auto question batch generation failed validation after 2 attempt(s).");
      const ids = [];
      for (let i = 0; i < count; i++) {
        const id = `qdrestage${String(++state.s.seq).padStart(15, "0")}`;
        state.s.questionDrafts.push({ id, topicId: TOPIC, status: "pending_review", publishedQuestionId: null, ...QV, promptEn: `Replacement addition question ${state.s.seq}: 12 plus 8?`, optionsJson: ["20", "18", "22"], correctAnswerJson: "20", explanationEn: "Add: 12 + 8 = 20.", ...gate.provenance, ...(opts.replacement?.(i) ?? {}) });
        ids.push(id);
      }
      return ids;
    },
    loadPendingLessonDraftIds: async (unitId) => state.s.lessonDrafts.filter((d: any) => d.targetUnitId === unitId && d.status === "pending_review" && !d.publishedTopicId).map((d: any) => d.id),
    countActivity: async () => opts.activity ?? 0,
    rejectQuestionDraft: (id, reason) => publisher.reject(id, undefined, reason),
  };
  return { deps, calls };
}
/** Stage a full set, then build the surgical spec that keeps 7 and rejects the 4th draft. */
async function stagedForSurgery(stageOpts: { question?: (i: number) => Record<string, unknown> } = {}) {
  const { state, spec } = await staged(stageOpts);
  const [topicId, lessonDraftId, qs, identity] = spec!.split(":");
  const all = qs.split("|");
  const reject = [all[3]], keep = all.filter((id) => !reject.includes(id));
  const argv = (k = keep, r = reject, id = identity) => [`--restage-questions=${topicId}:${lessonDraftId}:${k.join("|")}:${r.join("|")}:${id}`];
  return { state, spec: spec!, lessonDraftId, keep, reject, identity, argv };
}
const draftOf = (s: State, id: string) => s.questionDrafts.find((d: any) => d.id === id);

describe("SURGICAL RE-STAGE — keep lesson + 7, reject 1, generate exactly 1 against the accepted pool", () => {
  it("1-3, 19-22, 24, 27-28: reuses the lesson (0 lesson calls) and 7 drafts, rejects only the listed one, generates exactly 1 with the 7 as acceptedPool; fresh identity", async () => {
    const { state, lessonDraftId, keep, reject, identity, argv } = await stagedForSurgery();
    const keptBefore = clone(keep.map((id) => draftOf(state.s, id))), lessonBefore = clone(state.s.lessonDrafts.find((d: any) => d.id === lessonDraftId));
    const others = clone(state.s.questionDrafts.filter((d: any) => !keep.includes(d.id) && !reject.includes(d.id)));
    const live = liveOnly(state.s);
    const { deps, calls } = surgicalDeps(state);
    const out = await runContentStaging(parseArgs([...argv(), "--stage"]), deps);
    const r = out.results[0];
    expect(r.status).toBe("STAGED");
    expect(calls.lesson).toBe(0); // 1, 27
    expect(calls.questionBatches).toHaveLength(1); // 28
    expect(calls.questionBatches[0].count).toBe(1); // 2
    expect(calls.questionBatches[0].acceptedPool.sort()).toEqual(keptBefore.map((d: any) => d.promptEn).sort()); // 3
    expect(r.staged.lessonDraftId).toBe(lessonDraftId);
    expect(r.staged.questionDraftIds).toHaveLength(8);
    expect(keep.every((id) => r.staged.questionDraftIds.includes(id))).toBe(true);
    expect(draftOf(state.s, reject[0]).status).toBe("rejected"); // 19
    expect(state.s.questionDrafts.filter((d: any) => d.status === "rejected").map((d: any) => d.id)).toEqual(reject);
    expect(keep.map((id) => draftOf(state.s, id))).toEqual(keptBefore); // 20: byte-identical, still pending
    expect(state.s.lessonDrafts.find((d: any) => d.id === lessonDraftId)).toEqual(lessonBefore); // 21
    const fresh = r.staged.questionDraftIds.find((id: string) => !keep.includes(id));
    expect(draftOf(state.s, fresh)).toMatchObject({ status: "pending_review", publishedQuestionId: null }); // 22
    expect(state.s.questions.some((q: any) => q.id === fresh)).toBe(false);
    expect(liveOnly(state.s)).toEqual(live);
    expect(r.staged.identity).not.toBe(identity); // 24
    expect(r.staged.validation.ok).toBe(true);
    expect(others).toEqual([]);
  });

  it("23, 25-26: serving stays LEGACY before commit; the OLD spec is refused; the NEW spec commits atomically to 8 CURRENT", async () => {
    const { state, spec, argv } = await stagedForSurgery();
    const { deps } = surgicalDeps(state);
    const out = await runContentStaging(parseArgs([...argv(), "--stage"]), deps);
    const st = students(state);
    const r0 = await st.practice.getAdaptiveQuestions("u", SUBJECT, TOPIC, 100);
    expect(r0.questions.every((q: any) => q.id.startsWith("q-legacy"))).toBe(true); // 23
    const live = liveOnly(state.s);
    const old = await commit(state, spec);
    expect(old.out.results[0].status).toBe("FAILED"); // 25: the rejected draft breaks the old set
    expect(liveOnly(state.s)).toEqual(live);
    const fresh = await commit(state, out.results[0].staged.commitSpec);
    expect(fresh.out.results[0].status).toBe("COMMITTED"); // 26
    expect(servedCurrent(state.s)).toBe(8);
    expect(state.s.commits).toEqual([8]);
  });

  it("4: a replacement duplicating a kept Question makes the set uncommittable (final pool judged 7 + 1)", async () => {
    const { state, keep, argv } = await stagedForSurgery();
    const dupPrompt = draftOf(state.s, keep[0]).promptEn;
    const { deps } = surgicalDeps(state, { replacement: () => ({ promptEn: dupPrompt }) });
    const out = await runContentStaging(parseArgs([...argv(), "--stage"]), deps);
    expect(out.results[0].error.code).toBe("STAGED_INVALID");
    expect(JSON.stringify(out.results[0].error.detail)).toMatch(/duplicate staged prompt/);
  });

  it("5: final-pool grounding is evaluated over 7 + 1 (an anchor-free replacement passes only because the kept 7 anchor the pool)", async () => {
    const { state, argv } = await stagedForSurgery();
    const replacement = { promptEn: "Is a tens digit the second digit from the right?", explanationEn: "The tens place sits left of the ones place.", optionsJson: ["Yes", "No", "Maybe"], correctAnswerJson: "Yes" };
    const plan = planContentStaging(view(state.s));
    expect(checkGroundingConsistency([replacement.promptEn, replacement.explanationEn], plan.gate.slice, { wordForms: true }).join(" ")).toMatch(/does not reference/); // alone: fails
    const { deps } = surgicalDeps(state, { replacement: () => replacement });
    const out = await runContentStaging(parseArgs([...argv(), "--stage"]), deps);
    expect(out.results[0].status).toBe("STAGED"); // as part of the final 8: passes
  });

  it("6: an arithmetic-INVALID replacement makes the set uncommittable", async () => {
    const { state, argv } = await stagedForSurgery();
    const { deps } = surgicalDeps(state, { replacement: () => ({ promptEn: "25 plus 10 equals 35. True or False?", optionsJson: ["True", "False"], correctAnswerJson: "False", type: "TRUE_FALSE", explanationEn: "Addition: 25 plus 10 equals 35 is False." }) });
    const out = await runContentStaging(parseArgs([...argv(), "--stage"]), deps);
    expect(out.results[0].error.code).toBe("STAGED_INVALID");
    expect(JSON.stringify(out.results[0].error.detail)).toMatch(/arithmetic INVALID/);
  });

  it("29: generation failure after rejection — serving unchanged, kept drafts + lesson intact, rejected stays rejected, state reported", async () => {
    const { state, lessonDraftId, keep, reject, argv } = await stagedForSurgery();
    const live = liveOnly(state.s), keptBefore = clone(keep.map((id) => draftOf(state.s, id)));
    const { deps } = surgicalDeps(state, { failGeneration: true });
    const out = await runContentStaging(parseArgs([...argv(), "--stage"]), deps);
    const r = out.results[0];
    expect(r.status).toBe("FAILED");
    expect(r.error.code).toBe("STAGED_INCOMPLETE");
    expect(r.draftState).toMatchObject({ rejected: reject, keptPending: keep, lessonPending: lessonDraftId });
    expect(liveOnly(state.s)).toEqual(live);
    expect(keep.map((id) => draftOf(state.s, id))).toEqual(keptBefore);
    expect(draftOf(state.s, reject[0]).status).toBe("rejected");
    expect(state.s.lessonDrafts.find((d: any) => d.id === lessonDraftId).status).toBe("pending_review");
  });
});

describe("SURGICAL RE-STAGE — preflight refusals: zero rejection, zero provider calls (7-18)", () => {
  const refused = async (mutate: (x: Awaited<ReturnType<typeof stagedForSurgery>>) => string[] | void, code: RegExp, depOpts: Parameters<typeof surgicalDeps>[1] = {}) => {
    const x = await stagedForSurgery();
    const argv = mutate(x) ?? x.argv();
    const draftsBefore = clone(x.state.s.questionDrafts), lessonsBefore = clone(x.state.s.lessonDrafts), live = liveOnly(x.state.s);
    const { deps, calls } = surgicalDeps(x.state, depOpts);
    const out = await runContentStaging(parseArgs([...argv, "--stage"]), deps);
    expect(out.results[0].status).toBe("FAILED");
    expect(out.results[0].error.code).toMatch(code);
    expect(out.results[0].draftState).toBeUndefined(); // 18: nothing rejected
    expect(x.state.s.questionDrafts).toEqual(draftsBefore);
    expect(x.state.s.lessonDrafts).toEqual(lessonsBefore);
    expect(liveOnly(x.state.s)).toEqual(live);
    expect(calls.lesson).toBe(0);
    expect(calls.questionBatches).toEqual([]);
  };
  it("7: the reused lesson belongs to another Unit", () => refused((x) => { x.state.s.lessonDrafts.find((d: any) => d.id === x.lessonDraftId).targetUnitId = "unit-other"; }, /ORIGINAL_SET_INVALID/));
  it("8: the reused lesson was edited after staging", () => refused((x) => { x.state.s.lessonDrafts.find((d: any) => d.id === x.lessonDraftId).teachingStepsJson[0].objective = "Edited addition intro."; }, /PREVIOUS_IDENTITY/));
  it("9: a kept draft has another provenance", () => refused((x) => { draftOf(x.state.s, x.keep[2]).groundingAssignmentFingerprint = "tga1:other"; }, /ORIGINAL_SET_INVALID/));
  it("10a: a kept draft was edited", () => refused((x) => { draftOf(x.state.s, x.keep[1]).correctAnswerJson = "25"; draftOf(x.state.s, x.keep[1]).optionsJson = ["25", "35", "45"]; }, /PREVIOUS_IDENTITY/));
  it("10b: a kept draft is structurally invalid", () => refused((x) => { draftOf(x.state.s, x.keep[1]).optionsJson = ["35"]; }, /ORIGINAL_SET_INVALID/));
  it("12: an unknown pending QuestionDraft for the Topic", () => refused((x) => { x.state.s.questionDrafts.push({ ...clone(draftOf(x.state.s, x.keep[0])), id: "qdunknown0000000000000001", promptEn: "Unknown pending addition?" }); }, /STAGED_LEFTOVERS_PRESENT/));
  it("13: an unknown pending LessonDraft for the Unit", () => refused((x) => { x.state.s.lessonDrafts.push({ ...clone(x.state.s.lessonDrafts.find((d: any) => d.id === x.lessonDraftId)), id: "ldunknown0000000000000001" }); }, /STAGED_LEFTOVERS_PRESENT/));
  it("14: CURRENT content appeared meanwhile", () => refused((x) => { const g: any = evaluateTopicGroundingGate(view(x.state.s) as any); x.state.s.questions.push({ id: "q-sneaky", topicId: TOPIC, isPlaceholder: false, ...QV, promptEn: "Sneaky?", explanationEn: "x", ...g.provenance, retiredAt: null }); }, /CURRENT_CONTENT_EXISTS/));
  it("15: the assignment row changed", () => refused((x) => { x.state.s.assignment.updatedAt = new Date("2026-10-04T05:00:00Z"); }, /PREVIOUS_IDENTITY/));
  it("16a: grounding content changed (assignment fingerprint differs)", () => refused((x) => { x.state.s.unit.groundingNotesJson = { ...NOTES, facts: [...NOTES.facts, { fact: "Another fact on page 138.", sourcePages: [138], importance: "core" }] }; }, /ORIGINAL_SET_INVALID/)); // drafts no longer carry the (new) gate provenance
  it("16b: Unit grounding fingerprint changed (assignment stale)", () => refused((x) => { x.state.s.unit.groundingSourceFingerprint = "fp-new"; }, /GATE/));
  it("17: student activity", () => refused(() => undefined, /ACTIVITY/, { activity: 1 }));
  it("the reject draft already rejected / not pending", () => refused((x) => { draftOf(x.state.s, x.reject[0]).status = "rejected"; }, /ORIGINAL_SET_INVALID/));
  it("a wrong previous identity", () => refused((x) => x.argv(x.keep, x.reject, "f".repeat(64)), /PREVIOUS_IDENTITY/));
});

describe("SURGICAL RE-STAGE — CLI and unchanged paths (11, 30-32)", () => {
  it("11: explicit, disjoint, complete specs only; dry-run by default", async () => {
    const { state, keep, reject, argv } = await stagedForSurgery();
    const T = TOPIC, L = "ld0000000000000000000001", H = "a".repeat(64);
    expect(() => parseArgs([`--restage-questions=${T}:${L}:${keep.join("|")}:${keep[0]}:${H}`])).toThrow(/both to keep and to reject/);
    expect(() => parseArgs([`--restage-questions=${T}:${L}:${keep.slice(0, 6).join("|")}:${reject.join("|")}:${H}`])).toThrow(/full original 8/);
    expect(() => parseArgs([`--restage-questions=${T}:${L}:${keep.join("|")}::${H}`])).toThrow(/malformed/);
    expect(() => parseArgs([...argv(), `--topicIds=${T}`])).toThrow(/exclusive/);
    expect(() => planSurgicalRestage(view(state.s), { topicId: T, lessonDraftId: L, keepQuestionDraftIds: keep, rejectQuestionDraftIds: [keep[0]], previousIdentity: H }, { lessonDraft: null, drafts: [], pendingQuestionDraftIds: [], pendingLessonDraftIds: [], activity: 0 })).toThrow(/both to keep and to reject/);
    expect(parseArgs(argv()).mode).toBe("RESTAGE_DRY_RUN");
    const before = clone(state.s);
    const { deps, calls } = surgicalDeps(state);
    const out = await runContentStaging(parseArgs(argv()), deps);
    expect(out.results[0]).toMatchObject({ status: "PLANNED", replacementsToGenerate: 1, lessonProviderCalls: 0 });
    expect(state.s).toEqual(before);
    expect(calls).toEqual({ lesson: 0, questionBatches: [] });
  });
  it("30: a normal fresh --stage still generates a new lesson and a full 8 (unchanged)", async () => {
    const state = { s: freshState() };
    const deps = stageDeps(state);
    const r = await stageContent(planContentStaging(view(state.s)), deps);
    expect(deps.calls).toEqual({ lesson: 1, questions: 1 });
    expect(r.questionDraftIds).toHaveLength(8);
  });
});
