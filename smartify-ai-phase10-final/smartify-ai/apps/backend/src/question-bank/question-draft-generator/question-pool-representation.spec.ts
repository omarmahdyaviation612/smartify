/**
 * ADMIN Question pool-level grounding representation (2026-10-03).
 *
 * Production stop: Grade 4 Maths U2 "Solving Multi-Step Word Problems Using
 * Addition and Subtraction" — 4 bounded first-batch attempts rejected by the
 * pool-level anchor rule. Its own stored Questions show why: natural story
 * problems never name the concept in the PROMPT, and their EXPLANATIONS show
 * the operation only as a verb ("subtract 12 from 50"). Admin authoring now
 * judges prompt + explanation with verb-family word forms; the student lazy
 * top-up is unchanged. Fixtures below are the exact stored texts.
 */
import { QuestionDraftGeneratorService } from "./question-draft-generator.service";
import * as consistency from "../../ai/context/grounding-consistency-validator";
import { gateAssignment, gateUnit } from "../../ai/context/topic-content-gate.fixtures.testspec";
import { evaluateTopicGroundingGate } from "../../ai/context/topic-content-provenance.util";

const TOPIC = "topic-word-problems";
const LONG_FACT = "A method for solving multi-step problems involves outlining steps and ensuring calculations are accurate.";
const NOTES = {
  learningObjectives: ["Solve multi-step word problems."],
  concepts: [
    { name: "Addition", description: "Adding numbers together.", sourcePages: [10], importance: "core" },
    { name: "Subtraction", description: "Taking one number away from another.", sourcePages: [10], importance: "core" },
  ],
  facts: [{ fact: LONG_FACT, sourcePages: [10], importance: "core" }],
  vocabulary: [], skills: [], topicHints: [], scopeNotes: [],
};
const MC = (promptEn: string, explanationEn: string, answer: string, options: string[]) => ({ type: "MULTIPLE_CHOICE", difficulty: "MEDIUM", promptEn, promptAr: "سؤال", optionsJson: options, correctAnswerJson: answer, explanationEn, explanationAr: "لأن" });
// Exact stored LEGACY Questions #1, #2, #4, #5, #6 of the production Topic (story problems, no anchor in any prompt).
const STORY = [
  MC("What is the sum of 15 and 27?", "To find the sum, you need to add 15 and 27. When you add them together, the answer is 42.", "42", ["42", "32", "22"]),
  MC("If you have 50 apples and you give away 12, how many apples do you have left?", "To find out how many apples are left, subtract 12 from 50. 50 minus 12 equals 38.", "38", ["38", "28", "40"]),
  MC("Jacob has 60 marbles. He loses 15 marbles and then finds 5. How many marbles does he have now?", "First, subtract the lost marbles (15) from the original amount (60), which gives 45. Then add the 5 marbles he found. 45 plus 5 equals 50 marbles.", "50", ["50", "55", "45"]),
  MC("The school has 450 pencils. If 125 pencils are given to students and then 25 new pencils are bought, how many pencils are there in total now?", "Start by subtracting the given pencils from the total: 450 minus 125 equals 325. Then, add the new pencils (25): 325 plus 25 equals 350 pencils.", "350", ["350", "375", "450"]),
  MC("A bookstore had 200 books. They sold 75 books in one week, then received a shipment of 50 new books. How many books do they have now?", "First, subtract the sold books (75) from the total (200): 200 minus 75 equals 125. Then, add the shipment of 50 new books: 125 plus 50 equals 175 books.", "175", ["175", "150", "200"]),
];
const UNRELATED_EXPL = (q: ReturnType<typeof MC>) => ({ ...q, explanationEn: "Count carefully and check your answer." });
const CONCEPT_PROMPT = MC("To check your subtraction answer, you can add the result to the number you subtracted. Which is true?", "Adding the result back confirms the original number.", "It is true", ["It is true", "It is false", "Never"]);

