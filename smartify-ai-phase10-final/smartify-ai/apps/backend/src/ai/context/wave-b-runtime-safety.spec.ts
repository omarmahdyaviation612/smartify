/**
 * Wave B runtime safety + downstream provenance (2026-10-03) — service-level
 * guarantees across Practice, Quiz, question/lesson generation, publishing and
 * the admin regeneration/enforcement scripts. Lesson-runtime gating (A/D for
 * InteractiveLessonService) lives in interactive-lesson.service.spec.ts; the
 * pure gate/provenance rules in topic-content-provenance.util.spec.ts.
 */
import { ServiceUnavailableException } from "@nestjs/common";
import { PracticeService } from "../../practice/practice.service";
import { QuizzesService } from "../../quizzes/quizzes.service";
import { QuestionDraftGeneratorService } from "../../question-bank/question-draft-generator/question-draft-generator.service";
import { QuestionPublishService } from "../../question-bank/question-draft-generator/question-publish.service";
import { LessonDraftGeneratorService } from "../../interactive-lesson/lesson-draft-generator/lesson-draft-generator.service";
import { LessonPublishService } from "../../interactive-lesson/lesson-draft-generator/lesson-publish.service";
import { parseArgs as parseRegenArgs, planTopic, runRegeneration, MAX_TOPICS_PER_RUN } from "../../scripts/regenerate-topic-content";
import { strictReadinessBlockers } from "../../scripts/enforce-content-provenance";
import { canServeTopicSteps, classifyContentProvenance, evaluateTopicGroundingGate } from "./topic-content-provenance.util";
import { currentGateProvenance, gateAssignment, withBlockedGate, withReadyGate } from "./topic-content-gate.fixtures.testspec";

const TOPIC = "topic-1";
const STUDENT = { id: "student-1", fullName: "S", subjects: [{ subjectId: "subject-1" }] };
const VALID_Q = { type: "MULTIPLE_CHOICE", difficulty: "EASY", promptEn: "Addition: what is 2 + 2?", promptAr: "ما هو ٢ + ٢؟", optionsJson: ["3", "4", "5"], correctAnswerJson: "4", explanationEn: "2 + 2 = 4.", explanationAr: "٢ + ٢ = ٤." };

function topicRow(gate: "READY" | "BLOCKED" | "STALE" | "EMPTY" | "MISSING", over: Record<string, unknown> = {}) {
  const base = { id: TOPIC, nameEn: "Topic", nameAr: "موضوع", unitId: "unit-gate", teachingStepsJson: [{ id: "s1" }], lessons: [{ isPlaceholder: false, objectives: [] }], ...over };
  const unitExtra = { nameEn: "Unit", subjectId: "subject-1", subject: { nameEn: "Mathematics", sourceFile: "eg/g5/math.pdf", grade: { nameEn: "Grade 5", curriculum: { nameEn: "EG" } } }, _count: { topics: 1 } };
  const withUnit = { ...base, unit: unitExtra };
  if (gate === "READY") return withReadyGate(withUnit);
  if (gate === "BLOCKED") return withBlockedGate(withUnit);
  const ready = withReadyGate(withUnit);
  if (gate === "STALE") return { ...ready, groundingAssignment: gateAssignment({ unitSourceFingerprint: "fp-old-shifted" }) };
  if (gate === "EMPTY") return { ...ready, groundingAssignment: gateAssignment({ matchedConceptNames: ["Concept not in notes"] }) };
  return { ...ready, groundingAssignment: null };
}

