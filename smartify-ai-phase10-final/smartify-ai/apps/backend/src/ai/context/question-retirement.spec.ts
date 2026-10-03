/**
 * Question retirement + atomic single-Question replacement (2026-10-03).
 * A retired Question (retiredAt set) is historical: never served, graded,
 * revealed or counted, and never part of CURRENT-vs-LEGACY precedence. Its
 * provenance is unchanged. Real Practice/Quiz/Onboarding/generator services
 * over mocked Prisma; the replacement swap over an in-memory store that commits
 * only on success.
 */
import { PracticeService } from "../../practice/practice.service";
import { QuizzesService } from "../../quizzes/quizzes.service";
import { OnboardingService } from "../../onboarding/onboarding.service";
import { QuestionDraftGeneratorService } from "../../question-bank/question-draft-generator/question-draft-generator.service";
import { installAutoQuestionDraft } from "../../question-bank/question-draft-generator/question-publish.service";
import { planTopic, runRegeneration } from "../../scripts/regenerate-topic-content";
import { strictReadinessBlockers } from "../../scripts/enforce-content-provenance";
import { verifyCommitted } from "../../scripts/repair-sole-topic-staged";
import { atomicReplace, parseArgs, planReplacement, RETIRED_REASON, validateCandidate, MAX_REPLACEMENTS_PER_RUN } from "../../scripts/replace-current-questions";
import { classifyUnitContentReadiness } from "./unit-content-readiness.util";
import { classifyContentProvenance, isActiveCurrentQuestion, questionServabilityByTopic, QUESTION_PROVENANCE_SELECT } from "./topic-content-provenance.util";
import { currentGateProvenance, gateAssignment, gateUnit, withReadyGate } from "./topic-content-gate.fixtures.testspec";

const TOPIC = "topic-1";
const STRICT_AT = new Date("2026-10-02T20:00:00Z");
const STUDENT = { id: "student-1", fullName: "S", subjects: [{ subjectId: "subject-1" }] };
const cur = currentGateProvenance();
const RETIRED = { retiredAt: new Date("2026-10-03T13:00:00Z"), retiredReason: RETIRED_REASON };
const Q = (id: string, prov: object, extra: Record<string, unknown> = {}): any => ({ id, topicId: TOPIC, type: "MULTIPLE_CHOICE", difficulty: "EASY", isPlaceholder: false, createdAt: new Date(), promptEn: `Addition question ${id}?`, promptAr: "س", optionsJson: ["1", "2", "3"], correctAnswerJson: "1", explanationEn: `Add the numbers for ${id}.`, explanationAr: "ل", retiredAt: null, ...prov, ...extra });
const LEG = { groundingSourceFingerprint: null, groundingAssignmentFingerprint: null };
const active = (n: number) => Array.from({ length: n }, (_, i) => Q(`current-${i}`, cur));
const retired = (id = "retired-0") => Q(id, cur, RETIRED);
const legacy = (n: number) => Array.from({ length: n }, (_, i) => Q(`legacy-${i}`, LEG));

