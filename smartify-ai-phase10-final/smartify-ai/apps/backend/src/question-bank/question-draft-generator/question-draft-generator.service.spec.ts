import { QuestionDraftGeneratorService } from "./question-draft-generator.service";
import { CONTENT_AUTHORING_ACTOR_ID } from "../../ai/content-authoring-actor.const";

/**
 * Budget-attribution regression suite (2026-09-20) — mirrors
 * lesson-draft-generator.service.spec.ts. ensurePoolForTopic() generates a
 * QUESTION POOL that is shared, permanently-cached curriculum content —
 * never per-student — so generateAutoQuestionBatch() must bill
 * CONTENT_AUTHORING_ACTOR_ID, not the real student who happened to be
 * first to reach Practice/Quiz for an empty-pool Topic. The call into
 * ensureTopicHasLesson() right before it still passes the real student id
 * unchanged — that only affects that method's own lock bookkeeping (see
 * its own fix), never AI spend, and is itself covered by
 * lesson-draft-generator.service.spec.ts.
 */
describe("QuestionDraftGeneratorService.ensurePoolForTopic — budget attribution", () => {
  const REAL_STUDENT_ID = "real-student-1";
  const TOPIC_ID = "topic-1";

  const VALID_QUESTION = {
    type: "MULTIPLE_CHOICE",
    difficulty: "EASY",
    promptEn: "What is 2 + 2?",
    promptAr: "ما هو ٢ + ٢؟",
    optionsJson: ["3", "4", "5"],
    correctAnswerJson: "4",
    explanationEn: "2 + 2 equals 4.",
    explanationAr: "٢ + ٢ يساوي ٤.",
  };

  function makeHarness(existingQuestionCount = 0) {
    const generateSpy = jest.fn().mockResolvedValue({
      content: JSON.stringify({ questions: [VALID_QUESTION] }),
      inputTokens: 5,
      outputTokens: 5,
    });

    const prisma = {
      client: {
        question: {
          count: jest.fn().mockResolvedValue(existingQuestionCount),
        },
        topic: {
          findUnique: jest.fn().mockResolvedValue({
            id: TOPIC_ID,
            nameEn: "Test Topic",
            unit: { nameEn: "Unit 1", groundingNotesJson: null, groundingVersion: null, subject: { nameEn: "Science", grade: { nameEn: "Year 5", curriculum: { nameEn: "Test Curriculum" } } }, _count: { topics: 1 } },
            lessons: [{ isPlaceholder: false, objectives: [] }],
          }),
        },
        questionDraft: {
          create: jest.fn().mockResolvedValue({ id: "qd-1" }),
        },
        aIUsage: {
          create: jest.fn().mockResolvedValue(undefined),
        },
      },
    };

    const providerFactory = {
      getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate: generateSpy }, providerKey: "openai", model: "gpt-4o-mini" }),
      getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0.0001, costPerOutputToken: 0.0002 }),
    };

    const contextBuilder = {
      buildAutoQuestionBatchGenerationPrompt: jest.fn().mockReturnValue("system prompt"),
    };

    const usageService = {
      assertWithinBudget: jest.fn().mockResolvedValue(undefined),
      estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01),
      reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "res-1" }),
      reconcileBudget: jest.fn().mockResolvedValue(undefined),
      releaseBudget: jest.fn().mockResolvedValue(undefined),
    };

    const publisher = {
      autoPublish: jest.fn().mockResolvedValue(undefined),
    };

    const lessonGenerator = {
      ensureTopicHasLesson: jest.fn().mockResolvedValue({ teachingStepsJson: [{ id: "s1" }] }),
    };

    const service = new QuestionDraftGeneratorService(prisma as any, providerFactory as any, contextBuilder as any, usageService as any, publisher as any, lessonGenerator as any);

    return { service, prisma, providerFactory, usageService, publisher, lessonGenerator, generateSpy };
  }

  it("B — empty pool: the question-batch generation is billed to CONTENT_AUTHORING_ACTOR_ID, never the real triggering student", async () => {
    const { service, usageService, prisma } = makeHarness(0);

    await service.ensurePoolForTopic(TOPIC_ID, REAL_STUDENT_ID);

    expect(usageService.assertWithinBudget).toHaveBeenCalledWith(CONTENT_AUTHORING_ACTOR_ID);
    expect(usageService.assertWithinBudget).not.toHaveBeenCalledWith(REAL_STUDENT_ID);
    expect(usageService.reserveBudget).toHaveBeenCalledWith(CONTENT_AUTHORING_ACTOR_ID, expect.any(Number));
    expect(usageService.reserveBudget).not.toHaveBeenCalledWith(REAL_STUDENT_ID, expect.any(Number));
    expect(prisma.client.aIUsage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: CONTENT_AUTHORING_ACTOR_ID }) }));
    expect(prisma.client.questionDraft.create).toHaveBeenCalledTimes(1);
  });

  it("the preceding ensureTopicHasLesson() call still receives the real triggering student's id unchanged — only its own lock bookkeeping cares", async () => {
    const { service, lessonGenerator } = makeHarness(0);

    await service.ensurePoolForTopic(TOPIC_ID, REAL_STUDENT_ID);

    expect(lessonGenerator.ensureTopicHasLesson).toHaveBeenCalledWith(TOPIC_ID, { preferredLang: "ar", studentAgeRange: "6-12" }, REAL_STUDENT_ID);
  });

  it("H — an already-sufficient pool never calls the lesson generator or the AI provider at all — pure cache hit, nothing to bill", async () => {
    const { service, lessonGenerator, providerFactory, prisma } = makeHarness(8); // targetCount defaults to 8

    await service.ensurePoolForTopic(TOPIC_ID, REAL_STUDENT_ID);

    expect(lessonGenerator.ensureTopicHasLesson).not.toHaveBeenCalled();
    expect(providerFactory.getActiveProvider).not.toHaveBeenCalled();
    expect(prisma.client.questionDraft.create).not.toHaveBeenCalled();
  });
});
