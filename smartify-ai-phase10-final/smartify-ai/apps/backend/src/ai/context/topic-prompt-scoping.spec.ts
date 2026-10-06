/**
 * Topic prompt scoping (2026-10-04): the rendered Topic grounding block carries
 * only Topic-scoped evidence (concepts, facts, vocabulary). The Unit-wide
 * `learningObjectives` (which name sibling Topics' content) are no longer
 * rendered. Render-only: slices, assignments and fingerprints are unchanged.
 */
import { AIContextBuilderService } from "./ai-context-builder.service";
import { QuestionDraftGeneratorService } from "../../question-bank/question-draft-generator/question-draft-generator.service";
import { checkGroundingConsistency } from "./grounding-consistency-validator";
import { computeAssignmentFingerprint, evaluateTopicGroundingGate } from "./topic-content-provenance.util";
import { DETERMINISTIC_ASSIGNMENT_VERSION, resolveAssignedGroundingSlice } from "./topic-grounding-assignment.util";
import type { GroundingNotes, GroundingSlice } from "../../interactive-lesson/unit-grounding/unit-grounding.types";

// Grade 6 Social Studies U2 shape: T1's evidence ends at p50; Badr (p53) and the Caliphs (p57+) belong to siblings,
// and the Unit-wide objectives name all of them.
const UNIT_OBJECTIVES = [
  "Identify the characteristics of life in the Arabian Peninsula before the emergence of Islam.",
  "Explain the significance of the migration to Medina.",
  "Identify the Battle of Badr.",
  "Identify the main achievements of the Rightly Guided Caliphs.",
  "Describe the contributions of each Caliph before Islam and afterwards.",
];
const NOTES: GroundingNotes = {
  unitTitle: "The Islamic State", gradeLevel: "Grade 6", subject: "Social Studies",
  learningObjectives: UNIT_OBJECTIVES,
  concepts: [
    { name: "Political life", description: "Tribal systems and governance before Islam.", sourcePages: [43], importance: "core" },
    { name: "Economic life", description: "Trade in the Arabian Peninsula before Islam.", sourcePages: [43], importance: "core" },
    { name: "Battle of Badr", description: "An important early battle in Islamic history.", sourcePages: [53], importance: "core" },
    { name: "Rightly Guided Caliphs", description: "Leaders after the Prophet Muhammad.", sourcePages: [57], importance: "core" },
  ],
  facts: [
    { fact: "Mecca was a significant trade and cultural center before Islam.", sourcePages: [43], importance: "core" },
    { fact: "The first caliph was Abu Bakr, who succeeded the Prophet Muhammad.", sourcePages: [57], importance: "core" },
  ],
  vocabulary: [{ term: "Qabila", meaning: "A tribe sharing a common ancestor.", sourcePages: [43] }, { term: "Badr", meaning: "The first significant battle.", sourcePages: [53] }],
  skills: [], topicHints: [], scopeNotes: [],
};
const FP = "fp-g6ss";
const UNIT = { id: "unit-ss", groundingVersion: 1, groundingSourceFingerprint: FP, groundingNotesJson: NOTES, contentProvenanceEnforcedAt: null };
const row = (method: string, names: string[], extra: Record<string, unknown> = {}) => ({
  unitGroundingVersion: 1, unitSourceFingerprint: FP, assignmentVersion: DETERMINISTIC_ASSIGNMENT_VERSION, method, mapperPromptVersion: null, confidence: "HIGH", status: "READY", matchedConceptNames: names, matchedHintTitles: null, ...extra,
});
const sliceFor = (r: any): GroundingSlice => {
  const out = resolveAssignedGroundingSlice(r, UNIT, []);
  if (out.state !== "READY") throw new Error(`fixture slice ${out.state}`);
  return out.slice;
};
const REVIEWED_T1 = row("REVIEWED", ["Political life", "Economic life"]);
const KEYWORD_T1 = row("KEYWORD_OVERLAP", ["Political life"]);
const SOLE = row("SINGLE_TOPIC_FALLBACK", [...NOTES.concepts.map((c) => c.name), ...NOTES.vocabulary.map((v) => v.term), ...NOTES.facts.map((f) => f.fact)]);
const SIBLING_OBJECTIVES = UNIT_OBJECTIVES.slice(1);

const builder = new AIContextBuilderService();
const qCtx = { curriculumNameEn: "EG", gradeNameEn: "Grade 6", subjectNameEn: "Social Studies", unitNameEn: "The Islamic State", topicNameEn: "The Arabian Peninsula (Before and After the Rise of Islam)", studentAgeRange: "6-12" };
const lessonCtx = { ...qCtx, topicNameAr: "شبه الجزيرة العربية", preferredLang: "en" as const };
const groundingOf = (prompt: string) => prompt.slice(prompt.indexOf("<curriculum_grounding>"), prompt.indexOf("</curriculum_grounding>") + 23);