/** A real QuestionDraftGeneratorService over a mocked Prisma/provider — every write and provider call is observable. */
function questionHarness(topic: any, existingQuestions: any[] = []) {
  const generate = jest.fn().mockResolvedValue({ content: JSON.stringify({ questions: [VALID_Q] }), inputTokens: 5, outputTokens: 5 });
  const prisma = {
    client: {
      topic: { findUnique: jest.fn().mockResolvedValue(topic), findMany: jest.fn().mockResolvedValue([topic]) },
      question: { findMany: jest.fn().mockImplementation(async ({ where }: any) => existingQuestions.filter((q) => (where.topicId?.in ?? [where.topicId]).includes(q.topicId))), count: jest.fn() },
      questionDraft: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: `qd-${Math.random()}`, ...data })) },
      aIUsage: { create: jest.fn().mockResolvedValue(undefined) },
      studentProfile: { findUnique: jest.fn().mockResolvedValue(STUDENT) },
    },
  } as any;
  const usage = {
    assertWithinBudget: jest.fn().mockResolvedValue(undefined),
    estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01),
    reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "r" }),
    reconcileBudget: jest.fn().mockResolvedValue(undefined),
    releaseBudget: jest.fn().mockResolvedValue(undefined),
  };
  const providerFactory = { getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "gpt-4o-mini" }), getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0, costPerOutputToken: 0 }) };
  const publisher = { autoPublish: jest.fn().mockResolvedValue(undefined) };
  const lessonGenerator = { ensureTopicHasLesson: jest.fn().mockResolvedValue(topic) };
  const generator = new QuestionDraftGeneratorService(prisma, providerFactory as any, { buildAutoQuestionBatchGenerationPrompt: jest.fn().mockReturnValue("p") } as any, usage as any, publisher as any, lessonGenerator as any);
  const accuracy = { getPerTopicAccuracy: jest.fn().mockResolvedValue([]), getTopicAccuracy: jest.fn().mockResolvedValue(null) } as any;
  const practice = new PracticeService(prisma, accuracy, generator);
  const quizzes = new QuizzesService(prisma, accuracy, generator, { send: jest.fn() } as any);
  return { prisma, generate, usage, publisher, lessonGenerator, generator, practice, quizzes };
}

const legacyQ = (id: string) => ({ id, topicId: TOPIC, difficulty: "EASY", isPlaceholder: false, groundingSourceFingerprint: null, groundingAssignmentFingerprint: null });

describe("B — a BLOCKED Topic's existing Questions are never served", () => {
  it("Practice (topic + whole-subject) and every Quiz type return none of them", async () => {
    const h = questionHarness(topicRow("BLOCKED"), [legacyQ("q1"), legacyQ("q2")]);
    expect((await h.practice.getAdaptiveQuestions("u", "subject-1", TOPIC)).questions).toEqual([]);
    expect((await h.practice.getAdaptiveQuestions("u", "subject-1", undefined)).questions).toEqual([]);
    for (const type of ["topic_assessment", "lesson_check"] as const) expect((await h.quizzes.getQuizQuestions("u", "subject-1", type, TOPIC)).questions).toEqual([]);
    expect((await h.quizzes.getQuizQuestions("u", "subject-1", "mock_exam")).questions).toEqual([]);
  });
  it("submitting a BLOCKED Topic's Question id grades nothing and leaks no answer/explanation", async () => {
    const h = questionHarness(topicRow("BLOCKED"));
    h.prisma.client.question.findMany = jest.fn().mockResolvedValue([{ ...legacyQ("q1"), correctAnswerJson: "4", explanationEn: "secret", topic: topicRow("BLOCKED") }]);
    h.prisma.client.questionAttempt = { createMany: jest.fn() };
    const r = await h.practice.submitPractice("u", [{ questionId: "q1", answer: "4" }]);
    expect(r.feedback).toEqual([]);
    expect(h.prisma.client.questionAttempt.createMany).toHaveBeenCalledWith({ data: [] });
  });
  it("a READY Topic still serves its LEGACY Questions during TRANSITION (migration breaks nothing)", async () => {
    const h = questionHarness(topicRow("READY"), [legacyQ("q1"), legacyQ("q2")]);
    const q = (await h.quizzes.getQuizQuestions("u", "subject-1", "topic_assessment", TOPIC)).questions;
    expect(q.map((x: any) => x.id).sort()).toEqual(["q1", "q2"]);
    expect(q[0]).not.toHaveProperty("groundingSourceFingerprint");
  });
});

