import { BadRequestException, NotFoundException } from "@nestjs/common";
import { LessonPublishService } from "./lesson-publish.service";

const VALID_STEPS = [
  { id: "s1", type: "INTRO", order: 1, objective: "Greet." },
  { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain." },
  { id: "s3", type: "CHECK", order: 3, objective: "Check.", checkType: "conceptual" },
  { id: "s4", type: "EXAMPLE", order: 4, objective: "Example." },
  { id: "s5", type: "CHECK", order: 5, objective: "Check applied.", checkType: "applied" },
  { id: "s6", type: "REVIEW", order: 6, objective: "Review." },
  { id: "s7", type: "COMPLETE", order: 7, objective: "Done." },
];

const REVIEWED_OBJECTIVE_EN = "State and apply the rule that adding zero to a number does not change its value.";
const REVIEWED_OBJECTIVE_AR = "ذكر وتطبيق قاعدة أن جمع الصفر على عدد لا يغيّر قيمته.";

// Phase 10B default fixture: a draft whose objective already has a
// human-reviewed Arabic translation (the "ready to approve" happy path).
// Tests that specifically need an UNREVIEWED objective override this.
const BASE_DRAFT = {
  id: "draft-1",
  targetUnitId: "unit-1",
  topicNameEn: "Addition with Zero",
  topicNameAr: "الجمع مع العدد صفر",
  learningObjectivesJson: [{ objectiveEn: REVIEWED_OBJECTIVE_EN, objectiveAr: REVIEWED_OBJECTIVE_AR }],
  teachingStepsJson: VALID_STEPS,
  status: "pending_review",
  aiProvider: "openai",
  aiModel: "gpt-4o-mini",
  publishedTopicId: null,
  publishedAt: null,
};

function makePrisma(overrides: any = {}) {
  const client = {
    lessonDraft: {
      findUnique: jest.fn().mockResolvedValue("draft" in overrides ? overrides.draft : BASE_DRAFT),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...BASE_DRAFT, ...data })),
    },
    unit: {
      findUnique: jest.fn().mockResolvedValue("unit" in overrides ? overrides.unit : { id: "unit-1", nameEn: "Addition" }),
    },
    topic: {
      aggregate: jest.fn().mockResolvedValue({ _max: { order: 1 } }),
      create: jest.fn().mockResolvedValue({ id: "topic-1" }),
    },
    lesson: {
      create: jest.fn().mockResolvedValue({ id: "lesson-1" }),
      findFirst: jest.fn().mockResolvedValue(overrides.existingLesson ?? { id: "lesson-1" }),
    },
    learningObjective: {
      create: jest.fn().mockResolvedValue({ id: "lo-1" }),
      findMany: jest.fn().mockResolvedValue(overrides.existingObjectives ?? [{ id: "lo-1" }]),
    },
  } as any;
  client.$transaction = (callback: any) => callback(client);
  return { client } as any;
}

