/**
 * NORMAL ADMIN REGENERATION — accumulated final-pool validation (2026-10-03).
 *
 * Production stop: Grade 4 Maths U2 "Addition with Renaming" reached 7 CURRENT
 * Questions; its 1-Question completion batch was judged ALONE by the
 * pool-level grounding-anchor rule and failed, although the 7 accepted
 * Questions + the new one satisfy it. The staged path already judged the
 * final pool (608d4a8f); regenerate-topic-content now does too, with the
 * accepted pool read by the generator itself from the Topic's live CURRENT
 * Questions under the batch's own gate.
 */
import { QuestionDraftGeneratorService } from "./question-draft-generator.service";
import { currentPoolQuestionGenerator, runRegeneration } from "../../scripts/regenerate-topic-content";
import { gateAssignment, gateUnit } from "../../ai/context/topic-content-gate.fixtures.testspec";
import { evaluateTopicGroundingGate } from "../../ai/context/topic-content-provenance.util";

const TOPIC = "topic-renaming";
const LONG_FACT = "Addition combines two or more numbers into one single total sum.";
// Same shape as the gate fixtures, with one fact long enough (>= 40 chars) for the verbatim rule.
const NOTES = {
  learningObjectives: ["Add numbers with renaming."],
  concepts: [{ name: "Addition", description: "Adding numbers together.", sourcePages: [10], importance: "core" }],
  facts: [{ fact: LONG_FACT, sourcePages: [10], importance: "core" }],
  vocabulary: [], skills: [], topicHints: [], scopeNotes: [],
};
const QV = { type: "MULTIPLE_CHOICE", difficulty: "EASY", promptAr: "سؤال", optionsJson: ["a", "b", "c"], correctAnswerJson: "a", explanationEn: "because", explanationAr: "لأن" };
const ANCHORED = (i: number) => ({ ...QV, promptEn: `Which shows the addition of 3 and ${i}?` });
const PLAIN = (i: number) => ({ ...QV, promptEn: `What is 5 plus ${i}?` });

function liveTopic(over: Record<string, unknown> = {}) {
  return {
    id: TOPIC, nameEn: "Addition with Renaming", nameAr: "الجمع مع إعادة التسمية",
    groundingAssignment: gateAssignment(), topicSourceEvidence: [],
    unit: { ...gateUnit({ groundingNotesJson: NOTES }), nameEn: "Addition and Subtraction Strategies", subject: { nameEn: "Mathematics", grade: { nameEn: "Grade 4", curriculum: { nameEn: "EG" } } }, _count: { topics: 5 } },
    lessons: [{ isPlaceholder: false, objectives: [] }],
    ...over,
  };
}
const gate = () => {
  const g = evaluateTopicGroundingGate(liveTopic() as any);
  if (g.state !== "READY") throw new Error("fixture gate");
  return g;
};
const CUR = () => gate().provenance;
const row = (q: { promptEn: string }, prov: object, extra: Record<string, unknown> = {}) => ({ topicId: TOPIC, isPlaceholder: false, promptEn: q.promptEn, ...prov, ...extra });
const LEGACY = { groundingSourceFingerprint: null, groundingAssignmentFingerprint: null };

/** Real generator; scripted provider batches; `pool` = every stored Question row the DB would return (NOT pre-filtered). */
function harness(batches: any[][], pool: any[] = []) {
  let call = 0;
  const generate = jest.fn().mockImplementation(async () => ({ content: JSON.stringify({ questions: batches[Math.min(call++, batches.length - 1)] }), inputTokens: 5, outputTokens: 5 }));
  const usage = { assertWithinBudget: jest.fn(), estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01), reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "r" }), reconcileBudget: jest.fn().mockResolvedValue(undefined), releaseBudget: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    client: {
      topic: { findUnique: jest.fn().mockResolvedValue(liveTopic()) },
      question: { findMany: jest.fn().mockResolvedValue(pool) },
      questionDraft: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: `qd-${Math.random()}`, ...data })) },
      aIUsage: { create: jest.fn().mockResolvedValue(undefined) },
    },
  } as any;
  const lessonGen = { ensureTopicHasLesson: jest.fn() };
  const svc = new QuestionDraftGeneratorService(prisma, { getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "m" }), getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0, costPerOutputToken: 0 }) } as any, { buildAutoQuestionBatchGenerationPrompt: jest.fn().mockReturnValue("p") } as any, usage as any, { autoPublish: jest.fn() } as any, lessonGen as any);
  return { svc, generate, usage, prisma, lessonGen };
}
const COMPLETE = { againstCurrentPool: true as const };
const anchoredPool = () => Array.from({ length: 7 }, (_, i) => row(ANCHORED(i), CUR()));