function topicRow(over: Record<string, unknown> = {}, unitOver: Record<string, unknown> = {}) {
  const base = { id: TOPIC, nameEn: "Topic", nameAr: "موضوع", unitId: "unit-gate", teachingStepsJson: [{ id: "s1" }], groundingSourceFingerprintUsed: cur.groundingSourceFingerprint, groundingAssignmentFingerprintUsed: cur.groundingAssignmentFingerprint, lessons: [{ isPlaceholder: false, objectives: [] }], ...over };
  const unitExtra = { nameEn: "Unit", subjectId: "subject-1", subject: { nameEn: "Mathematics", sourceFile: "eg/g5/math.pdf", grade: { nameEn: "Grade 5", curriculum: { nameEn: "EG" } } }, _count: { topics: 1 } };
  return withReadyGate({ ...base, unit: unitExtra }, unitOver);
}
/** Real student services + generator over a pool; provider generation observable. */
function services(topic: any, pool: any[]) {
  const generate = jest.fn().mockResolvedValue({ content: JSON.stringify({ questions: [] }), inputTokens: 1, outputTokens: 1 });
  const findMany = jest.fn().mockImplementation(async ({ where }: any) => {
    const rows = pool.filter((q) => (where.id ? where.id.in.includes(q.id) : (where.topicId?.in ?? [where.topicId]).includes(q.topicId)) && (where.isPlaceholder === undefined || q.isPlaceholder === where.isPlaceholder));
    return where.id ? rows.map((q) => ({ ...q, topic })) : rows.map((q) => ({ ...q, topic: { unit: { subject: { id: "subject-1", nameEn: "Maths", nameAr: "ر" } } } }));
  });
  const prisma = {
    client: {
      topic: { findUnique: jest.fn().mockResolvedValue(topic), findMany: jest.fn().mockResolvedValue([topic]) },
      question: { findMany, count: jest.fn() },
      questionDraft: { create: jest.fn() },
      aIUsage: { create: jest.fn().mockResolvedValue(undefined) },
      studentProfile: { findUnique: jest.fn().mockResolvedValue(STUDENT) },
      studentSubject: { findMany: jest.fn().mockResolvedValue([{ subject: { id: "subject-1", nameEn: "Maths", nameAr: "ر", units: [{ ...topic.unit, topics: [{ ...topic, unit: undefined }] }] } }]) },
      questionAttempt: { createMany: jest.fn() },
      quizResult: { create: jest.fn().mockResolvedValue({ id: "r" }) },
      assessment: { create: jest.fn().mockResolvedValue({ id: "a" }) },
      learningPlan: { create: jest.fn().mockResolvedValue({ id: "l" }) },
    },
  } as any;
  const usage = { assertWithinBudget: jest.fn(), estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01), reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "r" }), reconcileBudget: jest.fn().mockResolvedValue(undefined), releaseBudget: jest.fn().mockResolvedValue(undefined) };
  const lessonGen = { ensureTopicHasLesson: jest.fn().mockResolvedValue(topic) };
  const generator = new QuestionDraftGeneratorService(prisma, { getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "m" }), getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0, costPerOutputToken: 0 }) } as any, { buildAutoQuestionBatchGenerationPrompt: jest.fn().mockReturnValue("p") } as any, usage as any, { autoPublish: jest.fn() } as any, lessonGen as any);
  const acc = { getPerTopicAccuracy: jest.fn().mockResolvedValue([]), getTopicAccuracy: jest.fn().mockResolvedValue(null) } as any;
  return { prisma, generate, generator, practice: new PracticeService(prisma, acc, generator), quizzes: new QuizzesService(prisma, acc, generator, { send: jest.fn() } as any), onboarding: new OnboardingService(prisma, generator) };
}
const ids = (qs: any[]) => qs.map((q) => q.id);

describe("retirement — canonical servability", () => {
  it("1/20: a retired CURRENT Question is not servable, yet its provenance is unchanged (still CURRENT)", () => {
    const t = topicRow({}, { contentProvenanceEnforcedAt: STRICT_AT });
    const pool = [...active(8), retired()];
    const servable = questionServabilityByTopic([t as any], pool);
    expect(pool.filter(servable).map((q) => q.id)).toEqual(ids(active(8)));
    expect(classifyContentProvenance(retired(), cur)).toBe("CURRENT");
    expect(isActiveCurrentQuestion(retired(), cur)).toBe(false);
  });
  it("3: a retired CURRENT does not suppress LEGACY precedence in TRANSITION", () => {
    const t = topicRow();
    const pool = [retired(), ...legacy(8)];
    expect(pool.filter(questionServabilityByTopic([t as any], pool)).map((q) => q.id)).toEqual(ids(legacy(8)));
  });
  it("canonical select loads retiredAt", () => {
    expect(QUESTION_PROVENANCE_SELECT).toMatchObject({ retiredAt: true });
  });
});