/** Every Topic-specific prompt that renders the shared grounding block. */
function allPrompts(slice: GroundingSlice): Record<string, string> {
  return {
    questionBatch: builder.buildAutoQuestionBatchGenerationPrompt(qCtx, 8, undefined, slice, ["Identify the characteristics of life in the Arabian Peninsula before the emergence of Islam."]),
    lessonAuthoring: builder.buildAutoLessonGenerationPrompt(lessonCtx as any, undefined, slice),
    lessonTeaching: builder.buildLessonTeachingPrompt({ ...lessonCtx, studentFullName: "S", age: 11, mode: "deliver", currentStep: { id: "s1", type: "EXPLAIN", order: 1, objective: "Explain tribal life." }, stepIndex: 0, totalSteps: 3, groundingSlice: slice } as any),
    tutor: builder.buildTutorSystemPrompt({ studentFullName: "S", age: 11, gradeNameEn: "Grade 6", curriculumNameEn: "EG", subjectNameEn: "Social Studies", topicNameEn: qCtx.topicNameEn, preferredLang: "en", groundingSlice: slice } as any),
  };
}

describe("1-6: the rendered Topic grounding block carries Topic evidence only", () => {
  it("1-2: no Unit-wide objective (Battle of Badr, Caliphs, Medina) appears in any Topic-specific prompt; the scoped T1 evidence ends before Badr", () => {
    const slice = sliceFor(REVIEWED_T1);
    expect(slice.learningObjectives).toEqual(UNIT_OBJECTIVES); // the slice itself is unchanged
    for (const [path, prompt] of Object.entries(allPrompts(slice))) {
      expect(prompt).toContain("<curriculum_grounding>");
      for (const o of UNIT_OBJECTIVES) expect({ path, inGrounding: groundingOf(prompt).includes(o) }).toEqual({ path, inGrounding: false });
      for (const o of SIBLING_OBJECTIVES) expect({ path, leaked: prompt.includes(o) }).toEqual({ path, leaked: false });
      expect({ path, badr: /badr/i.test(prompt), caliph: /caliph/i.test(prompt), objectivesHeader: prompt.includes("Learning objectives:") }).toEqual({ path, badr: false, caliph: false, objectivesHeader: false });
    }
  });

  it("3: scoped concepts, facts and vocabulary remain present", () => {
    const g = groundingOf(allPrompts(sliceFor(REVIEWED_T1)).questionBatch);
    expect(g).toContain("- Political life: Tribal systems and governance before Islam.");
    expect(g).toContain("- Economic life: Trade in the Arabian Peninsula before Islam.");
    expect(g).toContain("- Mecca was a significant trade and cultural center before Islam.");
    expect(g).toContain("- Qabila: A tribe sharing a common ancestor.");
  });

  it("4-5: REVIEWED and KEYWORD_OVERLAP assignments render normally (same block shape, their own evidence)", () => {
    for (const r of [REVIEWED_T1, KEYWORD_T1]) {
      const g = groundingOf(builder.buildAutoQuestionBatchGenerationPrompt(qCtx, 8, undefined, sliceFor(r)));
      expect(g).toMatch(/^<curriculum_grounding>[\s\S]*Core concepts:\n- Political life[\s\S]*<\/curriculum_grounding>$/);
    }
  });

  it("6: SINGLE_TOPIC_FALLBACK still renders the whole Unit's evidence (a term in the slice itself is evidence, not objective leakage)", () => {
    const g = groundingOf(builder.buildAutoQuestionBatchGenerationPrompt(qCtx, 8, undefined, sliceFor(SOLE)));
    expect(g).toContain("- Battle of Badr: An important early battle in Islamic history.");
    expect(g).toContain("- Badr: The first significant battle.");
    expect(g).not.toContain("Identify the Battle of Badr.");
    expect(g).not.toContain("Learning objectives:");
  });

  it("the Topic's OWN lesson objectives still reach Question generation, outside the grounding block", () => {
    const prompt = allPrompts(sliceFor(REVIEWED_T1)).questionBatch;
    expect(prompt).toMatch(/already teaches these objectives[^]*Identify the characteristics of life in the Arabian Peninsula/);
    expect(groundingOf(prompt)).not.toContain("Identify the characteristics of life");
  });

  it("a manual (non-slice) lesson draft keeps its own supplied objectives — not a grounding render", () => {
    const prompt = builder.buildLessonDraftGenerationPrompt({ ...lessonCtx, learningObjectives: ["Admin-supplied objective."] } as any);
    expect(prompt).toContain("Admin-supplied objective.");
  });
});