describe("current-pool completion — generator (real QuestionDraftGeneratorService)", () => {
  it("1: a first batch with 7 individually valid Questions (1 invalid dropped) passes final-pool grounding", async () => {
    const h = harness([[...Array.from({ length: 7 }, (_, i) => (i < 2 ? ANCHORED(i) : PLAIN(i))), { ...PLAIN(8), optionsJson: ["a", "b"] }]]);
    const r = await h.svc.generateAutoQuestionBatch(TOPIC, 8, "actor", undefined, COMPLETE);
    expect(r.drafts).toHaveLength(7);
    expect(r.rejectedCount).toBe(1);
  });

  it("3: 7 accepted CURRENT (anchored) + 1 new non-anchor Question: the final pool passes", async () => {
    const h = harness([[PLAIN(99)]], anchoredPool());
    const r = await h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", undefined, COMPLETE);
    expect(r.drafts).toHaveLength(1);
    expect(h.generate).toHaveBeenCalledTimes(1);
    // the pool is read for THIS Topic, non-placeholder rows only
    expect(h.prisma.client.question.findMany.mock.calls[0][0].where).toEqual({ topicId: TOPIC, isPlaceholder: false });
  });

  it("3b: the SAME batch without current-pool completion (the lazy/default path) is judged alone and fails — unchanged", async () => {
    const h = harness([[PLAIN(99)]], anchoredPool());
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor")).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.question.findMany).not.toHaveBeenCalled();
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });

  it("4: accepted pool without anchors + new Question without anchors: FAIL, nothing written", async () => {
    const h = harness([[PLAIN(99)]], Array.from({ length: 7 }, (_, i) => row(PLAIN(i), CUR())));
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", undefined, COMPLETE)).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });

  it("5: an anchored pool cannot rescue a structurally invalid new Question", async () => {
    const h = harness([[{ ...ANCHORED(99), optionsJson: ["a", "b"] }]], anchoredPool());
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", undefined, COMPLETE)).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });

  it.each([
    ["6: LEGACY", () => Array.from({ length: 7 }, (_, i) => row(ANCHORED(i), LEGACY))],
    ["7: MISMATCH (old assignment)", () => Array.from({ length: 7 }, (_, i) => row(ANCHORED(i), { ...CUR(), groundingAssignmentFingerprint: "tga1:old-assignment" }))],
    ["8: wrong assignment fingerprint", () => Array.from({ length: 7 }, (_, i) => row(ANCHORED(i), { groundingSourceFingerprint: CUR().groundingSourceFingerprint, groundingAssignmentFingerprint: "tga1:another" }))],
    ["9: wrong source fingerprint", () => Array.from({ length: 7 }, (_, i) => row(ANCHORED(i), { ...CUR(), groundingSourceFingerprint: "fp-other-pages" }))],
    ["10: another Topic (even with matching fingerprints)", () => Array.from({ length: 7 }, (_, i) => row(ANCHORED(i), CUR(), { topicId: "topic-sibling" }))],
    ["10b: placeholder rows", () => Array.from({ length: 7 }, (_, i) => row(ANCHORED(i), CUR(), { isPlaceholder: true }))],
  ])("%s anchored rows never contribute to the pool", async (_label, pool) => {
    const h = harness([[PLAIN(99)]], pool());
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", undefined, COMPLETE)).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });

  it("11: a 1-Question completion persists at most 1 even if the model returns more", async () => {
    const h = harness([[PLAIN(1), PLAIN(2), PLAIN(3)]], anchoredPool());
    expect((await h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", undefined, COMPLETE)).drafts).toHaveLength(1);
    expect(h.prisma.client.questionDraft.create).toHaveBeenCalledTimes(1);
  });

  it("12: an exact duplicate (case/whitespace-insensitive) of an accepted Question is rejected per item", async () => {
    const dup = { ...QV, promptEn: "  WHICH shows the   addition of 3 and 0?" };
    const h = harness([[dup]], anchoredPool());
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", undefined, COMPLETE)).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });

  it("12b: duplicates inside one batch count once; existing per-Question duplicate-option protection still rejects", async () => {
    const h = harness([[PLAIN(1), PLAIN(1), { ...PLAIN(2), optionsJson: ["a", "a", "c"] }, ANCHORED(3)]]);
    const r = await h.svc.generateAutoQuestionBatch(TOPIC, 4, "actor", undefined, COMPLETE);
    expect(r.drafts.map((d: any) => d.promptEn)).toEqual([PLAIN(1).promptEn, ANCHORED(3).promptEn]);
    expect(r.rejectedCount).toBe(2);
  });

  it("13: verbatim-copy protection still applies to the final pool", async () => {
    const h = harness([[{ ...QV, promptEn: `${LONG_FACT} True or False?` }]], anchoredPool());
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", undefined, COMPLETE)).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });

  it("14: normal (current-pool) and staged (explicit pool) completion give identical outcomes for the same final pool", async () => {
    for (const [poolQs, candidate, ok] of [[Array.from({ length: 7 }, (_, i) => ANCHORED(i)), PLAIN(99), true], [Array.from({ length: 7 }, (_, i) => PLAIN(i)), PLAIN(99), false], [Array.from({ length: 7 }, (_, i) => PLAIN(i)), ANCHORED(99), true]] as const) {
      const normal = harness([[candidate]], poolQs.map((q) => row(q, CUR())));
      const staged = harness([[candidate]]);
      const a = normal.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", undefined, COMPLETE).then(() => true, () => false);
      const b = staged.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", { gate: gate(), acceptedPool: poolQs.map((q) => ({ promptEn: q.promptEn, explanationEn: q.explanationEn })) }).then(() => true, () => false);
      expect([await a, await b]).toEqual([ok, ok]);
    }
  });

  it("staged and current-pool completion cannot be combined", async () => {
    const h = harness([[PLAIN(1)]]);
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", { gate: gate() }, COMPLETE)).rejects.toThrow(/mutually exclusive/);
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("bounded: a failing completion makes exactly 2 provider calls, each reserved and reconciled", async () => {
    const h = harness([[PLAIN(99)]], Array.from({ length: 7 }, (_, i) => row(PLAIN(i), CUR())));
    await expect(h.svc.generateAutoQuestionBatch(TOPIC, 1, "actor", undefined, COMPLETE)).rejects.toThrow();
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(h.usage.reserveBudget).toHaveBeenCalledTimes(2);
    expect(h.usage.reconcileBudget).toHaveBeenCalledTimes(2);
  });

  it("15: the student lazy top-up is NOT broadened — it never requests current-pool completion and judges its batch alone", async () => {
    const h = harness([[PLAIN(99)]], anchoredPool());
    const spy = jest.spyOn(h.svc, "generateAutoQuestionBatch");
    await h.svc.ensurePoolForTopic(TOPIC, "student-1");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][3]).toBeUndefined();
    expect(spy.mock.calls[0][4]).toBeUndefined();
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled(); // unchanged per-batch rule
  });
});

describe("current-pool completion — regenerate-topic-content wiring and bounds", () => {
  it("currentPoolQuestionGenerator always requests current-pool completion and publishes every created draft", async () => {
    const gen = { generateAutoQuestionBatch: jest.fn().mockResolvedValue({ drafts: [{ id: "d1" }] }) };
    const pub = { autoPublish: jest.fn().mockResolvedValue(undefined) };
    expect(await currentPoolQuestionGenerator(gen, pub, "actor")(TOPIC, 1)).toBe(1);
    expect(gen.generateAutoQuestionBatch).toHaveBeenCalledWith(TOPIC, 1, "actor", undefined, { againstCurrentPool: true });
    expect(pub.autoPublish).toHaveBeenCalledWith("d1");
  });

  const regenTopic = (questions: any[], stepsCurrent: boolean) => ({
    ...liveTopic(), unitId: "unit-gate", teachingStepsJson: [{ id: "s1" }],
    groundingSourceFingerprintUsed: stepsCurrent ? CUR().groundingSourceFingerprint : null,
    groundingAssignmentFingerprintUsed: stepsCurrent ? CUR().groundingAssignmentFingerprint : null,
    questions,
  });

  it("2/11: first batch yields 7, the completion requests exactly 1, and the Topic finishes at exactly 8 CURRENT", async () => {
    const state = { questions: Array.from({ length: 8 }, () => ({ isPlaceholder: false, ...LEGACY })) as any[] };
    const yields = [7, 1];
    const requested: number[] = [];
    const deps = {
      loadTopic: jest.fn().mockImplementation(async () => regenTopic([...state.questions], true)),
      regenerateLesson: jest.fn(),
      generateQuestions: jest.fn().mockImplementation(async (_id: string, n: number) => { requested.push(n); const k = Math.min(n, yields.shift() ?? 0); for (let i = 0; i < k; i++) state.questions.push({ isPlaceholder: false, ...CUR() }); return k; }),
    };
    const out = await runRegeneration({ topicIds: [TOPIC], apply: true, lesson: true, questions: true }, deps);
    expect(requested).toEqual([8, 1]);
    expect(deps.regenerateLesson).not.toHaveBeenCalled(); // CURRENT lesson preserved
    expect(out.results[0]).toMatchObject({ status: "COMPLETED", questionBatches: 2, final: { currentQuestions: 8 } });
  });

  it("repairing a partial Topic (CURRENT lesson + 7 CURRENT): requests exactly 1, keeps the lesson and the 7", async () => {
    const state = { questions: [...Array.from({ length: 8 }, () => ({ isPlaceholder: false, ...LEGACY })), ...Array.from({ length: 7 }, () => ({ isPlaceholder: false, ...CUR() }))] as any[] };
    const deps = {
      loadTopic: jest.fn().mockImplementation(async () => regenTopic([...state.questions], true)),
      regenerateLesson: jest.fn(),
      generateQuestions: jest.fn().mockImplementation(async (_id: string, n: number) => { state.questions.push({ isPlaceholder: false, ...CUR() }); return 1; }),
    };
    const out = await runRegeneration({ topicIds: [TOPIC], apply: true, lesson: true, questions: true }, deps);
    expect(deps.generateQuestions).toHaveBeenCalledTimes(1);
    expect(deps.generateQuestions).toHaveBeenCalledWith(TOPIC, 1);
    expect(deps.regenerateLesson).not.toHaveBeenCalled();
    expect(out.results[0]).toMatchObject({ status: "COMPLETED", lessonAction: "SKIP_CURRENT", questionBatches: 1, final: { currentQuestions: 8 } });
  });

  it("16: a Topic already at 8 CURRENT with a CURRENT lesson makes no generation call at all", async () => {
    const deps = {
      loadTopic: jest.fn().mockResolvedValue(regenTopic(Array.from({ length: 8 }, () => ({ isPlaceholder: false, ...CUR() })), true)),
      regenerateLesson: jest.fn(),
      generateQuestions: jest.fn(),
    };
    const out = await runRegeneration({ topicIds: [TOPIC], apply: true, lesson: true, questions: true }, deps);
    expect(deps.generateQuestions).not.toHaveBeenCalled();
    expect(deps.regenerateLesson).not.toHaveBeenCalled();
    expect(out.results[0]).toMatchObject({ status: "COMPLETED", questionBatches: 0 });
  });
});
