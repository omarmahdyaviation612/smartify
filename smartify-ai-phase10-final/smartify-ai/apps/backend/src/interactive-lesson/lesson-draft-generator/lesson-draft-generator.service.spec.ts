import { LessonDraftGeneratorService } from "./lesson-draft-generator.service";
import { CONTENT_AUTHORING_ACTOR_ID } from "../../ai/content-authoring-actor.const";

/**
 * Budget-attribution regression suite (2026-09-20) — the Student
 * Experience audit found that ensureTopicHasLesson()'s lazy generation
 * correctly billed Unit grounding to CONTENT_AUTHORING_ACTOR_ID but billed
 * the SUBSEQUENT generateAutoDraft() call to whichever real student
 * happened to trigger it first — a one-time, permanently-cached authoring
 * cost eaten from that one student's own daily budget. These tests lock in
 * the fix: both the grounding call and the generation call must bill the
 * platform actor, never `requestingUserId`, while the generation LOCK's
 * ownership bookkeeping (`generationLockedBy`) is untouched.
 */
describe("LessonDraftGeneratorService.ensureTopicHasLesson — budget attribution", () => {
  const REAL_STUDENT_ID = "real-student-1";
  const TOPIC_ID = "topic-1";
  const UNIT_ID = "unit-1";

  const VALID_AUTO_DRAFT = {
    topicNameEn: "Test Topic",
    learningObjectives: [
      { objectiveEn: "Objective one", objectiveAr: "الهدف الأول" },
      { objectiveEn: "Objective two", objectiveAr: "الهدف الثاني" },
    ],
    steps: [
      { id: "s1", type: "INTRO", order: 1, objective: "Introduce" },
      { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain" },
      { id: "s3", type: "CHECK", order: 3, objective: "Check" },
      { id: "s4", type: "COMPLETE", order: 4, objective: "Wrap up" },
    ],
  };

  function makeHarness(topicOverrides: Record<string, unknown> = {}) {
    const coldTopic = {
      id: TOPIC_ID,
      nameEn: "Test Topic",
      nameAr: "موضوع الاختبار",
      unitId: UNIT_ID,
      teachingStepsJson: null,
      ...topicOverrides,
    };

    const generateSpy = jest.fn().mockResolvedValue({
      content: JSON.stringify(VALID_AUTO_DRAFT),
      inputTokens: 10,
      outputTokens: 10,
    });

    const prisma = {
      client: {
        topic: {
          findUnique: jest.fn().mockResolvedValue(coldTopic),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ ...coldTopic, teachingStepsJson: VALID_AUTO_DRAFT.steps }),
        },
        unit: {
          findUnique: jest.fn().mockResolvedValue({
            id: UNIT_ID,
            nameEn: "Unit 1",
            subjectId: "subject-1",
            groundingNotesJson: null,
            groundingVersion: null,
            subject: { nameEn: "Science", grade: { nameEn: "Year 5", curriculum: { nameEn: "Test Curriculum" } } },
          }),
        },
        lessonDraft: {
          create: jest.fn().mockResolvedValue({ id: "draft-1" }),
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
      buildAutoLessonGenerationPrompt: jest.fn().mockReturnValue("system prompt"),
    };

    const usageService = {
      assertWithinBudget: jest.fn().mockResolvedValue(undefined),
      estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01),
      reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "res-1" }),
      reconcileBudget: jest.fn().mockResolvedValue(undefined),
      releaseBudget: jest.fn().mockResolvedValue(undefined),
    };

    const publisher = {
      autoPublishIntoTopic: jest.fn().mockResolvedValue(undefined),
    };

    const unitGrounding = {
      ensureUnitGrounded: jest.fn().mockResolvedValue({ used: false }),
    };

    const service = new LessonDraftGeneratorService(prisma as any, providerFactory as any, contextBuilder as any, usageService as any, publisher as any, unitGrounding as any);

    return { service, prisma, providerFactory, usageService, publisher, unitGrounding, generateSpy };
  }

  it("A/C — cold Topic: grounding AND the lazy generation call are both billed to CONTENT_AUTHORING_ACTOR_ID, never the real triggering student", async () => {
    const { service, usageService, prisma, unitGrounding } = makeHarness();

    await service.ensureTopicHasLesson(TOPIC_ID, { preferredLang: "en", studentAgeRange: "9-10" }, REAL_STUDENT_ID);

    // C — grounding still billed to the platform actor.
    expect(unitGrounding.ensureUnitGrounded).toHaveBeenCalledWith(UNIT_ID, CONTENT_AUTHORING_ACTOR_ID);

    // A — the generation call's own budget check/reservation/usage row are
    // all billed to the platform actor, never the real student.
    expect(usageService.assertWithinBudget).toHaveBeenCalledWith(CONTENT_AUTHORING_ACTOR_ID);
    expect(usageService.assertWithinBudget).not.toHaveBeenCalledWith(REAL_STUDENT_ID);
    expect(usageService.reserveBudget).toHaveBeenCalledWith(CONTENT_AUTHORING_ACTOR_ID, expect.any(Number));
    expect(usageService.reserveBudget).not.toHaveBeenCalledWith(REAL_STUDENT_ID, expect.any(Number));
    expect(prisma.client.aIUsage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: CONTENT_AUTHORING_ACTOR_ID }) }));
  });

  it("the generation LOCK's ownership bookkeeping still records the real triggering student, unchanged by the billing fix", async () => {
    const { service, prisma } = makeHarness();

    await service.ensureTopicHasLesson(TOPIC_ID, { preferredLang: "en", studentAgeRange: "9-10" }, REAL_STUDENT_ID);

    expect(prisma.client.topic.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ generationLockedBy: REAL_STUDENT_ID }) }),
    );
  });

  it.each(["no-page-range", "extraction-failed", "wait-timeout"])("blocks mapped textbook generation when grounding reports %s", async (reason) => {
    const h = makeHarness();
    const unit = await h.prisma.client.unit.findUnique();
    h.prisma.client.unit.findUnique.mockResolvedValue({ ...unit, subject: { ...unit.subject, sourceFile: "Y1 English learner's book.pdf" } } as any);
    h.unitGrounding.ensureUnitGrounded.mockResolvedValue({ used: false, reason } as any);

    await expect(h.service.ensureTopicHasLesson(TOPIC_ID, { preferredLang: "en", studentAgeRange: "6-7" }, REAL_STUDENT_ID))
      .rejects.toThrow("Textbook grounding is unavailable for this topic");
    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.prisma.client.lessonDraft.create).not.toHaveBeenCalled();
    expect(h.publisher.autoPublishIntoTopic).not.toHaveBeenCalled();
    expect(h.prisma.client.topic.updateMany).toHaveBeenLastCalledWith({ where: { id: TOPIC_ID }, data: { generationLockedAt: null, generationLockedBy: null } });
  });

  it("blocks direct auto-generation for an extra-book source without relevant grounding", async () => {
    const h = makeHarness();
    const unit = await h.prisma.client.unit.findUnique();
    h.prisma.client.unit.findUnique.mockResolvedValue({ ...unit, sourceFileOverride: "extras/story.pdf" } as any);
    await expect(h.service.generateAutoDraft({ id: TOPIC_ID, unitId: UNIT_ID, nameEn: "Test Topic", nameAr: "Test" }, { preferredLang: "en", studentAgeRange: "6-7" }, CONTENT_AUTHORING_ACTOR_ID))
      .rejects.toThrow("Textbook grounding is unavailable for this topic");
    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.prisma.client.lessonDraft.create).not.toHaveBeenCalled();
  });

  it("G — a warm (already-generated) Topic never touches grounding or the AI provider at all — pure cache hit, nothing to bill", async () => {
    const { service, unitGrounding, providerFactory, prisma } = makeHarness({ teachingStepsJson: [{ id: "s1", type: "INTRO" }] });

    const result = await service.ensureTopicHasLesson(TOPIC_ID, { preferredLang: "en", studentAgeRange: "9-10" }, REAL_STUDENT_ID);

    expect(unitGrounding.ensureUnitGrounded).not.toHaveBeenCalled();
    expect(providerFactory.getActiveProvider).not.toHaveBeenCalled();
    expect(prisma.client.lessonDraft.create).not.toHaveBeenCalled();
    expect(result.teachingStepsJson).toEqual([{ id: "s1", type: "INTRO" }]);
  });

  it.each([false, true])("blocks mapped grounding with no usable topic slice (empty hint: %s)", async (emptyHint) => {
    const h = makeHarness();
    const unit = await h.prisma.client.unit.findUnique();
    h.prisma.client.unit.findUnique.mockResolvedValue({ ...unit,
      subject: { ...unit.subject, sourceFile: "textbook.pdf" },
      groundingNotesJson: { concepts: [], facts: [], vocabulary: [], learningObjectives: [], topicHints: emptyHint ? [{ topicTitle: "Test Topic", relevantConcepts: [], sourcePages: [] }] : [] },
    } as any);
    await expect(h.service.ensureTopicHasLesson(TOPIC_ID, { preferredLang: "en", studentAgeRange: "6-7" }, REAL_STUDENT_ID)).rejects.toThrow("Textbook grounding is unavailable");
    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.publisher.autoPublishIntoTopic).not.toHaveBeenCalled();
  });

  it("blocks a mapped Topic when persisted grounding exists but the selector finds no Topic-specific match", async () => {
    const h = makeHarness();
    const unit = await h.prisma.client.unit.findUnique();
    h.prisma.client.unit.findUnique.mockResolvedValue({ ...unit,
      subject: { ...unit.subject, sourceFile: "textbook.pdf" }, groundingVersion: 1,
      groundingNotesJson: {
        concepts: [{ name: "Unrelated concept", description: "Grounded content", sourcePages: [1], importance: "core" }],
        facts: [], vocabulary: [], learningObjectives: ["Stay within the grounded curriculum."], topicHints: [],
      },
    } as any);
    h.unitGrounding.ensureUnitGrounded.mockResolvedValue({ used: true });

    await expect(h.service.ensureTopicHasLesson(TOPIC_ID, { preferredLang: "en", studentAgeRange: "6-7" }, REAL_STUDENT_ID))
      .rejects.toThrow("Textbook grounding is unavailable for this topic");
    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.publisher.autoPublishIntoTopic).not.toHaveBeenCalled();
  });

  it("publishes mapped textbook content when relevant grounding is available", async () => {
    const h = makeHarness();
    const unit = await h.prisma.client.unit.findUnique();
    h.prisma.client.unit.findUnique.mockResolvedValue({ ...unit,
      subject: { ...unit.subject, sourceFile: "textbook.pdf" }, groundingVersion: 1,
      groundingNotesJson: { concepts: [{ name: "Introduce Test Topic", description: "Textbook scope", sourcePages: [1], importance: "core" }], facts: [], vocabulary: [], learningObjectives: [], topicHints: [] },
    } as any);
    h.unitGrounding.ensureUnitGrounded.mockResolvedValue({ used: true });
    await h.service.ensureTopicHasLesson(TOPIC_ID, { preferredLang: "en", studentAgeRange: "6-7" }, REAL_STUDENT_ID);
    expect(h.generateSpy).toHaveBeenCalledTimes(1);
    expect(h.publisher.autoPublishIntoTopic).toHaveBeenCalledWith("draft-1", TOPIC_ID, expect.objectContaining({ generationSource: "TEXTBOOK_GROUNDED", groundingVersionUsed: 1 }));
  });
});