describe("retirement — counts and readiness", () => {
  it("2/4: retired CURRENT rows never satisfy STRICT readiness", () => {
    const t = topicRow({ questions: [...active(7), retired()] });
    expect(strictReadinessBlockers([t as any])).toEqual([`${TOPIC}: only 7/8 CURRENT Questions`]);
    expect(strictReadinessBlockers([topicRow({ questions: Array.from({ length: 8 }, (_, i) => retired(`r-${i}`)) }) as any])).toEqual([`${TOPIC}: only 0/8 CURRENT Questions`]);
    expect(strictReadinessBlockers([topicRow({ questions: [...active(8), retired()] }) as any])).toEqual([]);
  });
  it("18: normal regeneration counts only active CURRENT (7 active + 1 retired plans 1)", () => {
    const plan = planTopic(topicRow({ questions: [...active(7), retired()] }) as any, { lesson: true, questions: true });
    expect(plan).toMatchObject({ questions: { CURRENT: 7, LEGACY: 0, MISMATCH: 0 }, questionsToGenerate: 1, lessonAction: "SKIP_CURRENT" });
  });
  it("6: completion requests only the active shortfall and never counts the retired row", async () => {
    const state = [...active(7), retired()];
    const requested: number[] = [];
    const deps = {
      loadTopic: jest.fn().mockImplementation(async () => topicRow({ questions: [...state] })),
      regenerateLesson: jest.fn(),
      generateQuestions: jest.fn().mockImplementation(async (_id: string, n: number) => { requested.push(n); state.push(Q(`new-${n}`, cur)); return 1; }),
    };
    const out = await runRegeneration({ topicIds: [TOPIC], apply: true, lesson: true, questions: true }, deps);
    expect(requested).toEqual([1]);
    expect(out.results[0]).toMatchObject({ status: "COMPLETED", final: { currentQuestions: 8 } });
  });
  it("16: the readiness classifier ignores retired rows for completion and reports them as history", () => {
    const unit = (qs: any[]) => ({ ...gateUnit({ contentProvenanceEnforcedAt: STRICT_AT }), topics: [{ ...topicRow({ questions: qs }), unit: undefined }] }) as any;
    const ok = classifyUnitContentReadiness(unit([...active(8), retired()]));
    expect(ok).toMatchObject({ class: "ALREADY_STRICT", qCurrent: 8, historicalNonServable: { retiredQuestions: 1 } });
    const short = classifyUnitContentReadiness(unit([...active(7), retired()]));
    expect(short.class).toBe("INVALID_STATE");
    expect(short.issues).toContain(`${TOPIC}: STRICT_POOL_UNDER_TARGET 7/8`);
  });
  it("17: the staged replacement's committed-state verification counts only active CURRENT", () => {
    const t = { ...topicRow({ questions: [...active(7), retired()] }, { contentProvenanceEnforcedAt: STRICT_AT }) };
    const errors = verifyCommitted(t as any, { candidateAssignmentFingerprint: cur.groundingAssignmentFingerprint, unitMode: "STRICT" } as any);
    expect(errors.some((e) => e.startsWith("servable pool"))).toBe(true);
    expect(verifyCommitted({ ...t, questions: [...active(8), retired()] } as any, { candidateAssignmentFingerprint: cur.groundingAssignmentFingerprint, unitMode: "STRICT" } as any)).toEqual([]);
  });
});

