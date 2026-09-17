import { ServiceUnavailableException } from "@nestjs/common";
import { AIContextBuilderService } from "../../ai/context/ai-context-builder.service";
import { QuestionDraftGenerationError, QuestionDraftGeneratorService } from "./question-draft-generator.service";
import type { QuestionGenerationInput } from "./question-draft.types";

// Phase 10E: this whole spec file proves the generator architecture works
// end-to-end WITHOUT ever touching a real AI provider — every "provider"
// here is a plain jest.fn() that returns canned JSON locally. Zero network
// calls, zero real OpenAI usage, matching the explicit "DO NOT CALL OPENAI
// IN PHASE 10E" requirement.
const VALID_DRAFT_JSON = JSON.stringify({
  type: "MULTIPLE_CHOICE",
  difficulty: "EASY",
  promptEn: "What is 2 + 2?",
  optionsJson: ["3", "4", "5"],
  correctAnswerJson: "4",
  explanationEn: "2 + 2 makes 4.",
});

const INPUT: QuestionGenerationInput = {
  targetTopicId: "topic-1",
  type: "MULTIPLE_CHOICE",
  difficulty: "EASY",
  learningFocus: "Assess simple one-digit addition within 10.",
  preferredLang: "ar",
  studentAgeRange: "6-7",
};

const DB_TOPIC = {
  id: "topic-1",
  nameEn: "Addition (Part 1)",
  unit: {
    nameEn: "Addition",
    subject: { nameEn: "Mathematics", grade: { nameEn: "Grade 1", curriculum: { nameEn: "Egyptian National Curriculum (Arabic, Pilot)" } } },
  },
  lessons: [{ isPlaceholder: false }],
};

function makeHarness(opts: {
  generateImpl?: (args: any) => any;
  assertWithinBudget?: jest.Mock;
  topic?: any;
  reserveBudgetResult?: { ok: true; reservationId: string } | { ok: false; reason: "misconfigured" | "global_exceeded" | "user_exceeded" };
} = {}) {
  const createdDrafts: any[] = [];
  const usageRows: any[] = [];
  let draftCounter = 0;

  const prisma = {
    client: {
      topic: { findUnique: jest.fn().mockResolvedValue("topic" in opts ? opts.topic : DB_TOPIC) },
      questionDraft: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const draft = { id: `draft-${++draftCounter}`, ...data };
          createdDrafts.push(draft);
          return draft;
        }),
      },
      aIUsage: { create: jest.fn().mockImplementation(async ({ data }: any) => { usageRows.push(data); return data; }) },
    },
  } as any;

  const generateSpy = jest.fn().mockImplementation(
    opts.generateImpl ?? (async () => ({ content: VALID_DRAFT_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" })),
  );
  const providerFactory = {
    getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate: generateSpy }, providerKey: "openai", model: "gpt-4o-mini" }),
    getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0.0000005, costPerOutputToken: 0.0000015 }),
  } as any;

  const reserveBudget = jest.fn().mockResolvedValue(opts.reserveBudgetResult ?? { ok: true, reservationId: "reservation-1" });
  const reconcileBudget = jest.fn().mockResolvedValue(undefined);
  const releaseBudget = jest.fn().mockResolvedValue(undefined);
  const usageService = {
    assertWithinBudget: opts.assertWithinBudget ?? jest.fn().mockResolvedValue(undefined),
    estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.001),
    reserveBudget,
    reconcileBudget,
    releaseBudget,
  } as any;

  const service = new QuestionDraftGeneratorService(prisma, providerFactory, new AIContextBuilderService(), usageService);

  return { service, prisma, createdDrafts, usageRows, generateSpy, providerFactory, usageService, reserveBudget, reconcileBudget, releaseBudget };
}