describe("C/H — no Question generation without READY_CURRENT_NON_EMPTY", () => {
  it.each(["BLOCKED", "STALE", "EMPTY", "MISSING"] as const)("C: opening Practice/Quiz for a %s Topic with ZERO Questions -> zero provider calls, zero writes", async (state) => {
    const h = questionHarness(topicRow(state), []);
    await h.practice.getAdaptiveQuestions("u", "subject-1", TOPIC);
    await h.quizzes.getQuizQuestions("u", "subject-1", "topic_assessment", TOPIC);
    await h.quizzes.getQuizQuestions("u", "subject-1", "lesson_check", TOPIC);
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.usage.reserveBudget).not.toHaveBeenCalled();
    expect(h.lessonGenerator.ensureTopicHasLesson).not.toHaveBeenCalled();
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
    expect(h.publisher.autoPublish).not.toHaveBeenCalled();
  });
  it.each(["BLOCKED", "STALE", "EMPTY", "MISSING"] as const)("F/G/H: generateAutoQuestionBatch on a %s Topic throws unavailable BEFORE any budget/provider call or write (no title-only fallback)", async (state) => {
    const h = questionHarness(topicRow(state));
    await expect(h.generator.generateAutoQuestionBatch(TOPIC, 8, "actor")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.usage.assertWithinBudget).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });
});

describe("E/K — READY_CURRENT_NON_EMPTY generation is allowed and stamps provenance", () => {
  it("E/K: generated QuestionDrafts carry the CURRENT grounding + assignment fingerprints", async () => {
    const h = questionHarness(topicRow("READY"));
    const r = await h.generator.generateAutoQuestionBatch(TOPIC, 1, "actor");
    expect(h.generate).toHaveBeenCalledTimes(1);
    const data = h.prisma.client.questionDraft.create.mock.calls[0][0].data;
    expect({ groundingSourceFingerprint: data.groundingSourceFingerprint, groundingAssignmentFingerprint: data.groundingAssignmentFingerprint }).toEqual(currentGateProvenance());
    expect(r.provenance).toEqual(currentGateProvenance());
    expect(data.aiModel).toBe("gpt-4o-mini");
  });
  it("E: an empty pool on a READY Topic is topped up (existing lazy behavior preserved)", async () => {
    const h = questionHarness(topicRow("READY"), []);
    await h.practice.getAdaptiveQuestions("u", "subject-1", TOPIC);
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.publisher.autoPublish).toHaveBeenCalled();
  });
  it("a full LEGACY pool on a READY Topic during TRANSITION triggers no generation (no surprise spend from the migration)", async () => {
    const h = questionHarness(topicRow("READY"), Array.from({ length: 8 }, (_, i) => legacyQ(`q${i}`)));
    await h.practice.getAdaptiveQuestions("u", "subject-1", TOPIC);
    expect(h.generate).not.toHaveBeenCalled();
  });
  it("a pool made only of MISMATCHED Questions does not count — they are never served and a current pool is generated instead", async () => {
    const stale = Array.from({ length: 8 }, (_, i) => ({ ...legacyQ(`q${i}`), groundingSourceFingerprint: "fp-old", groundingAssignmentFingerprint: "tga1:old" }));
    const h = questionHarness(topicRow("READY"), stale);
    const r = await h.practice.getAdaptiveQuestions("u", "subject-1", TOPIC);
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(r.questions.filter((q: any) => q.id?.startsWith("q"))).toEqual([]);
  });
});

describe("J — published Questions copy the draft's provenance", () => {
  function publishHarness(draft: any) {
    const create = jest.fn().mockImplementation(async ({ data }: any) => ({ id: "question-1", ...data }));
    const prisma = {
      client: {
        questionDraft: { findUnique: jest.fn().mockResolvedValue(draft) },
        topic: { findUnique: jest.fn().mockResolvedValue({ id: TOPIC, lessons: [{ isPlaceholder: false }] }) },
        $transaction: async (fn: any) => fn({ question: { create }, questionDraft: { update: jest.fn() }, topic: { findUnique: jest.fn().mockResolvedValue({ id: TOPIC }) } }),
      },
    } as any;
    return { service: new QuestionPublishService(prisma), create };
  }
  const draft = { id: "qd-1", topicId: TOPIC, status: "approved", publishedQuestionId: null, isAiGenerated: true, ...VALID_Q };
  it("autoPublish copies both fingerprints verbatim", async () => {
    const h = publishHarness({ ...draft, ...currentGateProvenance() });
    await h.service.autoPublish("qd-1");
    expect(h.create.mock.calls[0][0].data).toMatchObject(currentGateProvenance());
  });
  it("a draft without provenance publishes a LEGACY (null) Question — never a fabricated fingerprint", async () => {
    const h = publishHarness({ ...draft, groundingSourceFingerprint: null, groundingAssignmentFingerprint: null });
    await h.service.autoPublish("qd-1");
    expect(h.create.mock.calls[0][0].data).toMatchObject({ groundingSourceFingerprint: null, groundingAssignmentFingerprint: null });
  });
});