describe("LessonPublishService.autoPublishIntoTopic — regeneration (2026-09-19)", () => {
  /**
   * Real bug found via live end-to-end testing (pnpm content:regenerate):
   * LessonDraft.publishedTopicId is @unique — regenerating an already-
   * published Topic with a brand-new draft crashed on that constraint,
   * because the OLD draft still held the claim. Stateful in-memory harness
   * (not the static mock above) since this needs real multi-call behavior:
   * publish once, then publish AGAIN with a second draft for the same Topic.
   */
  function makeHarness() {
    const state: { drafts: Record<string, any>; topics: Record<string, any>; lessons: Record<string, any>; objectives: Record<string, any> } = {
      drafts: {},
      topics: { "topic-1": { id: "topic-1", teachingStepsJson: null, generationSource: null } },
      lessons: {},
      objectives: {},
    };
    let lessonCounter = 0;

    function client() {
      return {
        lessonDraft: {
          findUnique: async ({ where: { id } }: any) => state.drafts[id] ?? null,
          updateMany: async ({ where, data }: any) => {
            let count = 0;
            for (const d of Object.values(state.drafts) as any[]) {
              if (d.publishedTopicId === where.publishedTopicId) {
                Object.assign(d, data);
                count++;
              }
            }
            return { count };
          },
          update: async ({ where: { id }, data }: any) => {
            Object.assign(state.drafts[id], data);
            return state.drafts[id];
          },
        },
        topic: {
          update: async ({ where: { id }, data }: any) => {
            Object.assign(state.topics[id], data);
            return state.topics[id];
          },
        },
        lesson: {
          findMany: async ({ where }: any) =>
            Object.values(state.lessons).filter((l: any) => l.topicId === where.topicId && (where.isAiGenerated === undefined || l.isAiGenerated === where.isAiGenerated)),
          create: async ({ data }: any) => {
            const lesson = { id: `lesson-${++lessonCounter}`, ...data };
            state.lessons[lesson.id] = lesson;
            return lesson;
          },
          deleteMany: async ({ where }: any) => {
            const ids: string[] = where.id.in;
            let count = 0;
            for (const id of ids) if (state.lessons[id]) { delete state.lessons[id]; count++; }
            return { count };
          },
        },
        learningObjective: {
          create: async ({ data }: any) => {
            const objective = { id: `lo-${Object.keys(state.objectives).length + 1}`, ...data };
            state.objectives[objective.id] = objective;
            return objective;
          },
          deleteMany: async ({ where }: any) => {
            const ids: string[] = where.lessonId.in;
            let count = 0;
            for (const [id, o] of Object.entries(state.objectives) as any) if (ids.includes(o.lessonId)) { delete state.objectives[id]; count++; }
            return { count };
          },
        },
      };
    }

    const db = client();
    (db as any).$transaction = (callback: any) => callback(client());
    const prisma = { client: db } as any;
    const service = new LessonPublishService(prisma);
    return { service, state };
  }

  function makeDraft(id: string, stepObjective: string) {
    return {
      id,
      teachingStepsJson: VALID_STEPS.map((s, i) => (i === 0 ? { ...s, objective: stepObjective } : s)),
      learningObjectivesJson: [{ objectiveEn: REVIEWED_OBJECTIVE_EN, objectiveAr: REVIEWED_OBJECTIVE_AR }],
      topicNameEn: "Plant parts",
      topicNameAr: "أجزاء النبات",
      publishedTopicId: null,
    };
  }

  it("regenerating an already-published Topic with a brand-new draft succeeds (does not crash on the publishedTopicId unique constraint)", async () => {
    const h = makeHarness();
    h.state.drafts["draft-old"] = makeDraft("draft-old", "OLD ungrounded content");
    h.state.drafts["draft-new"] = makeDraft("draft-new", "NEW grounded content");

    await h.service.autoPublishIntoTopic("draft-old", "topic-1");
    expect(h.state.topics["topic-1"].teachingStepsJson[0].objective).toBe("OLD ungrounded content");
    expect(h.state.drafts["draft-old"].publishedTopicId).toBe("topic-1");

    // Regeneration: a SECOND, brand-new draft publishes into the SAME Topic.
    await h.service.autoPublishIntoTopic("draft-new", "topic-1", {
      generationSource: "TEXTBOOK_GROUNDED",
      groundingVersionUsed: 1,
      generationPromptVersion: "auto-lesson-v1",
    });

    expect(h.state.topics["topic-1"].teachingStepsJson[0].objective).toBe("NEW grounded content");
    expect(h.state.topics["topic-1"].generationSource).toBe("TEXTBOOK_GROUNDED");
  });

  it("the publishedTopicId claim moves to the new draft, and the old draft's claim is cleared", async () => {
    const h = makeHarness();
    h.state.drafts["draft-old"] = makeDraft("draft-old", "OLD content");
    h.state.drafts["draft-new"] = makeDraft("draft-new", "NEW content");

    await h.service.autoPublishIntoTopic("draft-old", "topic-1");
    await h.service.autoPublishIntoTopic("draft-new", "topic-1", { generationSource: "TEXTBOOK_GROUNDED", groundingVersionUsed: 1, generationPromptVersion: "auto-lesson-v1" });

    expect(h.state.drafts["draft-old"].publishedTopicId).toBeNull();
    expect(h.state.drafts["draft-new"].publishedTopicId).toBe("topic-1");
  });

  it("the old AI-generated Lesson/LearningObjective rows are cleaned up, not left as stale duplicates", async () => {
    const h = makeHarness();
    h.state.drafts["draft-old"] = makeDraft("draft-old", "OLD content");
    h.state.drafts["draft-new"] = makeDraft("draft-new", "NEW content");

    await h.service.autoPublishIntoTopic("draft-old", "topic-1");
    const oldLessonCount = Object.keys(h.state.lessons).length;
    expect(oldLessonCount).toBe(1);

    await h.service.autoPublishIntoTopic("draft-new", "topic-1", { generationSource: "TEXTBOOK_GROUNDED", groundingVersionUsed: 1, generationPromptVersion: "auto-lesson-v1" });

    // Still exactly one Lesson for this Topic — the old one was removed, not left alongside the new one.
    const lessonsForTopic = Object.values(h.state.lessons).filter((l: any) => l.topicId === "topic-1");
    expect(lessonsForTopic).toHaveLength(1);
    expect(Object.keys(h.state.objectives)).toHaveLength(1); // old objective removed, new one created
  });
});