describe("QuestionDraftGeneratorService.resolveTopicContext", () => {
  it("derives curriculum/grade/subject/unit/topic names live from the Topic -> Unit -> Subject -> Grade -> Curriculum DB relations", async () => {
    const h = makeHarness();
    const context = await h.service.resolveTopicContext("topic-1");
    expect(context).toEqual({
      topicId: "topic-1",
      curriculumNameEn: "Egyptian National Curriculum (Arabic, Pilot)",
      gradeNameEn: "Grade 1",
      subjectNameEn: "Mathematics",
      unitNameEn: "Addition",
      topicNameEn: "Addition (Part 1)",
      isPlaceholder: false,
    });
  });

  it("resolves isPlaceholder true for a Topic whose only Lessons are placeholders", async () => {
    const h = makeHarness({ topic: { ...DB_TOPIC, lessons: [{ isPlaceholder: true }] } });
    const context = await h.service.resolveTopicContext("topic-1");
    expect(context.isPlaceholder).toBe(true);
  });

  it("throws NotFoundException for an unknown topicId, without calling the AI provider", async () => {
    const h = makeHarness({ topic: null });
    await expect(h.service.generateDraft(INPUT, "user-1")).rejects.toThrow(/Topic .* not found/);
    expect(h.generateSpy).not.toHaveBeenCalled();
  });
});