function liveTopic() {
  return {
    id: TOPIC, nameEn: "Solving Multi-Step Word Problems Using Addition and Subtraction", nameAr: "حل المسائل",
    groundingAssignment: gateAssignment({ matchedConceptNames: ["Addition", "Subtraction"] }), topicSourceEvidence: [],
    unit: { ...gateUnit({ groundingNotesJson: NOTES }), nameEn: "Addition and Subtraction Strategies", subject: { nameEn: "Mathematics", grade: { nameEn: "Grade 4", curriculum: { nameEn: "EG" } } }, _count: { topics: 5 } },
    lessons: [{ isPlaceholder: false, objectives: [] }],
  };
}
const gate = () => {
  const g = evaluateTopicGroundingGate(liveTopic() as any);
  if (g.state !== "READY") throw new Error("fixture gate");
  return g;
};
const CUR = () => gate().provenance;
const row = (q: { promptEn: string; explanationEn: string }, prov: object, extra: Record<string, unknown> = {}) => ({ topicId: TOPIC, isPlaceholder: false, promptEn: q.promptEn, explanationEn: q.explanationEn, ...prov, ...extra });

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
  const svc = new QuestionDraftGeneratorService(prisma, { getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "m" }), getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0, costPerOutputToken: 0 }) } as any, { buildAutoQuestionBatchGenerationPrompt: jest.fn().mockReturnValue("p") } as any, usage as any, { autoPublish: jest.fn() } as any, { ensureTopicHasLesson: jest.fn() } as any);
  return { svc, generate, prisma };
}
const NORMAL = (h: ReturnType<typeof harness>, count: number) => h.svc.generateAutoQuestionBatch(TOPIC, count, "actor", undefined, { againstCurrentPool: true });
const STAGED = (h: ReturnType<typeof harness>, count: number, pool: Array<{ promptEn: string; explanationEn?: string | null }> = []) => h.svc.generateAutoQuestionBatch(TOPIC, count, "actor", { gate: gate(), acceptedPool: pool });

afterEach(() => jest.restoreAllMocks());

describe("admin Question pool — prompt + explanation representation", () => {
  it("1: story prompts with no anchors, explanations using add/subtract, anchors addition/subtraction => PASS", async () => {
    const h = harness([STORY]);
    expect((await NORMAL(h, 5)).drafts).toHaveLength(5);
  });

  it("2: the same prompts with unrelated explanations => FAIL, nothing written", async () => {
    const h = harness([STORY.map(UNRELATED_EXPL)]);
    await expect(NORMAL(h, 5)).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });

  it("3: a prompt that itself names subtraction => PASS even with unrelated explanations", async () => {
    const h = harness([[UNRELATED_EXPL(CONCEPT_PROMPT), ...STORY.map(UNRELATED_EXPL)]]);
    expect((await NORMAL(h, 6)).drafts).toHaveLength(6);
  });

  it("4: a mixed 8-Question word-problem pool passes through its explanations", async () => {
    const extra = [MC("Sara had 90 stickers, gave 30 away and got 15 more. How many now?", "Subtract 30 from 90 to get 60, then add 15 to get 75.", "75", ["75", "60", "45"]), MC("A bus had 40 riders; 12 got off and 7 got on. How many riders now?", "Subtract 12 from 40, then add 7: 35.", "35", ["35", "28", "45"]), MC("A farm had 120 eggs, sold 55 and collected 30. How many eggs now?", "Subtracting 55 from 120 gives 65; adding 30 gives 95.", "95", ["95", "65", "85"])];
    const h = harness([[...STORY, ...extra]]);
    expect((await NORMAL(h, 8)).drafts).toHaveLength(8);
  });

  it("5: a structurally invalid Question is rejected regardless of its explanation", async () => {
    const h = harness([[{ ...STORY[1], optionsJson: ["38", "28"] }]], STORY.map((q) => row(q, CUR())));
    await expect(NORMAL(h, 1)).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });

  it("6: an answer that is not one of the options is still rejected", async () => {
    const h = harness([[{ ...STORY[1], correctAnswerJson: "39" }]]);
    await expect(NORMAL(h, 1)).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });

  it("7: completion judges accepted CURRENT pool + new batch, prompt + explanation on BOTH sides", async () => {
    // accepted pool anchored only through explanations; the new Question has no anchor anywhere
    const h = harness([[UNRELATED_EXPL(MC("Mia had 30 cards and now has 41. How many did she get?", "x", "11", ["11", "9", "12"]))]], STORY.slice(0, 4).map((q) => row(q, CUR())));
    expect((await NORMAL(h, 1)).drafts).toHaveLength(1);
    // and the reverse: unanchored accepted pool, the new Question's explanation carries the anchor
    const h2 = harness([[STORY[4]]], STORY.slice(0, 4).map((q) => row(UNRELATED_EXPL(q), CUR())));
    expect((await NORMAL(h2, 1)).drafts).toHaveLength(1);
  });

  it.each([
    ["LEGACY", () => ({ groundingSourceFingerprint: null, groundingAssignmentFingerprint: null }), {}],
    ["MISMATCH", () => ({ ...CUR(), groundingAssignmentFingerprint: "tga1:old" }), {}],
    ["wrong source fingerprint", () => ({ ...CUR(), groundingSourceFingerprint: "fp-other" }), {}],
    ["another Topic", () => CUR(), { topicId: "topic-other" }],
    ["placeholder", () => CUR(), { isPlaceholder: true }],
  ])("8: %s rows with anchored explanations never contribute", async (_l, prov, extra) => {
    const h = harness([[UNRELATED_EXPL(STORY[0])]], STORY.map((q) => row(q, (prov as () => object)(), extra as Record<string, unknown>)));
    await expect(NORMAL(h, 1)).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });

  it("9: staged and normal regeneration reach identical outcomes for the same final pool", async () => {
    const cases: Array<[any[], any, boolean]> = [
      [STORY.slice(0, 4), UNRELATED_EXPL(STORY[4]), true],
      [STORY.slice(0, 4).map(UNRELATED_EXPL), UNRELATED_EXPL(STORY[4]), false],
      [STORY.slice(0, 4).map(UNRELATED_EXPL), STORY[4], true],
    ];
    for (const [pool, cand, ok] of cases) {
      const a = await NORMAL(harness([[cand]], pool.map((q) => row(q, CUR()))), 1).then(() => true, () => false);
      const b = await STAGED(harness([[cand]]), 1, pool.map((q) => ({ promptEn: q.promptEn, explanationEn: q.explanationEn }))).then(() => true, () => false);
      expect([a, b]).toEqual([ok, ok]);
    }
    // first staged batch (no pool yet) uses the same representation
    expect((await STAGED(harness([STORY]), 5)).drafts).toHaveLength(5);
  });
});