describe("retirement — student runtime", () => {
  const strictTopic = () => topicRow({}, { contentProvenanceEnforcedAt: STRICT_AT });
  const pool = () => [...active(8), retired()];
  it("9/12: Practice (single Topic and whole subject) excludes retired", async () => {
    const h = services(strictTopic(), pool());
    expect(ids((await h.practice.getAdaptiveQuestions("u", "subject-1", TOPIC, 50)).questions).sort()).toEqual(ids(active(8)).sort());
    expect(ids((await h.practice.getAdaptiveQuestions("u", "subject-1", undefined, 50)).questions)).not.toContain("retired-0");
  });
  it("10/11/13: Quiz topic assessment, lesson check and mock exclude retired", async () => {
    const h = services(strictTopic(), pool());
    for (const type of ["topic_assessment", "lesson_check"] as const) expect(ids((await h.quizzes.getQuizQuestions("u", "subject-1", type, TOPIC, () => 0.5)).questions)).not.toContain("retired-0");
    const mock = await h.quizzes.getQuizQuestions("u", "subject-1", "mock_exam", undefined, () => 0.5);
    expect(mock.availableCount).toBe(8);
    expect(ids(mock.questions)).not.toContain("retired-0");
  });
  it("14: onboarding diagnostic excludes retired", async () => {
    const h = services(strictTopic(), pool());
    const qs = await h.onboarding.getDiagnosticQuestions("u");
    expect(qs.length).toBe(8);
    expect(ids(qs)).not.toContain("retired-0");
  });
  it("Practice/Quiz responses never echo retirement metadata", async () => {
    const h = services(strictTopic(), pool());
    const qs = (await h.practice.getAdaptiveQuestions("u", "subject-1", TOPIC, 50)).questions;
    expect(qs.every((q: any) => !("retiredAt" in q))).toBe(true);
  });
  it("7/8: submitting a retired id is excluded everywhere — no grading, no answer, no explanation", async () => {
    const t = strictTopic();
    const secret = { ...retired(), correctAnswerJson: "1", explanationEn: "secret explanation" };
    for (const kind of ["practice", "quiz", "diagnostic"] as const) {
      const findMany = jest.fn().mockImplementation(async ({ where }: any) => (where.id ? [{ ...secret, topic: t }] : [...active(8), secret]));
      const prisma = { client: { studentProfile: { findUnique: jest.fn().mockResolvedValue(STUDENT) }, question: { findMany }, questionAttempt: { createMany: jest.fn() }, quizResult: { create: jest.fn().mockResolvedValue({ id: "r" }) }, assessment: { create: jest.fn().mockResolvedValue({ id: "a" }) }, learningPlan: { create: jest.fn().mockResolvedValue({ id: "l" }) } } } as any;
      let out: any;
      if (kind === "practice") out = await new PracticeService(prisma, {} as any, {} as any).submitPractice("u", [{ questionId: "retired-0", answer: "1" }]);
      if (kind === "quiz") out = await new QuizzesService(prisma, {} as any, {} as any, { send: jest.fn() } as any).submitQuiz("u", { subjectId: "subject-1", type: "topic_assessment", topicId: TOPIC, answers: [{ questionId: "retired-0", answer: "1" }] }).catch((e: Error) => ({ error: e.message }));
      if (kind === "diagnostic") out = await new OnboardingService(prisma, {} as any).submitDiagnostic("u", [{ questionId: "retired-0", answer: "1" }]).catch((e: Error) => ({ error: e.message }));
      expect(JSON.stringify(out ?? {})).not.toContain("secret explanation");
      expect(JSON.stringify(out ?? {})).not.toMatch(/"correctAnswer":"1"/);
      expect(prisma.client.questionAttempt.createMany.mock.calls.every((c: any) => c[0].data.length === 0)).toBe(true);
    }
  });
  it("15: lazy top-up counts only active servable CURRENT (7 active + 1 retired tops up; 8 active + 1 retired does not)", async () => {
    const h7 = services(strictTopic(), [...active(7), retired()]);
    await h7.generator.ensurePoolForTopic(TOPIC, "student-1");
    expect(h7.generate).toHaveBeenCalled();
    const h8 = services(strictTopic(), [...active(8), retired()]);
    await h8.generator.ensurePoolForTopic(TOPIC, "student-1");
    expect(h8.generate).not.toHaveBeenCalled();
  });
  it("5: retired rows never contribute accepted-pool context for an admin completion", async () => {
    const h = services(strictTopic(), [...active(7).map((q) => ({ ...q, promptEn: "What is 5 plus 7?", explanationEn: "Count on." })), retired()]);
    h.generate.mockResolvedValue({ content: JSON.stringify({ questions: [{ type: "MULTIPLE_CHOICE", difficulty: "EASY", promptEn: "What is 9 plus 1?", promptAr: "س", optionsJson: ["10", "11", "9"], correctAnswerJson: "10", explanationEn: "Count on.", explanationAr: "ل" }] }), inputTokens: 1, outputTokens: 1 });
    // the only anchored row ("Addition question retired-0?") is retired => the final pool has no anchor => rejected
    await expect(h.generator.generateAutoQuestionBatch(TOPIC, 1, "actor", undefined, { againstCurrentPool: true })).rejects.toThrow(/failed validation/);
  });
});