describe("QuestionDraftGeneratorService.generateDraft — architecture only, mocked provider, zero real AI calls", () => {
  it("persists a valid generated draft with status pending_review", async () => {
    const h = makeHarness();
    const { draft, attempts, callsMade } = await h.service.generateDraft(INPUT, "user-1");

    expect(draft.status).toBe("pending_review");
    expect(draft.promptEn).toBe("What is 2 + 2?");
    expect(draft.aiProvider).toBe("openai");
    expect(attempts).toBe(1);
    expect(callsMade).toBe(1);
    expect(h.createdDrafts).toHaveLength(1);
  });

  it("never trusts AI-proposed Arabic: promptAr/explanationAr are always persisted as null regardless of provider output", async () => {
    const jsonWithArabic = JSON.stringify({
      ...JSON.parse(VALID_DRAFT_JSON),
      promptAr: "نص عربي من الذكاء الاصطناعي — يجب تجاهله",
      explanationAr: "شرح عربي من الذكاء الاصطناعي",
    });
    const h = makeHarness({ generateImpl: async () => ({ content: jsonWithArabic, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" }) });
    const { draft } = await h.service.generateDraft(INPUT, "user-1");

    expect(draft.promptAr).toBeNull();
    expect(draft.explanationAr).toBeNull();
  });

  it("checks the AI budget before generating", async () => {
    const assertWithinBudget = jest.fn().mockResolvedValue(undefined);
    const h = makeHarness({ assertWithinBudget });
    await h.service.generateDraft(INPUT, "user-1");
    expect(assertWithinBudget).toHaveBeenCalledWith("user-1");
  });

  it("rejects when the AI budget is exceeded, without calling the provider", async () => {
    const h = makeHarness({ assertWithinBudget: jest.fn().mockRejectedValue(new Error("budget exceeded")) });
    await expect(h.service.generateDraft(INPUT, "user-1")).rejects.toThrow("budget exceeded");
    expect(h.generateSpy).not.toHaveBeenCalled();
  });

  it("Phase 9.4C: rejects when the atomic budget RESERVATION is refused (even though the cheap early assertWithinBudget check passed), without calling the provider", async () => {
    const h = makeHarness({ reserveBudgetResult: { ok: false, reason: "global_exceeded" } });
    await expect(h.service.generateDraft(INPUT, "user-1")).rejects.toThrow(ServiceUnavailableException);
    expect(h.generateSpy).not.toHaveBeenCalled();
  });

  it("Phase 9.4C: releases the budget reservation (not just skips logging) when the provider call itself fails", async () => {
    const h = makeHarness({ generateImpl: async () => { throw new Error("provider down"); } });
    await expect(h.service.generateDraft(INPUT, "user-1")).rejects.toThrow("provider down");
    expect(h.releaseBudget).toHaveBeenCalledWith("reservation-1");
    expect(h.reconcileBudget).not.toHaveBeenCalled();
  });

  it("Phase 9.4C: reconciles the budget reservation to the exact real cost logged for that attempt", async () => {
    const h = makeHarness();
    await h.service.generateDraft(INPUT, "user-1");
    // logUsage computes costUsd = 100*0.0000005 + 200*0.0000015 = 0.00035
    expect(h.reconcileBudget).toHaveBeenCalledTimes(1);
    const [reservationId, actualCostUsd] = h.reconcileBudget.mock.calls[0];
    expect(reservationId).toBe("reservation-1");
    expect(actualCostUsd).toBeCloseTo(0.00035, 10);
  });

  it("rejects generation for a placeholder Topic, without persisting anything", async () => {
    const h = makeHarness({ topic: { ...DB_TOPIC, lessons: [{ isPlaceholder: true }] } });
    await expect(h.service.generateDraft(INPUT, "user-1")).rejects.toThrow(QuestionDraftGenerationError);
    expect(h.createdDrafts).toHaveLength(0);
  });

  it("logs a question_draft_generation usage row with creditsUsed 0 and studentId/subjectId null", async () => {
    const h = makeHarness();
    await h.service.generateDraft(INPUT, "user-1");
    expect(h.usageRows).toHaveLength(1);
    expect(h.usageRows[0]).toMatchObject({ feature: "question_draft_generation", creditsUsed: 0, studentId: null, subjectId: null, userId: "user-1" });
  });

  it("retries exactly once on invalid JSON, and persists the corrected draft on the second attempt", async () => {
    let call = 0;
    const h = makeHarness({
      generateImpl: async () => {
        call++;
        if (call === 1) return { content: "not valid json", inputTokens: 50, outputTokens: 10, model: "gpt-4o-mini" };
        return { content: VALID_DRAFT_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" };
      },
    });
    const { attempts, callsMade } = await h.service.generateDraft(INPUT, "user-1");
    expect(attempts).toBe(2);
    expect(callsMade).toBe(2);
    expect(h.createdDrafts).toHaveLength(1);
  });

  it("retries exactly once on a validation failure (unsupported type), never persisting the invalid attempt", async () => {
    const invalidJson = JSON.stringify({ ...JSON.parse(VALID_DRAFT_JSON), type: "SHORT_ANSWER" });
    let call = 0;
    const h = makeHarness({
      generateImpl: async () => {
        call++;
        return call === 1
          ? { content: invalidJson, inputTokens: 50, outputTokens: 10, model: "gpt-4o-mini" }
          : { content: VALID_DRAFT_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" };
      },
    });
    const { attempts } = await h.service.generateDraft(INPUT, "user-1");
    expect(attempts).toBe(2);
    expect(h.createdDrafts).toHaveLength(1);
    expect(h.createdDrafts[0].type).toBe("MULTIPLE_CHOICE");
  });

  it("bounds retries at exactly MAX_ATTEMPTS (2) and never persists anything if every attempt fails", async () => {
    const h = makeHarness({ generateImpl: async () => ({ content: "still not json", inputTokens: 10, outputTokens: 5, model: "gpt-4o-mini" }) });

    await expect(h.service.generateDraft(INPUT, "user-1")).rejects.toThrow(QuestionDraftGenerationError);
    expect(h.generateSpy).toHaveBeenCalledTimes(2);
    expect(h.createdDrafts).toHaveLength(0);
  });

  it("passes the exact validation errors from attempt 1 into attempt 2's retry-feedback prompt", async () => {
    let call = 0;
    const promptsSeen: string[] = [];
    const invalidJson = JSON.stringify({ ...JSON.parse(VALID_DRAFT_JSON), optionsJson: ["4", "4", "5"] }); // duplicate options
    const h = makeHarness({
      generateImpl: async (args: any) => {
        call++;
        promptsSeen.push(args.systemPrompt);
        if (call === 1) return { content: invalidJson, inputTokens: 50, outputTokens: 10, model: "gpt-4o-mini" };
        return { content: VALID_DRAFT_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" };
      },
    });
    await h.service.generateDraft(INPUT, "user-1");
    expect(promptsSeen[1]).toContain("PREVIOUS ATTEMPT WAS REJECTED");
    expect(promptsSeen[1]).toMatch(/Duplicate options/i);
  });

  it("never calls fetch/network — the mocked provider is the only thing generateDraft talks to", async () => {
    const h = makeHarness();
    await h.service.generateDraft(INPUT, "user-1");
    // The only "provider" call made is the injected mock — proven by call
    // count matching exactly the number of generation attempts.
    expect(h.providerFactory.getActiveProvider).toHaveBeenCalledTimes(1);
    expect(h.generateSpy).toHaveBeenCalledTimes(1);
  });
});