describe("LessonPublishService.approve", () => {
  it("approves a valid pending_review draft with a resolvable target unit", async () => {
    const prisma = makePrisma();
    const service = new LessonPublishService(prisma);

    await service.approve("draft-1");

    expect(prisma.client.lessonDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "draft-1" }, data: expect.objectContaining({ status: "approved" }) }),
    );
    expect(prisma.client.lessonDraft.update.mock.calls[0][0].data.reviewedAt).toBeInstanceOf(Date);
  });

  it("throws NotFoundException for an unknown draft", async () => {
    const prisma = makePrisma({ draft: null });
    const service = new LessonPublishService(prisma);
    await expect(service.approve("missing")).rejects.toThrow(NotFoundException);
    expect(prisma.client.lessonDraft.update).not.toHaveBeenCalled();
  });

  it("rejects approval of a draft that is not pending_review", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved" } });
    const service = new LessonPublishService(prisma);
    await expect(service.approve("draft-1")).rejects.toThrow(BadRequestException);
    expect(prisma.client.lessonDraft.update).not.toHaveBeenCalled();
  });

  it("rejects approval of a structurally invalid draft (fails validateLessonDraft)", async () => {
    const invalidSteps = [
      { id: "s1", type: "INTRO", order: 1, objective: "Greet." },
      { id: "s2", type: "EXPLAIN", order: 2, objective: "Explain." },
    ]; // too few steps, no CHECK, no COMPLETE
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, teachingStepsJson: invalidSteps } });
    const service = new LessonPublishService(prisma);
    await expect(service.approve("draft-1")).rejects.toThrow(BadRequestException);
    expect(prisma.client.lessonDraft.update).not.toHaveBeenCalled();
  });

  it("rejects approval when the target unit no longer exists", async () => {
    const prisma = makePrisma({ unit: null });
    const service = new LessonPublishService(prisma);
    await expect(service.approve("draft-1")).rejects.toThrow(BadRequestException);
  });

  // Phase 10B — replaces the old hardcoded REVIEWED_OBJECTIVE_TRANSLATIONS
  // allow-list check, which used to happen at publish() time instead.
  describe("bilingual objective review gate", () => {
    it("rejects approval of a draft whose objective has never been reviewed (objectiveAr is null)", async () => {
      const unreviewed = { ...BASE_DRAFT, learningObjectivesJson: [{ objectiveEn: REVIEWED_OBJECTIVE_EN, objectiveAr: null }] };
      const prisma = makePrisma({ draft: unreviewed });
      const service = new LessonPublishService(prisma);
      await expect(service.approve("draft-1")).rejects.toThrow(BadRequestException);
      expect(prisma.client.lessonDraft.update).not.toHaveBeenCalled();
    });

    it("rejects approval when only SOME objectives have been reviewed", async () => {
      const partiallyReviewed = {
        ...BASE_DRAFT,
        learningObjectivesJson: [
          { objectiveEn: "Objective one.", objectiveAr: "الهدف الأول." },
          { objectiveEn: "Objective two.", objectiveAr: null },
        ],
      };
      const prisma = makePrisma({ draft: partiallyReviewed });
      const service = new LessonPublishService(prisma);
      await expect(service.approve("draft-1")).rejects.toThrow(BadRequestException);
    });

    it("rejects approval of a draft with no objectives at all", async () => {
      const prisma = makePrisma({ draft: { ...BASE_DRAFT, learningObjectivesJson: [] } });
      const service = new LessonPublishService(prisma);
      await expect(service.approve("draft-1")).rejects.toThrow(BadRequestException);
    });

    it("handles a pre-Phase-10B draft stored as a plain string[] (old shape) without crashing — treats it as unreviewed", async () => {
      const oldShapeDraft = { ...BASE_DRAFT, learningObjectivesJson: [REVIEWED_OBJECTIVE_EN] };
      const prisma = makePrisma({ draft: oldShapeDraft });
      const service = new LessonPublishService(prisma);
      await expect(service.approve("draft-1")).rejects.toThrow(BadRequestException);
    });

    it("approves once every objective has a non-empty reviewed Arabic translation", async () => {
      const prisma = makePrisma(); // BASE_DRAFT is already fully reviewed
      const service = new LessonPublishService(prisma);
      await expect(service.approve("draft-1")).resolves.toBeDefined();
    });
  });
});