/** In-memory store with commit-on-success transactions, for the atomic replacement. */
function replacementStore(opts: { strict?: boolean; attemptsOnOld?: number; draft?: Record<string, unknown> } = {}) {
  const unit = { ...gateUnit({ contentProvenanceEnforcedAt: opts.strict ? STRICT_AT : null }), id: "unit-gate" };
  const qs = active(8).map((q) => ({ ...q, retiredReason: null, replacedByQuestionId: null, _count: { attempts: 0 } }));
  qs[3] = { ...qs[3], promptEn: "Which pair of numbers makes 10?", _count: { attempts: opts.attemptsOnOld ?? 0 } };
  const state: any = {
    topic: { id: TOPIC, unitId: "unit-gate", groundingAssignment: gateAssignment(), topicSourceEvidence: [], unit },
    questions: qs,
    drafts: [{ id: "draft-1", topicId: TOPIC, status: "pending_review", publishedQuestionId: null, type: "MULTIPLE_CHOICE", difficulty: "EASY", promptEn: "Which pair of numbers adds up to 10 using addition?", promptAr: "س", optionsJson: ["6 and 4", "3 and 6", "1 and 8"], correctAnswerJson: "6 and 4", explanationEn: "6 plus 4 equals 10.", explanationAr: "ل", ...cur, ...opts.draft }],
    seq: 0,
  };
  const api = (s: any) => ({
    topic: { findUnique: async () => structuredClone({ ...s.topic, questions: s.questions }) },
    questionDraft: { findUnique: async ({ where }: any) => structuredClone(s.drafts.find((d: any) => d.id === where.id) ?? null), update: async ({ where, data }: any) => { Object.assign(s.drafts.find((d: any) => d.id === where.id), data); } },
    question: {
      create: async ({ data }: any) => { const q = { id: `q-new-${++s.seq}`, retiredAt: null, retiredReason: null, replacedByQuestionId: null, createdAt: new Date(), _count: { attempts: 0 }, ...data }; s.questions.push(q); return structuredClone(q); },
      updateMany: async ({ where, data }: any) => { const q = s.questions.find((x: any) => x.id === where.id && x.topicId === where.topicId && x.retiredAt === where.retiredAt); if (!q) return { count: 0 }; Object.assign(q, data); return { count: 1 }; },
    },
  });
  const holder = { s: state };
  const prisma = {
    $transaction: async (fn: any, o: any) => {
      expect(o.isolationLevel).toBe("Serializable");
      const draft = structuredClone(holder.s);
      const out = await fn(api(draft));
      holder.s = draft;
      return out;
    },
  };
  const view = () => ({ ...holder.s.topic, questions: holder.s.questions });
  return { holder, prisma, view };
}