describe("admin Question pool — verbatim protection on the same representation", () => {
  it("10: a prompt copying grounding text still fails", async () => {
    const h = harness([[MC(`${LONG_FACT} Which is true?`, "Subtract then add.", "Yes", ["Yes", "No", "Maybe"])]]);
    await expect(NORMAL(h, 1)).rejects.toThrow(/failed validation/);
  });
  it("11: an explanation copying grounding text now fails", async () => {
    const h = harness([[MC("Sam had 20 pens, lost 5 and bought 3. How many now?", `${LONG_FACT} So subtract 5 then add 3.`, "18", ["18", "17", "22"])]]);
    await expect(NORMAL(h, 1)).rejects.toThrow(/failed validation/);
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });
  it("12: a natural explanation using operation words without copying passes", async () => {
    const h = harness([[MC("Sam had 20 pens, lost 5 and bought 3. How many now?", "Subtract 5 from 20 to get 15, then add 3 to get 18.", "18", ["18", "17", "22"])]]);
    expect((await NORMAL(h, 1)).drafts).toHaveLength(1);
  });
});

describe("student lazy top-up — unchanged", () => {
  it("25: judged on prompts only, without word forms (exact pre-change call) — so the same story batch is still rejected", async () => {
    const spy = jest.spyOn(consistency, "checkGroundingConsistency");
    const h = harness([STORY]);
    await h.svc.ensurePoolForTopic(TOPIC, "student-1");
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) {
      expect(call[0]).toEqual(STORY.map((q) => q.promptEn)); // prompts only, no explanations
      expect(call[2]).toBeUndefined(); // no word-form option
    }
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
    expect(h.prisma.client.question.findMany.mock.calls.every((c: any[]) => c[0].select?.explanationEn === undefined)).toBe(true); // never reads a pool
  });
});