describe("7-11: every Question generation path sends the corrected block (real generator + real builder)", () => {
  const TOPIC = "topic-g6ss-t1";
  const topicRow = () => ({ id: TOPIC, nameEn: qCtx.topicNameEn, nameAr: "x", groundingAssignment: REVIEWED_T1, topicSourceEvidence: [], unit: { ...UNIT, nameEn: "The Islamic State", subject: { nameEn: "Social Studies", grade: { nameEn: "Grade 6", curriculum: { nameEn: "EG" } } }, _count: { topics: 4 } }, lessons: [{ isPlaceholder: false, objectives: [{ descriptionEn: "Identify the characteristics of life in the Arabian Peninsula before the emergence of Islam." }] }] });
  const Q = (i: number) => ({ type: "MULTIPLE_CHOICE", difficulty: "EASY", promptEn: `What was political life like before Islam, case ${i}?`, promptAr: "س", optionsJson: ["Tribal", "Unified", "Royal"], correctAnswerJson: "Tribal", explanationEn: "Political life was tribal.", explanationAr: "ل" });
  function harness() {
    const prompts: string[] = [];
    const generate = jest.fn().mockImplementation(async (req: any) => { prompts.push(req.systemPrompt); return { content: JSON.stringify({ questions: [Q(1), Q(2)] }), inputTokens: 1, outputTokens: 1 }; });
    const usage = { assertWithinBudget: jest.fn(), estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01), reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "r" }), reconcileBudget: jest.fn().mockResolvedValue(undefined), releaseBudget: jest.fn().mockResolvedValue(undefined) };
    const prisma = { client: { topic: { findUnique: jest.fn().mockResolvedValue(topicRow()) }, question: { findMany: jest.fn().mockResolvedValue([]) }, questionDraft: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: `qd-${Math.random()}`, ...data })) }, aIUsage: { create: jest.fn().mockResolvedValue(undefined) } } } as any;
    const svc = new QuestionDraftGeneratorService(prisma, { getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "m" }), getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0, costPerOutputToken: 0 }) } as any, builder, usage as any, { autoPublish: jest.fn() } as any, { ensureTopicHasLesson: jest.fn() } as any);
    return { svc, prompts };
  }
  const gate = () => { const g = evaluateTopicGroundingGate(topicRow() as any); if (g.state !== "READY") throw new Error("gate"); return g; };
  const assertScoped = (prompt: string) => {
    expect(prompt).toContain("- Political life: Tribal systems and governance before Islam.");
    for (const o of SIBLING_OBJECTIVES) expect(prompt).not.toContain(o);
    expect(prompt).not.toMatch(/badr|caliph/i);
  };

  it("7-8: normal admin authoring / completion batch (againstCurrentPool)", async () => {
    const h = harness();
    await h.svc.generateAutoQuestionBatch(TOPIC, 2, "actor", undefined, { againstCurrentPool: true });
    assertScoped(h.prompts[0]);
  });
  it("9: staged generation (candidate gate + staged lesson objectives)", async () => {
    const h = harness();
    await h.svc.generateAutoQuestionBatch(TOPIC, 2, "actor", { gate: gate(), lessonObjectives: ["Staged objective about tribal life."] });
    assertScoped(h.prompts[0]);
    expect(h.prompts[0]).toContain("Staged objective about tribal life.");
  });
  it("10: atomic replacement generation (staged path with the kept pool as acceptedPool)", async () => {
    const h = harness();
    await h.svc.generateAutoQuestionBatch(TOPIC, 2, "actor", { gate: gate(), acceptedPool: [{ promptEn: "Kept political life question?", explanationEn: "Tribal." }] });
    assertScoped(h.prompts[0]);
  });
  it("11: student lazy top-up (no options) shares the same renderer", async () => {
    const h = harness();
    await h.svc.generateAutoQuestionBatch(TOPIC, 2, "actor");
    assertScoped(h.prompts[0]);
  });
});

describe("12-13: validation, provenance and storage are untouched", () => {
  it("12: grounding validation results and the assignment fingerprint do not depend on the render change", () => {
    const slice = sliceFor(REVIEWED_T1);
    const texts = ["Tribal political life before Islam."];
    expect(checkGroundingConsistency(texts, slice)).toEqual(checkGroundingConsistency(texts, { ...slice, learningObjectives: [] }));
    expect(checkGroundingConsistency(["The Battle of Badr was a victory."], slice, { wordForms: true })).toEqual([expect.stringMatching(/does not reference/)]);
    const gate = evaluateTopicGroundingGate({ groundingAssignment: REVIEWED_T1, topicSourceEvidence: [], unit: UNIT } as any);
    expect(gate.state === "READY" && gate.provenance.groundingAssignmentFingerprint).toBe(computeAssignmentFingerprint(UNIT, REVIEWED_T1 as any, slice));
  });
  it("13: rendering needs no DB, provider or write — the builder has no dependencies", () => {
    expect(new AIContextBuilderService().buildAutoQuestionBatchGenerationPrompt(qCtx, 8, undefined, sliceFor(REVIEWED_T1))).toContain("<curriculum_grounding>");
  });
});