describe("D/F/G/I — lesson generation", () => {
  const AUTO_DRAFT = {
    topicNameEn: "Topic",
    learningObjectives: [{ objectiveEn: "Learn addition", objectiveAr: "تعلم الجمع" }, { objectiveEn: "Practise addition", objectiveAr: "تدرب على الجمع" }],
    steps: [
      { id: "s1", type: "INTRO", order: 1, objective: "Introduce addition" },
      { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain addition" },
      { id: "s3", type: "CHECK", order: 3, objective: "Check addition" },
      { id: "s4", type: "COMPLETE", order: 4, objective: "Wrap up addition" },
    ],
  };
  function lessonHarness(topic: any) {
    const generate = jest.fn().mockResolvedValue({ content: JSON.stringify(AUTO_DRAFT), inputTokens: 5, outputTokens: 5 });
    const prisma = {
      client: {
        topic: { findUnique: jest.fn().mockResolvedValue(topic) },
        unit: { findUnique: jest.fn().mockResolvedValue({ id: "unit-gate", nameEn: "Unit", subjectId: "subject-1", sourceFileOverride: null, groundingNotesJson: topic.unit.groundingNotesJson, groundingVersion: 1, subject: { nameEn: "Mathematics", sourceFile: "eg/g5/math.pdf", grade: { nameEn: "Grade 5", curriculum: { nameEn: "EG" } } }, _count: { topics: 1 } }) },
        lessonDraft: { create: jest.fn().mockResolvedValue({ id: "draft-1" }) },
        aIUsage: { create: jest.fn().mockResolvedValue(undefined) },
      },
    } as any;
    const usage = { assertWithinBudget: jest.fn().mockResolvedValue(undefined), estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01), reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "r" }), reconcileBudget: jest.fn().mockResolvedValue(undefined), releaseBudget: jest.fn().mockResolvedValue(undefined) };
    const providerFactory = { getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate }, providerKey: "openai", model: "gpt-4o-mini" }), getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0, costPerOutputToken: 0 }) };
    const service = new LessonDraftGeneratorService(prisma, providerFactory as any, { buildAutoLessonGenerationPrompt: jest.fn().mockReturnValue("p") } as any, usage as any, { autoPublishIntoTopic: jest.fn() } as any, {} as any);
    return { service, generate, usage, prisma };
  }
  it.each(["BLOCKED", "STALE", "EMPTY", "MISSING"] as const)("D/F/G: generateAutoDraft for a %s Topic of a mapped textbook refuses before any budget/provider call", async (state) => {
    const h = lessonHarness(topicRow(state));
    await expect(h.service.generateAutoDraft({ id: TOPIC, nameEn: "Topic", nameAr: "موضوع", unitId: "unit-gate" }, { preferredLang: "en", studentAgeRange: "6-12" }, "actor")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.usage.assertWithinBudget).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.prisma.client.lessonDraft.create).not.toHaveBeenCalled();
  });
  it("E/I: a READY Topic generates and returns the CURRENT provenance for publishing", async () => {
    const h = lessonHarness(topicRow("READY"));
    const r = await h.service.generateAutoDraft({ id: TOPIC, nameEn: "Topic", nameAr: "موضوع", unitId: "unit-gate" }, { preferredLang: "en", studentAgeRange: "6-12" }, "actor");
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(r.generationSource).toBe("TEXTBOOK_GROUNDED");
    expect(r.provenance).toEqual(currentGateProvenance());
  });
  it("I: autoPublishIntoTopic persists the provenance on the Topic, and clears it when regenerated without one", async () => {
    const update = jest.fn().mockImplementation(async ({ data }: any) => ({ id: TOPIC, ...data }));
    const tx = { lessonDraft: { updateMany: jest.fn(), update: jest.fn() }, lesson: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), create: jest.fn().mockResolvedValue({ id: "lesson-1" }) }, learningObjective: { deleteMany: jest.fn(), create: jest.fn().mockResolvedValue({ id: "o" }) }, topic: { update } };
    const prisma = { client: { lessonDraft: { findUnique: jest.fn().mockResolvedValue({ id: "draft-1", publishedTopicId: null, topicNameEn: "Topic", topicNameAr: "موضوع", teachingStepsJson: AUTO_DRAFT.steps, learningObjectivesJson: AUTO_DRAFT.learningObjectives }) }, $transaction: async (fn: any) => fn(tx) } } as any;
    const publisher = new LessonPublishService(prisma);
    await publisher.autoPublishIntoTopic("draft-1", TOPIC, { generationSource: "TEXTBOOK_GROUNDED", groundingVersionUsed: 1, generationPromptVersion: "auto-lesson-v1", provenance: currentGateProvenance() });
    expect(update.mock.calls[0][0].data).toMatchObject({ groundingSourceFingerprintUsed: currentGateProvenance().groundingSourceFingerprint, groundingAssignmentFingerprintUsed: currentGateProvenance().groundingAssignmentFingerprint });
    await publisher.autoPublishIntoTopic("draft-1", TOPIC, { generationSource: "LEGACY_TITLE_ONLY", groundingVersionUsed: null, generationPromptVersion: "auto-lesson-v1" });
    expect(update.mock.calls[1][0].data).toMatchObject({ groundingSourceFingerprintUsed: null, groundingAssignmentFingerprintUsed: null });
    const published = withReadyGate({ id: TOPIC, groundingSourceFingerprintUsed: update.mock.calls[0][0].data.groundingSourceFingerprintUsed, groundingAssignmentFingerprintUsed: update.mock.calls[0][0].data.groundingAssignmentFingerprintUsed }, { contentProvenanceEnforcedAt: new Date() });
    expect(canServeTopicSteps(published as any)).toBe(true); // L: freshly published content is servable even under STRICT
  });
});