describe("LessonPublishService.reviewObjectives", () => {
  it("fills in the reviewed Arabic translation for a matching English objective", async () => {
    const unreviewed = { ...BASE_DRAFT, learningObjectivesJson: [{ objectiveEn: REVIEWED_OBJECTIVE_EN, objectiveAr: null }] };
    const prisma = makePrisma({ draft: unreviewed });
    const service = new LessonPublishService(prisma);

    await service.reviewObjectives("draft-1", [{ objectiveEn: REVIEWED_OBJECTIVE_EN, objectiveAr: REVIEWED_OBJECTIVE_AR }]);

    expect(prisma.client.lessonDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: { learningObjectivesJson: [{ objectiveEn: REVIEWED_OBJECTIVE_EN, objectiveAr: REVIEWED_OBJECTIVE_AR }] },
    });
  });

  it("persists objectiveEn/objectiveAr correctly for multiple objectives, only updating the ones submitted", async () => {
    const draft = {
      ...BASE_DRAFT,
      learningObjectivesJson: [
        { objectiveEn: "First.", objectiveAr: null },
        { objectiveEn: "Second.", objectiveAr: null },
      ],
    };
    const prisma = makePrisma({ draft });
    const service = new LessonPublishService(prisma);

    await service.reviewObjectives("draft-1", [{ objectiveEn: "First.", objectiveAr: "الأول." }]);

    expect(prisma.client.lessonDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: {
        learningObjectivesJson: [
          { objectiveEn: "First.", objectiveAr: "الأول." },
          { objectiveEn: "Second.", objectiveAr: null },
        ],
      },
    });
  });

  it("rejects a translation for text that doesn't match any existing objective — cannot smuggle in a new objective this way", async () => {
    const unreviewed = { ...BASE_DRAFT, learningObjectivesJson: [{ objectiveEn: REVIEWED_OBJECTIVE_EN, objectiveAr: null }] };
    const prisma = makePrisma({ draft: unreviewed });
    const service = new LessonPublishService(prisma);
    await expect(
      service.reviewObjectives("draft-1", [{ objectiveEn: "Some different objective the AI never proposed.", objectiveAr: "شيء آخر." }]),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.client.lessonDraft.update).not.toHaveBeenCalled();
  });

  it("rejects an empty/whitespace-only Arabic translation", async () => {
    const unreviewed = { ...BASE_DRAFT, learningObjectivesJson: [{ objectiveEn: REVIEWED_OBJECTIVE_EN, objectiveAr: null }] };
    const prisma = makePrisma({ draft: unreviewed });
    const service = new LessonPublishService(prisma);
    await expect(service.reviewObjectives("draft-1", [{ objectiveEn: REVIEWED_OBJECTIVE_EN, objectiveAr: "   " }])).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects reviewing objectives for a draft that is not pending_review", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved" } });
    const service = new LessonPublishService(prisma);
    await expect(
      service.reviewObjectives("draft-1", [{ objectiveEn: REVIEWED_OBJECTIVE_EN, objectiveAr: REVIEWED_OBJECTIVE_AR }]),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException for an unknown draft", async () => {
    const prisma = makePrisma({ draft: null });
    const service = new LessonPublishService(prisma);
    await expect(
      service.reviewObjectives("missing", [{ objectiveEn: REVIEWED_OBJECTIVE_EN, objectiveAr: REVIEWED_OBJECTIVE_AR }]),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("LessonPublishService.publish", () => {
  it("publishes an approved draft transactionally, creating exactly one Topic/Lesson/LearningObjective", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved" } });
    const service = new LessonPublishService(prisma);

    const result = await service.publish("draft-1");

    expect(prisma.client.topic.create).toHaveBeenCalledTimes(1);
    expect(prisma.client.lesson.create).toHaveBeenCalledTimes(1);
    expect(prisma.client.learningObjective.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ topicId: "topic-1", lessonId: "lesson-1", learningObjectiveIds: ["lo-1"], alreadyPublished: false });
  });

  it("Phase 10B: persists objectiveEn/objectiveAr from the reviewed bilingual objective as LearningObjective.descriptionEn/descriptionAr — no allow-list, no AI translation", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved" } });
    const service = new LessonPublishService(prisma);

    await service.publish("draft-1");

    expect(prisma.client.learningObjective.create).toHaveBeenCalledWith({
      data: { lessonId: "lesson-1", descriptionEn: REVIEWED_OBJECTIVE_EN, descriptionAr: REVIEWED_OBJECTIVE_AR },
    });
  });

  it("publishes multiple objectives in order, each with its own reviewed translation", async () => {
    const draft = {
      ...BASE_DRAFT,
      status: "approved",
      learningObjectivesJson: [
        { objectiveEn: "First.", objectiveAr: "الأول." },
        { objectiveEn: "Second.", objectiveAr: "الثاني." },
      ],
    };
    const prisma = makePrisma({ draft });
    const service = new LessonPublishService(prisma);

    await service.publish("draft-1");

    expect(prisma.client.learningObjective.create).toHaveBeenNthCalledWith(1, { data: { lessonId: "lesson-1", descriptionEn: "First.", descriptionAr: "الأول." } });
    expect(prisma.client.learningObjective.create).toHaveBeenNthCalledWith(2, { data: { lessonId: "lesson-1", descriptionEn: "Second.", descriptionAr: "الثاني." } });
  });

  it("stores publishedTopicId and publishedAt on the draft as part of the same transaction", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved" } });
    const service = new LessonPublishService(prisma);
    await service.publish("draft-1");

    expect(prisma.client.lessonDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "draft-1" },
        data: expect.objectContaining({ status: "published", publishedTopicId: "topic-1" }),
      }),
    );
    expect(prisma.client.lessonDraft.update.mock.calls[0][0].data.publishedAt).toBeInstanceOf(Date);
  });

  it("does not create Topic/Lesson if the draft is not approved", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "pending_review" } });
    const service = new LessonPublishService(prisma);
    await expect(service.publish("draft-1")).rejects.toThrow(BadRequestException);
    expect(prisma.client.topic.create).not.toHaveBeenCalled();
  });

  it("is transactional: a failure partway through never persists the publish-link update", async () => {
    const prisma = makePrisma({ draft: { ...BASE_DRAFT, status: "approved" } });
    prisma.client.learningObjective.create = jest.fn().mockRejectedValue(new Error("simulated failure mid-transaction"));
    const service = new LessonPublishService(prisma);

    await expect(service.publish("draft-1")).rejects.toThrow("simulated failure mid-transaction");
    // The topic/lesson creates were called (steps before the failure), but
    // the draft's publish-link write — the last step — must never run.
    expect(prisma.client.lessonDraft.update).not.toHaveBeenCalled();
  });

  it("second publish call for an already-published draft is idempotent: no new rows, safe reused result", async () => {
    const publishedDraft = { ...BASE_DRAFT, status: "published", publishedTopicId: "topic-1", publishedAt: new Date() };
    const prisma = makePrisma({ draft: publishedDraft });
    const service = new LessonPublishService(prisma);

    const result = await service.publish("draft-1");

    expect(prisma.client.topic.create).not.toHaveBeenCalled();
    expect(prisma.client.lesson.create).not.toHaveBeenCalled();
    expect(prisma.client.learningObjective.create).not.toHaveBeenCalled();
    expect(prisma.client.lessonDraft.update).not.toHaveBeenCalled();
    expect(result).toEqual({ topicId: "topic-1", lessonId: "lesson-1", learningObjectiveIds: ["lo-1"], alreadyPublished: true });
  });

  it("never depends on any AI provider — LessonPublishService only takes PrismaService", () => {
    expect(LessonPublishService.length).toBe(1);
  });
});