describe("atomic single-Question replacement", () => {
  it("parses only an explicit, bounded allowlist; dry-run by default", () => {
    expect(parseArgs(["--questionIds=cmusd8alg001712ghcwl8fnm9"])).toEqual({ questionIds: ["cmusd8alg001712ghcwl8fnm9"], apply: false });
    const many = Array.from({ length: MAX_REPLACEMENTS_PER_RUN + 1 }, (_, i) => `cmusd8alg001712ghcwl8fn${String(i).padStart(3, "0")}`).join(",");
    for (const bad of [[], ["--questionIds=x"], [`--questionIds=${many}`], ["--topicIds=cmusd8alg001712ghcwl8fnm9"]]) expect(() => parseArgs(bad)).toThrow();
  });

  it.each([false, true])("swaps 8 -> 8 atomically (STRICT=%s): old retired with metadata, replacement active, mode and provenance unchanged, history queryable (19/20)", async (strict) => {
    const st = replacementStore({ strict });
    const plan = planReplacement(st.view(), "current-3");
    expect(plan.others).toHaveLength(7);
    const out = await atomicReplace(st.prisma, plan, "draft-1", installAutoQuestionDraft as any, "Serializable");
    expect(out.activeAfter).toHaveLength(8);
    expect(out.activeAfter).not.toContain("current-3");
    expect(out.activeAfter).toContain(out.replacementQuestionId);
    const old = st.holder.s.questions.find((q: any) => q.id === "current-3");
    expect(old).toMatchObject({ retiredReason: RETIRED_REASON, replacedByQuestionId: out.replacementQuestionId, promptEn: "Which pair of numbers makes 10?", groundingSourceFingerprint: cur.groundingSourceFingerprint, groundingAssignmentFingerprint: cur.groundingAssignmentFingerprint });
    expect(old.retiredAt).toBeInstanceOf(Date);
    expect(String(st.holder.s.topic.unit.contentProvenanceEnforcedAt)).toBe(String(strict ? STRICT_AT : null));
    expect(st.holder.s.drafts[0]).toMatchObject({ status: "published", publishedQuestionId: out.replacementQuestionId });
  });

  it("refuses before any write when the old Question has an attempt (precondition re-checked inside the transaction)", async () => {
    const st = replacementStore({ attemptsOnOld: 0 });
    const plan = planReplacement(st.view(), "current-3");
    st.holder.s.questions[3]._count.attempts = 1; // a student answered after preflight
    const before = structuredClone(st.holder.s);
    await expect(atomicReplace(st.prisma, plan, "draft-1", installAutoQuestionDraft as any, "Serializable")).rejects.toThrow(/student attempt/);
    expect(st.holder.s).toEqual(before);
  });

  it("an arithmetic-INVALID or duplicate candidate is refused and nothing commits", async () => {
    for (const draft of [{ explanationEn: "6 plus 4 equals 11." }, { promptEn: "Addition question current-0?" }]) {
      const st = replacementStore({ draft });
      const plan = planReplacement(st.view(), "current-3");
      const before = structuredClone(st.holder.s);
      expect(validateCandidate(st.holder.s.drafts[0], plan).length).toBeGreaterThan(0);
      await expect(atomicReplace(st.prisma, plan, "draft-1", installAutoQuestionDraft as any, "Serializable")).rejects.toThrow(/CANDIDATE/);
      expect(st.holder.s).toEqual(before);
    }
  });

  it("a postcondition failure after the writes rolls everything back (never a committed 7- or 9-Question state)", async () => {
    const st = replacementStore();
    const plan = planReplacement(st.view(), "current-3");
    const before = structuredClone(st.holder.s);
    // an install that publishes TWO Questions would make the pool 9 -> the in-transaction postcondition must abort
    const doubleInstall = async (tx: any, draft: any) => { await installAutoQuestionDraft(tx, { ...draft, id: draft.id }); return installAutoQuestionDraft(tx, { ...draft, promptEn: "A different addition question?" }); };
    await expect(atomicReplace(st.prisma, plan, "draft-1", doubleInstall as any, "Serializable")).rejects.toThrow(/POSTCONDITION/);
    expect(st.holder.s).toEqual(before);
  });

  it("refuses an already-retired or non-CURRENT target", () => {
    const st = replacementStore();
    st.holder.s.questions[3].retiredAt = new Date();
    expect(() => planReplacement(st.view(), "current-3")).toThrow(/already retired/);
    const st2 = replacementStore();
    Object.assign(st2.holder.s.questions[3], LEG);
    expect(() => planReplacement(st2.view(), "current-3")).toThrow(/not an active CURRENT/);
  });
});