describe("O — admin regeneration replaces legacy content without weakening runtime safety", () => {
  const regenTopic = (state: "READY" | "BLOCKED", over: Record<string, unknown> = {}) => ({ ...topicRow(state), questions: [legacyQ("q1"), legacyQ("q2")], ...over });
  it("parses only an explicit, bounded allowlist and defaults to dry-run", () => {
    expect(parseRegenArgs(["--topicIds=cmucxcvs0017z2qd5s6rim1j2"])).toEqual({ topicIds: ["cmucxcvs0017z2qd5s6rim1j2"], apply: false, lesson: true, questions: true });
    const many = Array.from({ length: MAX_TOPICS_PER_RUN + 1 }, (_, i) => `cmucxcvs0017z2qd5s6rim${String(i).padStart(3, "0")}`).join(",");
    for (const bad of [[], ["--unitId=cmucxcvs0017z2qd5s6rim1j2"], ["--topicIds=x y"], [`--topicIds=${many}`], ["--topicIds=cmucxcvs0017z2qd5s6rim1j2", "--lesson-only", "--questions-only"]]) expect(() => parseRegenArgs(bad)).toThrow();
  });
  it("a READY Topic with LEGACY steps + LEGACY Questions is planned for full regeneration; dry-run makes zero calls", async () => {
    const deps = { loadTopic: jest.fn().mockResolvedValue(regenTopic("READY")), regenerateLesson: jest.fn(), generateQuestions: jest.fn() };
    const out = await runRegeneration({ topicIds: [TOPIC], apply: false, lesson: true, questions: true }, deps);
    expect(out.results[0]).toMatchObject({ gate: "READY", steps: "LEGACY", lessonAction: "REGENERATE", questions: { LEGACY: 2, CURRENT: 0, MISMATCH: 0 }, questionsToGenerate: 8 });
    expect(deps.regenerateLesson).not.toHaveBeenCalled();
    expect(deps.generateQuestions).not.toHaveBeenCalled();
  });
  it("--apply regenerates the lesson and a full CURRENT pool even though student runtime would never regenerate existing content", async () => {
    const deps = { loadTopic: jest.fn().mockResolvedValue(regenTopic("READY")), regenerateLesson: jest.fn(), generateQuestions: jest.fn().mockResolvedValue(8) };
    const out = await runRegeneration({ topicIds: [TOPIC], apply: true, lesson: true, questions: true }, deps);
    expect(deps.regenerateLesson).toHaveBeenCalledTimes(1);
    expect(deps.generateQuestions).toHaveBeenCalledWith(TOPIC, 8);
    expect(out.results[0]).toMatchObject({ lessonRegenerated: true, questionsPublished: 8 });
  });
  it("already-CURRENT steps and a full CURRENT pool are skipped (idempotent)", () => {
    const cur = currentGateProvenance();
    const plan = planTopic({ ...regenTopic("READY"), groundingSourceFingerprintUsed: cur.groundingSourceFingerprint, groundingAssignmentFingerprintUsed: cur.groundingAssignmentFingerprint, questions: Array.from({ length: 8 }, () => ({ ...cur })) } as any, { lesson: true, questions: true });
    expect(plan).toMatchObject({ steps: "CURRENT", lessonAction: "SKIP_CURRENT", questionsToGenerate: 0 });
  });
  it("a BLOCKED Topic is refused with zero calls — admin tooling never bypasses the gate", async () => {
    const deps = { loadTopic: jest.fn().mockResolvedValue(regenTopic("BLOCKED")), regenerateLesson: jest.fn(), generateQuestions: jest.fn() };
    await expect(runRegeneration({ topicIds: [TOPIC], apply: true, lesson: true, questions: true }, deps)).rejects.toThrow(/not READY_CURRENT_NON_EMPTY/);
    expect(deps.regenerateLesson).not.toHaveBeenCalled();
    expect(deps.generateQuestions).not.toHaveBeenCalled();
  });
  it("stops at the first failure and never touches later Topics", async () => {
    const deps = { loadTopic: jest.fn().mockImplementation(async (id: string) => (id === "a" ? regenTopic("BLOCKED") : regenTopic("READY"))), regenerateLesson: jest.fn(), generateQuestions: jest.fn() };
    await expect(runRegeneration({ topicIds: ["a", "b"], apply: true, lesson: true, questions: true }, deps)).rejects.toThrow();
    expect(deps.loadTopic).toHaveBeenCalledTimes(1);
  });
  it("STRICT enforcement is refused while any READY Topic still relies on LEGACY content, and allowed once it is CURRENT", () => {
    const cur = currentGateProvenance();
    expect(strictReadinessBlockers([regenTopic("READY")] as any)).toHaveLength(2);
    const regenerated = { ...regenTopic("READY"), groundingSourceFingerprintUsed: cur.groundingSourceFingerprint, groundingAssignmentFingerprintUsed: cur.groundingAssignmentFingerprint, questions: [legacyQ("q1"), ...Array.from({ length: 8 }, () => ({ ...cur }))] };
    expect(strictReadinessBlockers([regenerated] as any)).toEqual([]);
    expect(strictReadinessBlockers([regenTopic("BLOCKED")] as any)).toEqual([]); // never served in either mode
  });
});

describe("P — existing grounding/assignment invariants are unchanged", () => {
  it("the gate is a pure read: evaluating it never mutates the Topic/assignment/Unit", () => {
    const t = topicRow("READY");
    const before = JSON.stringify(t);
    evaluateTopicGroundingGate(t as any);
    expect(JSON.stringify(t)).toBe(before);
  });
  it("re-grounding a Unit (new fingerprint) turns previously-CURRENT content into MISMATCH, never CURRENT", () => {
    const old = currentGateProvenance();
    const regrounded = { ...withReadyGate({ id: TOPIC }, { groundingSourceFingerprint: "fp-regrounded" }), groundingAssignment: gateAssignment({ unitSourceFingerprint: "fp-regrounded" }) };
    const gate = evaluateTopicGroundingGate(regrounded as any);
    expect(gate.state).toBe("READY");
    if (gate.state === "READY") expect(classifyContentProvenance(old, gate.provenance)).toBe("MISMATCH");
  });
});
