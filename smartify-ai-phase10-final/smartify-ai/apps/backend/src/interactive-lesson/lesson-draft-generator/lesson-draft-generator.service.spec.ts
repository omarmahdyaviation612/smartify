import { AIContextBuilderService } from "../../ai/context/ai-context-builder.service";
import { LessonDraftGenerationError, LessonDraftGeneratorService } from "./lesson-draft-generator.service";
import type { LessonGenerationInput } from "./lesson-draft.types";

const VALID_STEPS_JSON = JSON.stringify({
  topicNameEn: "Addition with Zero",
  steps: [
    { id: "s1", type: "INTRO", order: 1, objective: "Greet briefly and frame today's idea.", conceptKey: "greeting_framing" },
    { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain that adding zero leaves a number unchanged.", conceptKey: "zero_rule" },
    { id: "s3", type: "CHECK", order: 3, objective: "Check the zero rule conceptually.", conceptKey: "zero_rule", checkType: "conceptual" },
    { id: "s4", type: "EXAMPLE", order: 4, objective: "Show one applied example of adding zero.", conceptKey: "zero_rule" },
    { id: "s5", type: "CHECK", order: 5, objective: "Check the student can apply the zero rule.", conceptKey: "zero_rule", checkType: "applied" },
    { id: "s6", type: "REVIEW", order: 6, objective: "Briefly recap the zero rule." },
    { id: "s7", type: "COMPLETE", order: 7, objective: "Acknowledge completion." },
  ],
});

const INPUT: LessonGenerationInput = {
  topicNameEn: "Addition with Zero",
  topicNameAr: "الجمع مع العدد صفر",
  learningObjectives: ["State and apply the rule that adding zero to a number does not change its value."],
  preferredLang: "ar",
  studentAgeRange: "6-7",
  targetUnitId: "unit-1",
};

const DB_UNIT = {
  id: "unit-1",
  nameEn: "Addition",
  subject: {
    nameEn: "Mathematics",
    grade: {
      nameEn: "Grade 1",
      curriculum: { nameEn: "Egyptian National Curriculum (Arabic, Pilot)" },
    },
  },
};

function makeHarness(opts: { generateImpl?: (args: any) => any; assertWithinBudget?: jest.Mock; unit?: any } = {}) {
  const createdDrafts: any[] = [];
  const usageRows: any[] = [];
  let draftCounter = 0;

  const prisma = {
    client: {
      unit: { findUnique: jest.fn().mockResolvedValue("unit" in opts ? opts.unit : DB_UNIT) },
      lessonDraft: {
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
    opts.generateImpl ?? (async () => ({ content: VALID_STEPS_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" })),
  );
  const providerFactory = {
    getActiveProvider: jest.fn().mockResolvedValue({ provider: { generate: generateSpy }, providerKey: "openai", model: "gpt-4o-mini" }),
    getCostRates: jest.fn().mockResolvedValue({ costPerInputToken: 0.0000005, costPerOutputToken: 0.0000015 }),
  } as any;

  const usageService = {
    assertWithinBudget: opts.assertWithinBudget ?? jest.fn().mockResolvedValue(undefined),
  } as any;

  const service = new LessonDraftGeneratorService(prisma, providerFactory, new AIContextBuilderService(), usageService);

  return { service, prisma, createdDrafts, usageRows, generateSpy, providerFactory, usageService };
}

describe("LessonDraftGeneratorService.resolveUnitContext (Phase 6, Part A)", () => {
  it("derives curriculum/grade/subject/unit names live from the Unit -> Subject -> Grade -> Curriculum DB relations, not from hand-typed input", async () => {
    const h = makeHarness();
    const context = await h.service.resolveUnitContext("unit-1");
    expect(context).toEqual({
      unitId: "unit-1",
      curriculumNameEn: "Egyptian National Curriculum (Arabic, Pilot)",
      gradeNameEn: "Grade 1",
      subjectNameEn: "Mathematics",
      unitNameEn: "Addition",
    });
    expect(h.prisma.client.unit.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "unit-1" } }),
    );
  });

  it("confirms the resolved context belongs to the correct hierarchy (grade under the right curriculum, subject under the right grade)", async () => {
    const otherUnit = {
      id: "unit-2",
      nameEn: "Subtraction",
      subject: { nameEn: "Mathematics", grade: { nameEn: "Grade 1", curriculum: { nameEn: "Egyptian National Curriculum (Arabic, Pilot)" } } },
    };
    const h = makeHarness({ unit: otherUnit });
    const context = await h.service.resolveUnitContext("unit-2");
    // The resolved names are exactly the ones nested under THIS unit's own
    // subject/grade/curriculum chain — never a mismatched/stale value.
    expect(context.unitNameEn).toBe("Subtraction");
    expect(context.subjectNameEn).toBe("Mathematics");
    expect(context.gradeNameEn).toBe("Grade 1");
    expect(context.curriculumNameEn).toBe("Egyptian National Curriculum (Arabic, Pilot)");
  });

  it("throws NotFoundException for an unknown targetUnitId, without calling the AI provider", async () => {
    const h = makeHarness({ unit: null });
    await expect(h.service.generateDraft(INPUT, "user-1")).rejects.toThrow(/Unit .* not found/);
    expect(h.generateSpy).not.toHaveBeenCalled();
  });

  it("embeds the DB-resolved context (not hand-typed strings) into the generation prompt", async () => {
    const h = makeHarness();
    await h.service.generateDraft(INPUT, "user-1");
    const promptSent = h.generateSpy.mock.calls[0][0].systemPrompt as string;
    expect(promptSent).toContain("Egyptian National Curriculum (Arabic, Pilot)");
    expect(promptSent).toContain("Grade 1");
    expect(promptSent).toContain("Mathematics");
    expect(promptSent).toContain("Unit: Addition");
  });
});

describe("LessonDraftGeneratorService", () => {
  it("persists a valid generated draft with status pending_review", async () => {
    const h = makeHarness();
    const { draft, attempts, callsMade } = await h.service.generateDraft(INPUT, "user-1");

    expect(draft.status).toBe("pending_review");
    expect(draft.topicNameEn).toBe("Addition with Zero");
    expect(draft.aiProvider).toBe("openai");
    expect(attempts).toBe(1);
    expect(callsMade).toBe(1);
    expect(h.createdDrafts).toHaveLength(1);
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

  it("Phase 10B: persists objectives in the bilingual shape with objectiveAr always null — the AI never supplies a reviewed Arabic translation", async () => {
    const h = makeHarness();
    const { draft } = await h.service.generateDraft(INPUT, "user-1");
    expect(draft.learningObjectivesJson).toEqual([
      { objectiveEn: "State and apply the rule that adding zero to a number does not change its value.", objectiveAr: null },
    ]);
  });

  it("logs a lesson_draft_generation usage row with creditsUsed 0 and studentId/subjectId null (not a student action)", async () => {
    const h = makeHarness();
    await h.service.generateDraft(INPUT, "user-1");
    expect(h.usageRows).toHaveLength(1);
    expect(h.usageRows[0]).toMatchObject({ feature: "lesson_draft_generation", creditsUsed: 0, studentId: null, subjectId: null, userId: "user-1" });
    expect(h.usageRows[0].costUsd).toBeGreaterThan(0);
  });

  it("retries exactly once on invalid JSON, and persists the corrected draft on the second attempt", async () => {
    let call = 0;
    const h = makeHarness({
      generateImpl: async () => {
        call++;
        if (call === 1) return { content: "not valid json", inputTokens: 50, outputTokens: 10, model: "gpt-4o-mini" };
        return { content: VALID_STEPS_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" };
      },
    });
    const { attempts, callsMade } = await h.service.generateDraft(INPUT, "user-1");
    expect(attempts).toBe(2);
    expect(callsMade).toBe(2);
    expect(h.createdDrafts).toHaveLength(1); // only the final, valid draft is ever persisted
  });

  it("retries exactly once on a structurally invalid draft (e.g. missing CHECK), never persisting the invalid attempt", async () => {
    const invalidJson = JSON.stringify({
      topicNameEn: "Addition with Zero",
      steps: [
        { id: "s1", type: "INTRO", order: 1, objective: "Greet." },
        { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain." },
        { id: "s3", type: "COMPLETE", order: 3, objective: "Done." },
      ],
    });
    let call = 0;
    const h = makeHarness({
      generateImpl: async () => {
        call++;
        return call === 1
          ? { content: invalidJson, inputTokens: 50, outputTokens: 10, model: "gpt-4o-mini" }
          : { content: VALID_STEPS_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" };
      },
    });
    const { attempts } = await h.service.generateDraft(INPUT, "user-1");
    expect(attempts).toBe(2);
    expect(h.createdDrafts).toHaveLength(1);
    expect(h.createdDrafts[0].teachingStepsJson).toHaveLength(7); // the corrected, valid version
  });

  it("bounds retries at exactly MAX_ATTEMPTS (2) and never persists anything if every attempt fails", async () => {
    const h = makeHarness({ generateImpl: async () => ({ content: "still not json", inputTokens: 10, outputTokens: 5, model: "gpt-4o-mini" }) });

    await expect(h.service.generateDraft(INPUT, "user-1")).rejects.toThrow(LessonDraftGenerationError);
    expect(h.generateSpy).toHaveBeenCalledTimes(2); // exactly bounded, never an uncontrolled loop
    expect(h.createdDrafts).toHaveLength(0); // failure never persists/publishes as approved content
  });

  it("passes the exact validation errors from attempt 1 into attempt 2's retry-feedback prompt", async () => {
    let call = 0;
    const promptsSeen: string[] = [];
    const h = makeHarness({
      generateImpl: async (args: any) => {
        call++;
        promptsSeen.push(args.systemPrompt);
        if (call === 1) {
          return { content: JSON.stringify({ topicNameEn: "Wrong Topic Name", steps: JSON.parse(VALID_STEPS_JSON).steps }), inputTokens: 50, outputTokens: 10, model: "gpt-4o-mini" };
        }
        return { content: VALID_STEPS_JSON, inputTokens: 100, outputTokens: 200, model: "gpt-4o-mini" };
      },
    });
    await h.service.generateDraft(INPUT, "user-1");
    expect(promptsSeen[1]).toContain("PREVIOUS ATTEMPT WAS REJECTED");
    expect(promptsSeen[1]).toMatch(/topicNameEn mismatch/i);
  });
});
