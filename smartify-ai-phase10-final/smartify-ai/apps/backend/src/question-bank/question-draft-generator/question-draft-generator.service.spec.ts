import { QuestionDraftGeneratorService, QuestionDraftGenerationError } from "./question-draft-generator.service";
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

/**
 * generateAutoQuestionBatch — bounded truncation retry (2026-09-27, "the
 * Forces lesson incident"): maxOutputTokens must be a FIXED budget on every
 * normal attempt (never scaled by `count`), and may only be bumped, for
 * exactly one retry, when a response fails specifically because it looks
 * truncated/invalid-JSON — never for a normal success and never for an
 * unrelated business-rule/schema validation failure on otherwise-complete
 * JSON.
 */
describe("QuestionDraftGeneratorService.generateAutoQuestionBatch — maxOutputTokens truncation retry", () => {
  const REQUESTING_USER_ID = "content-authoring";
  const TOPIC_ID = "topic-1";
  const FIXED_MAX_OUTPUT_TOKENS = 4000;
  const TRUNCATION_RETRY_MAX_OUTPUT_TOKENS = 6000;

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

  // A truncated/invalid-JSON response: cut off mid-object, doesn't parse
  // and doesn't end with a closing brace/bracket — the actual "Forces
  // lesson" signature (maxOutputTokens=600 cutting an in-progress batch).
  const TRUNCATED_RESPONSE = '{"questions": [{"type": "MULTIPLE_CHOICE", "promptEn": "What is';

  function makeBatchHarness(generateImpl: (call: number) => { content: string; inputTokens: number; outputTokens: number }) {
    let callCount = 0;
    const generateSpy = jest.fn().mockImplementation(async () => {
      callCount++;
      return generateImpl(callCount);
    });

    const prisma = {
      client: {
        topic: {
          findUnique: jest.fn().mockResolvedValue({
            id: TOPIC_ID,
            nameEn: "Test Topic",
            groundingAssignment: null,
            unit: {
              nameEn: "Unit 1",
              groundingNotesJson: null,
              groundingVersion: null,
              groundingSourceFingerprint: null,
              subject: { nameEn: "Science", grade: { nameEn: "Year 5", curriculum: { nameEn: "Test Curriculum" } } },
              _count: { topics: 1 },
            },
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

    const publisher = { autoPublish: jest.fn().mockResolvedValue(undefined) };
    const lessonGenerator = { ensureTopicHasLesson: jest.fn().mockResolvedValue({ teachingStepsJson: [{ id: "s1" }] }) };

    const service = new QuestionDraftGeneratorService(prisma as any, providerFactory as any, contextBuilder as any, usageService as any, publisher as any, lessonGenerator as any);

    return { service, prisma, generateSpy };
  }

  it("1 — a normal valid response makes exactly one provider call at the fixed budget, no retry", async () => {
    const { service, generateSpy } = makeBatchHarness(() => ({
      content: JSON.stringify({ questions: [VALID_QUESTION] }),
      inputTokens: 5,
      outputTokens: 5,
    }));

    const result = await service.generateAutoQuestionBatch(TOPIC_ID, 3, REQUESTING_USER_ID);

    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(generateSpy.mock.calls[0][0].maxOutputTokens).toBe(FIXED_MAX_OUTPUT_TOKENS);
    expect(result.attempts).toBe(1);
    expect(result.callsMade).toBe(1);
  });

  it("2 — a truncated/invalid-JSON response triggers exactly one retry with a higher maxOutputTokens, which then succeeds", async () => {
    const { service, generateSpy } = makeBatchHarness((call) =>
      call === 1
        ? { content: TRUNCATED_RESPONSE, inputTokens: 5, outputTokens: 600 }
        : { content: JSON.stringify({ questions: [VALID_QUESTION] }), inputTokens: 5, outputTokens: 5 },
    );

    const result = await service.generateAutoQuestionBatch(TOPIC_ID, 3, REQUESTING_USER_ID);

    expect(generateSpy).toHaveBeenCalledTimes(2);
    expect(generateSpy.mock.calls[0][0].maxOutputTokens).toBe(FIXED_MAX_OUTPUT_TOKENS);
    expect(generateSpy.mock.calls[1][0].maxOutputTokens).toBe(TRUNCATION_RETRY_MAX_OUTPUT_TOKENS);
    expect(result.attempts).toBe(2);
    expect(result.callsMade).toBe(2);
  });

  it("3 — if the higher-budget retry ALSO comes back truncated/invalid, the method stops and throws — no third attempt", async () => {
    const { service, generateSpy } = makeBatchHarness(() => ({
      content: TRUNCATED_RESPONSE,
      inputTokens: 5,
      outputTokens: 600,
    }));

    await expect(service.generateAutoQuestionBatch(TOPIC_ID, 3, REQUESTING_USER_ID)).rejects.toBeInstanceOf(QuestionDraftGenerationError);

    expect(generateSpy).toHaveBeenCalledTimes(2);
    expect(generateSpy.mock.calls[0][0].maxOutputTokens).toBe(FIXED_MAX_OUTPUT_TOKENS);
    expect(generateSpy.mock.calls[1][0].maxOutputTokens).toBe(TRUNCATION_RETRY_MAX_OUTPUT_TOKENS);
  });

  it("4 — an unrelated validation failure on complete, valid JSON (missing questions array) does NOT bump maxOutputTokens on retry", async () => {
    const { service, generateSpy } = makeBatchHarness((call) =>
      call === 1
        ? { content: JSON.stringify({ notQuestions: [] }), inputTokens: 5, outputTokens: 5 }
        : { content: JSON.stringify({ questions: [VALID_QUESTION] }), inputTokens: 5, outputTokens: 5 },
    );

    const result = await service.generateAutoQuestionBatch(TOPIC_ID, 3, REQUESTING_USER_ID);

    expect(generateSpy).toHaveBeenCalledTimes(2);
    expect(generateSpy.mock.calls[0][0].maxOutputTokens).toBe(FIXED_MAX_OUTPUT_TOKENS);
    // Still the fixed default, not the truncation-retry budget — this
    // failure was a valid, complete JSON object that just failed a
    // business-rule/schema check, not a truncation signature.
    expect(generateSpy.mock.calls[1][0].maxOutputTokens).toBe(FIXED_MAX_OUTPUT_TOKENS);
    expect(result.attempts).toBe(2);
  });
});
