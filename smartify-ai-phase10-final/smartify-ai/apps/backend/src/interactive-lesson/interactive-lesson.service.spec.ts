import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AIContextBuilderService } from "../ai/context/ai-context-builder.service";
import { InteractiveLessonService } from "./interactive-lesson.service";

/**
 * Covers the Interactive Lesson engine's core control flow: step
 * progression is driven entirely by currentStepIndex/stepResultsJson on
 * LessonSession, never by trusting AI prose alone. A stateful in-memory
 * mock models StudentProfile/Topic/LessonSession/AIConversation/AIMessage
 * so session creation, resumption, and cross-student isolation can all be
 * exercised realistically.
 */
describe("InteractiveLessonService", () => {
  const STEPS = [
    { id: "s1", type: "INTRO", order: 1, objective: "greet and frame" },
    { id: "s2", type: "EXPLAIN", order: 2, objective: "explain + and =" },
    { id: "s3", type: "CHECK", order: 3, objective: "check concept", checkType: "conceptual" },
    { id: "s4", type: "EXAMPLE", order: 4, objective: "applied example", visual: { type: "VISUALIZE_LEARNING", status: "NOT_GENERATED", prompt: "internal image prompt, never sent to the client", url: null } },
    { id: "s5", type: "CHECK", order: 5, objective: "check application", checkType: "applied" },
    { id: "s6", type: "REVIEW", order: 6, objective: "short review" },
    { id: "s7", type: "COMPLETE", order: 7, objective: "acknowledge completion" },
  ];

  function makeHarness(opts: { generateImpl?: (args: any) => any; studentSubjectRow?: { expiresAt: Date | null }; extraTopics?: Record<string, any>; groundingPreparationResult?: { status: string; retryAfterMs?: number } } = {}) {
    const state: {
      profiles: Record<string, any>;
      topics: Record<string, any>;
      sessions: Record<string, any>; // keyed by `${studentId}:${topicId}`
      conversations: Record<string, any>;
      messages: any[];
      usage: any[];
      freeTrials: Record<string, any>;
    } = {
      profiles: {
        "user-1": { id: "student-1", userId: "user-1", fullName: "Kenda Test", age: 7, preferredLang: "ar" },
        "user-2": { id: "student-2", userId: "user-2", fullName: "Omar Test", age: 7, preferredLang: "ar" },
      },
      topics: {
        "topic-1": {
          id: "topic-1",
          nameEn: "Addition (Part 1)",
          teachingStepsJson: STEPS,
          unit: { subjectId: "subject-1", subject: { nameEn: "Mathematics" } },
        },
        ...opts.extraTopics,
      },
      sessions: {},
      conversations: {},
      messages: [],
      usage: [],
      freeTrials: {},
    };

    let convCounter = 0;
    let sessCounter = 0;
    let releaseFreeTrialCalls = 0;
    let reserveFreeTrialCalls = 0;

    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockImplementation(async ({ where: { userId } }: any) => state.profiles[userId] ?? null) },
        topic: {
          findUnique: jest.fn().mockImplementation(async ({ where: { id } }: any) => state.topics[id] ?? null),
        },
        lessonSession: {
          findUnique: jest.fn().mockImplementation(async ({ where: { studentId_topicId } }: any) => {
            const key = `${studentId_topicId.studentId}:${studentId_topicId.topicId}`;
            return state.sessions[key] ?? null;
          }),
          create: jest.fn().mockImplementation(async ({ data }: any) => {
            const id = `session-${++sessCounter}`;
            // nonProgressTurns defaults to 0 in the real schema (@default(0));
            // this mock has no column-default machinery, so it's applied here.
            const session = { nonProgressTurns: 0, id, ...data };
            state.sessions[`${data.studentId}:${data.topicId}`] = session;
            return session;
          }),
          update: jest.fn().mockImplementation(async ({ where: { id }, data }: any) => {
            const key = Object.keys(state.sessions).find((k) => state.sessions[k].id === id)!;
            // Resolve Prisma's `{ increment: N }` field-update shape the way
            // real Postgres/Prisma would, so consumeNonProgressBudget's
            // counter actually increments in this mock instead of being
            // overwritten with the raw operator object.
            const resolved: Record<string, unknown> = {};
            for (const [field, value] of Object.entries(data)) {
              resolved[field] =
                value && typeof value === "object" && "increment" in (value as any)
                  ? (state.sessions[key][field] ?? 0) + (value as any).increment
                  : value;
            }
            state.sessions[key] = { ...state.sessions[key], ...resolved };
            return state.sessions[key];
          }),
        },
        aIConversation: {
          create: jest.fn().mockImplementation(async ({ data }: any) => {
            const id = `conv-${++convCounter}`;
            state.conversations[id] = { id, ...data };
            return state.conversations[id];
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        aIMessage: {
          create: jest.fn().mockImplementation(async ({ data }: any) => {
            state.messages.push(data);
            return data;
          }),
          findFirst: jest.fn().mockImplementation(async () => [...state.messages].reverse()[0] ?? null),
        },
        aIUsage: { create: jest.fn().mockImplementation(async ({ data }: any) => { state.usage.push(data); return data; }) },
        // Subject entitlement fix (2026-09-20): reserveEntitlement now
        // checks StudentSubject for the specific Subject being opened —
        // never account-wide Subscription — so this mock stands in for
        // that row. No row (the default, opts.studentSubjectRow unset)
        // means "not entitled", falling through to the trial path, the
        // exact same default every OTHER test in this file already
        // relies on.
        studentSubject: {
          findUnique: jest.fn().mockImplementation(async ({ where: { studentId_subjectId } }: any) => {
            if (!opts.studentSubjectRow) return null;
            return { studentId: studentId_subjectId.studentId, subjectId: studentId_subjectId.subjectId, expiresAt: opts.studentSubjectRow.expiresAt };
          }),
        },
        lesson: { findFirst: jest.fn().mockResolvedValue(null) },
        studentProgress: { upsert: jest.fn().mockResolvedValue({}) },
        lessonVisualAsset: { findUnique: jest.fn().mockResolvedValue(null) },
      },
    } as any;
    prisma.client.$transaction = (ops: any[]) => Promise.all(ops);

    const generateSpy = jest.fn().mockImplementation(
      opts.generateImpl ?? (async () => ({ content: "some teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" })),
    );
    const providerFactory = {
      getActiveProvider: jest.fn().mockResolvedValue({
        provider: { generate: generateSpy },
        providerKey: "openai",
        model: "gpt-4o-mini",
      }),
    } as any;

    const usageService = {
      assertWithinBudget: jest.fn().mockResolvedValue(undefined),
      buildUsageRow: jest.fn().mockImplementation(async (p: any) => ({ ...p, feature: p.feature ?? "tutor_chat", creditsUsed: p.creditsUsed ?? 1, costUsd: 0.0001, provider: p.providerKey })),
      logUntrackedUsage: jest.fn(),
      releaseDailySlot: jest.fn().mockResolvedValue(undefined),
      estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.001),
      reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "reservation-1" }),
      reconcileBudget: jest.fn().mockResolvedValue(undefined),
      releaseBudget: jest.fn().mockResolvedValue(undefined),
    } as any;

    const questionPacks = {
      consumeForTutor: jest.fn().mockResolvedValue({ source: "daily", limit: 10 }),
      refundExtraCredit: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Free Trial V1 (2026-09-20): InteractiveLessonService no longer reuses
    // TutorService's single-subject FreeTutorTrial for Lesson entitlement —
    // this mock stands in for TrialService.reserveLessonTrial/
    // releaseLessonTrialReservation instead. Unconditionally succeeds
    // (mirroring the old tutorService mock's behavior) so every OTHER test
    // in this file — none of which are actually about trial-subject
    // selection — keeps exercising the rest of the lesson engine unchanged.
    const trialService = {
      reserveLessonTrial: jest.fn().mockImplementation(async (studentId: string) => {
        reserveFreeTrialCalls++;
        state.freeTrials[studentId] = (state.freeTrials[studentId] ?? 0) + 1;
        return { source: "lesson-trial" as const, consumptionId: `consumption-${reserveFreeTrialCalls}` };
      }),
      releaseLessonTrialReservation: jest.fn().mockImplementation(async () => {
        releaseFreeTrialCalls++;
      }),
    } as any;

    // Default behavior simulates a successful lazy-generation round trip
    // for a title-only topic (teachingStepsJson: null): ensureTopicHasLesson
    // "writes" STEPS onto that topic in this mock's state, exactly like the
    // real LessonDraftGeneratorService.ensureTopicHasLesson (draft +
    // auto-publish) would in Postgres. Most tests never hit this at all
    // (their fixture topics already have teachingStepsJson set, so
    // ensureTopicHasSteps() returns early) — real implementations are
    // exercised separately in lesson-draft-generator.service.spec.ts /
    // lesson-publish.service.spec.ts.
    const draftGenerator = {
      ensureTopicHasLesson: jest.fn().mockImplementation(async (topicId: string) => {
        state.topics[topicId] = { ...state.topics[topicId], teachingStepsJson: STEPS };
        return state.topics[topicId];
      }),
      // Production hotfix (2026-09-25): every OTHER test in this file
      // relies on the implicit READY default (a title-only topic's
      // teachingStepsJson is null, so ensureTopicHasSteps must clear the
      // grounding-preparation gate before ensureTopicHasLesson runs) —
      // only the dedicated CONFIGURATION_ERROR test below overrides this.
      prepareTopicGrounding: jest.fn().mockResolvedValue(opts.groundingPreparationResult ?? { status: "READY" }),
    } as any;
    // Question-pool generation is a fire-and-forget-shaped no-op here —
    // no test in this file asserts on it; real behavior is covered by
    // question-draft-generator.service.spec.ts.
    const questionGenerator = { ensurePoolForTopic: jest.fn().mockResolvedValue(undefined) } as any;

    const service = new InteractiveLessonService(
      prisma,
      providerFactory,
      new AIContextBuilderService(),
      usageService,
      questionPacks,
      trialService,
      draftGenerator,
      questionGenerator,
    );

    return {
      service,
      prisma,
      state,
      questionPacks,
      trialService,
      draftGenerator,
      getSession: (userId: string, topicId: string) => state.sessions[`${state.profiles[userId].id}:${topicId}`],
      freeTrialCount: () => ({ reserve: reserveFreeTrialCalls, release: releaseFreeTrialCalls }),
      generateSpy,
    };
  }

  it("C: creates a new LessonSession on the first advance() call", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1");
    const session = h.getSession("user-1", "topic-1");
    expect(session).toBeDefined();
    expect(session.status).toBe("IN_PROGRESS");
  });

  /**
   * Budget-attribution regression (2026-09-20, "D" in the fix's own test
   * plan): the Interactive Lesson engine's own runtime teaching turns must
   * remain billed to the real student — this is per-student tutoring
   * spend, never shared/cached content-authoring cost, and the lazy-
   * generation billing fix (lesson-draft-generator.service.spec.ts,
   * question-draft-generator.service.spec.ts) must not have touched it.
   * "topic-1" already has teachingStepsJson set in this harness, so this
   * exercises a pure runtime turn with no lazy generation involved at all.
   */
  it("D: a runtime lesson teaching turn (advance()) is billed to the real student's userId, never CONTENT_AUTHORING_ACTOR_ID", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1");

    expect(h.state.usage.length).toBeGreaterThan(0);
    for (const row of h.state.usage) {
      expect(row.userId).toBe("user-1");
    }
  });

  it("D: the first delivered step is step index 0 (INTRO)", async () => {
    const h = makeHarness();
    const result = await h.service.advance("user-1", "topic-1");
    expect(result.currentStepIndex).toBe(0);
    expect(result.stepType).toBe("INTRO");
  });

  it("exposes visual metadata (type/status/url) for a step that carries it, without leaking the internal image prompt", async () => {
    const h = makeHarness({
      generateImpl: async () => ({ content: JSON.stringify({ intent: "answer", isCorrect: true, say: "yes" }), inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" }),
    });
    await h.service.advance("user-1", "topic-1"); // s1
    await h.service.advance("user-1", "topic-1"); // s2
    await h.service.advance("user-1", "topic-1"); // s3 CHECK delivered
    await h.service.respond("user-1", "topic-1", "the plus sign means combine"); // resolve s3 correctly
    const s4 = await h.service.advance("user-1", "topic-1"); // -> s4 EXAMPLE (has visual)
    expect(s4.visual).toEqual({ type: "VISUALIZE_LEARNING", status: "NOT_GENERATED", url: null });
    expect(JSON.stringify(s4)).not.toContain("internal image prompt");
  });

  it("returns visual: null for a step that carries no visual metadata", async () => {
    const h = makeHarness();
    const s1 = await h.service.advance("user-1", "topic-1");
    expect(s1.visual).toBeNull();
  });

  it("E: repeated advance() calls progress through steps in order", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1"); // s1 INTRO delivered
    const second = await h.service.advance("user-1", "topic-1"); // -> s2 EXPLAIN
    expect(second.currentStepIndex).toBe(1);
    expect(second.stepType).toBe("EXPLAIN");
  });

  it("F: a correct check answer resolves the check without advancing on its own", async () => {
    const h = makeHarness({
      generateImpl: async () => ({ content: JSON.stringify({ intent: "answer", isCorrect: true, say: "pretty good" }), inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" }),
    });
    await h.service.advance("user-1", "topic-1"); // s1
    await h.service.advance("user-1", "topic-1"); // s2
    await h.service.advance("user-1", "topic-1"); // s3 CHECK delivered
    const respondResult = await h.service.respond("user-1", "topic-1", "the plus sign means combine");
    expect(respondResult.currentStepIndex).toBe(2); // still on s3 — respond() never advances by itself
    expect(respondResult.content).toBe("pretty good");
    const next = await h.service.advance("user-1", "topic-1"); // now advances since check resolved correct
    expect(next.currentStepIndex).toBe(3);
    expect(next.stepType).toBe("EXAMPLE");
  });

  it("persists the extracted 'say' text (not the raw JSON) for a check-evaluation turn, so /tutor/speech's exact-match check can find and speak it", async () => {
    const h = makeHarness({
      generateImpl: async () => ({ content: JSON.stringify({ intent: "answer", isCorrect: true, say: "pretty good" }), inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" }),
    });
    await h.service.advance("user-1", "topic-1"); // s1
    await h.service.advance("user-1", "topic-1"); // s2
    await h.service.advance("user-1", "topic-1"); // s3 CHECK delivered
    const respondResult = await h.service.respond("user-1", "topic-1", "the plus sign means combine");
    const stored = h.state.messages.find((m: any) => m.conversationId === respondResult.conversationId && m.content === "pretty good");
    expect(stored).toBeDefined();
    expect(stored.content).not.toContain("{");
  });

  it("calling advance() while a CHECK is pending/unanswered re-serves its cached content without a new AI call (no wasted cost)", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1"); // s1
    await h.service.advance("user-1", "topic-1"); // s2
    await h.service.advance("user-1", "topic-1"); // s3 CHECK delivered
    const callsSoFar = h.generateSpy.mock.calls.length;
    const result = await h.service.advance("user-1", "topic-1"); // re-request while unanswered
    expect(result.currentStepIndex).toBe(2); // still on s3, not advanced
    expect(result.readyToContinue).toBe(false);
    expect(result.content).toBeDefined();
    expect(h.generateSpy.mock.calls.length).toBe(callsSoFar); // no new AI call made
  });

  it("readyToContinue reflects whether the current CHECK has been correctly resolved", async () => {
    const h = makeHarness({
      generateImpl: async (args: any) =>
        args.responseFormat === "json_object"
          ? { content: JSON.stringify({ intent: "answer", isCorrect: true, say: "yes" }), inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" }
          : { content: "teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" },
    });
    await h.service.advance("user-1", "topic-1");
    await h.service.advance("user-1", "topic-1");
    const delivered = await h.service.advance("user-1", "topic-1"); // s3 CHECK delivered
    expect(delivered.readyToContinue).toBe(false);
    const answered = await h.service.respond("user-1", "topic-1", "combining");
    expect(answered.readyToContinue).toBe(true);
  });

  it("2026-09-19 real-world bug: trims trailing whitespace the model emits inside a CHECK step's JSON \"say\" field, so the persisted AIMessage and the returned content are byte-identical (a real 'Voice playback unavailable' report traced to /tutor/speech trimming its input before matching an untrimmed stored reply)", async () => {
    const h = makeHarness({
      generateImpl: async (args: any) =>
        args.responseFormat === "json_object"
          ? { content: JSON.stringify({ say: "How many apples do you have in total? ", expression: null }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }
          : { content: "some teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" },
    });
    await h.service.advance("user-1", "topic-1");
    await h.service.advance("user-1", "topic-1");
    const delivered = await h.service.advance("user-1", "topic-1"); // s3 CHECK delivered
    expect(delivered.content).toBe("How many apples do you have in total?");
    const persisted = h.state.messages[h.state.messages.length - 1];
    expect(persisted.content).toBe("How many apples do you have in total?");
    expect(persisted.content).toBe(delivered.content); // exact match — what /tutor/speech's anti-injection check requires
  });

  it("2026-09-19 real-world bug: trims trailing whitespace in a plain-text (non-CHECK) step's content the same way", async () => {
    const h = makeHarness({
      generateImpl: async () => ({ content: "Let's talk about addition. ", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }),
    });
    const delivered = await h.service.advance("user-1", "topic-1"); // s1 INTRO, plain text
    expect(delivered.content).toBe("Let's talk about addition.");
    const persisted = h.state.messages[h.state.messages.length - 1];
    expect(persisted.content).toBe(delivered.content);
  });

  it("2026-09-19 real-world bug: trims trailing whitespace in a CHECK-evaluation (respond()) reply's \"say\" field the same way", async () => {
    const h = makeHarness({
      generateImpl: async (args: any) =>
        args.responseFormat === "json_object"
          ? { content: JSON.stringify({ intent: "answer", isCorrect: true, say: "There you go! " }), inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" }
          : { content: "some teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" },
    });
    await h.service.advance("user-1", "topic-1");
    await h.service.advance("user-1", "topic-1");
    await h.service.advance("user-1", "topic-1"); // s3 CHECK delivered
    const answered = await h.service.respond("user-1", "topic-1", "some answer");
    expect(answered.content).toBe("There you go!");
    const persisted = h.state.messages[h.state.messages.length - 1];
    expect(persisted.content).toBe(answered.content);
  });

  it("2026-09-19 real-world bug: a non-Mathematics subject's CHECK step never carries a deterministic expression, even when the model returns one — a real Science lesson's model invented 'add 3+2' for a life-processes question, user-confirmed ('بيدخل ال math في ال science')", async () => {
    const h = makeHarness({
      generateImpl: async (args: any) =>
        args.responseFormat === "json_object"
          ? { content: JSON.stringify({ say: "If you have 3 apples and add 2 more, how many do you have?", expression: { op: "add", operands: [3, 2] } }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }
          : { content: "some teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" },
    });
    h.state.topics["topic-science"] = {
      id: "topic-science", nameEn: "Life processes", teachingStepsJson: STEPS,
      unit: { subjectId: "subject-2", subject: { nameEn: "Science" } },
    };
    await h.service.advance("user-1", "topic-science");
    await h.service.advance("user-1", "topic-science");
    await h.service.advance("user-1", "topic-science"); // s3 CHECK delivered
    const session = h.getSession("user-1", "topic-science");
    const s3Result = session.stepResultsJson.find((r: any) => r.stepId === "s3");
    expect(s3Result.expression).toBeUndefined();
  });

  it("G: an incorrect answer gives a hint and stays on the same step, then a correct retry resolves it", async () => {
    let checkEvaluations = 0;
    const h = makeHarness({
      generateImpl: async (args: any) => {
        const isCheckDelivery = args.messages?.[0]?.content === 'Teach the "CHECK" step now.';
        if (isCheckDelivery) {
          // Conceptual check (no expression) -> falls back to AI grading below.
          return { content: JSON.stringify({ say: "some teaching content", expression: null }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
        }
        if (args.responseFormat !== "json_object") return { content: "some teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
        checkEvaluations++;
        if (checkEvaluations === 1) return { content: JSON.stringify({ intent: "answer", isCorrect: false, say: "not quite, think about combining" }), inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" };
        return { content: JSON.stringify({ intent: "answer", isCorrect: true, say: "there you go" }), inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" };
      },
    });
    await h.service.advance("user-1", "topic-1");
    await h.service.advance("user-1", "topic-1");
    await h.service.advance("user-1", "topic-1"); // s3 CHECK
    const first = await h.service.respond("user-1", "topic-1", "wrong guess");
    expect(first.currentStepIndex).toBe(2); // unchanged
    expect(first.content).toContain("not quite");
    const retry = await h.service.respond("user-1", "topic-1", "combining two groups");
    expect(retry.currentStepIndex).toBe(2); // still unchanged — advance() is required to move on
    expect(retry.content).toBe("there you go");
    const advanced = await h.service.advance("user-1", "topic-1");
    expect(advanced.currentStepIndex).toBe(3);
  });

  it("H: no infinite retry — on a conceptual check, a third incorrect answer (after the Phase 8 strategy switch) is force-resolved rather than looping forever", async () => {
    const h = makeHarness({
      generateImpl: async () => ({ content: JSON.stringify({ intent: "answer", isCorrect: false, say: "still not right" }), inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" }),
    });
    await h.service.advance("user-1", "topic-1");
    await h.service.advance("user-1", "topic-1");
    await h.service.advance("user-1", "topic-1"); // s3 CHECK (conceptual)
    await h.service.respond("user-1", "topic-1", "wrong 1"); // hint given, stays
    await h.service.respond("user-1", "topic-1", "wrong 2"); // Phase 8: strategy switches instead of force-resolving — one genuine extra attempt
    const stillPending = await h.service.advance("user-1", "topic-1");
    expect(stillPending.currentStepIndex).toBe(2); // still on s3 — the switch is not a resolution
    await h.service.respond("user-1", "topic-1", "wrong 3"); // model still says incorrect, already switched once — must force-resolve now
    const advanced = await h.service.advance("user-1", "topic-1");
    expect(advanced.currentStepIndex).toBe(3); // moved on despite never answering correctly
  });

  describe("deterministic answer validation (Phase 3A)", () => {
    // s3's objective text is "check concept" (conceptual, no expression);
    // s5's is "check application" (applied arithmetic) — used below to make
    // the mock deliver a real add-expression only for s5, exactly like the
    // real prompt would for an "applied" numeric check vs a conceptual one.
    function makeDeterministicHarness(narrateImpl?: (args: any) => any) {
      return makeHarness({
        generateImpl: async (args: any) => {
          const isCheckDelivery = args.messages?.[0]?.content === 'Teach the "CHECK" step now.';
          if (isCheckDelivery && args.systemPrompt.includes("check application")) {
            return { content: JSON.stringify({ say: "4 + 3 = ?", expression: { op: "add", operands: [4, 3] } }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
          }
          if (isCheckDelivery) {
            return { content: JSON.stringify({ say: "what does + mean?", expression: null }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
          }
          if (args.responseFormat === "json_object") {
            // The AI-classification fallback path (s3, which has no captured expression).
            return { content: JSON.stringify({ intent: "answer", isCorrect: true, say: "good" }), inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" };
          }
          if (narrateImpl) return narrateImpl(args);
          return { content: "ok, moving on", inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" };
        },
      });
    }

    async function reachS5Check(h: ReturnType<typeof makeDeterministicHarness>) {
      await h.service.advance("user-1", "topic-1"); // s1
      await h.service.advance("user-1", "topic-1"); // s2
      await h.service.advance("user-1", "topic-1"); // s3 CHECK delivered (no expression)
      await h.service.respond("user-1", "topic-1", "anything"); // resolves s3 via AI fallback
      await h.service.advance("user-1", "topic-1"); // s4 EXAMPLE
      return h.service.advance("user-1", "topic-1"); // s5 CHECK delivered (has expression: 4+3)
    }

    it("rejects an incorrect numeric answer deterministically, even when the AI's own narration text claims it's correct", async () => {
      const h = makeDeterministicHarness(async () => ({ content: "great job, that's totally correct!", inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" }));
      const delivered = await reachS5Check(h);
      expect(delivered.currentStepIndex).toBe(4);
      const result = await h.service.respond("user-1", "topic-1", "6"); // the exact 4+3=6 misgrading found in live QA
      expect(result.readyToContinue).toBe(false); // graded incorrect regardless of the contradictory narration text
      expect(result.currentStepIndex).toBe(4); // unchanged
    });

    it("accepts a correct numeric answer deterministically", async () => {
      const h = makeDeterministicHarness();
      await reachS5Check(h);
      const result = await h.service.respond("user-1", "topic-1", "7");
      expect(result.readyToContinue).toBe(true);
    });

    it("still supports hint-then-retry via the deterministic path", async () => {
      const h = makeDeterministicHarness();
      await reachS5Check(h);
      const wrong = await h.service.respond("user-1", "topic-1", "6");
      expect(wrong.readyToContinue).toBe(false);
      const retry = await h.service.respond("user-1", "topic-1", "7");
      expect(retry.readyToContinue).toBe(true);
    });

    it("still enforces no-infinite-retry via the deterministic path", async () => {
      const h = makeDeterministicHarness();
      await reachS5Check(h);
      await h.service.respond("user-1", "topic-1", "6"); // wrong, hint given
      const secondWrong = await h.service.respond("user-1", "topic-1", "9"); // still wrong -> force-resolved
      expect(secondWrong.readyToContinue).toBe(true);
    });

    it("falls back to AI classification when the reply can't be parsed as a clean numeric answer (e.g. an interruption question during a numeric check)", async () => {
      const h = makeDeterministicHarness();
      await reachS5Check(h);
      const result = await h.service.respond("user-1", "topic-1", "يعني إيه علامة = ؟");
      expect(result.content).toBe("good"); // went through the AI-classification fallback branch, not a crash
    });
  });

  it("I: an interruption on a non-CHECK step does not advance the step", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1"); // s1 INTRO
    const beforeIndex = (await h.service.getState("user-1", "topic-1") as any).currentStepIndex;
    await h.service.respond("user-1", "topic-1", "what does the plus sign mean?");
    const afterIndex = (await h.service.getState("user-1", "topic-1") as any).currentStepIndex;
    expect(afterIndex).toBe(beforeIndex);
  });

  it("J: an interruption answer is returned to the student without changing lesson position", async () => {
    const h = makeHarness({ generateImpl: async () => ({ content: "المساواة معناها إن الطرفين متساويين", inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" }) });
    await h.service.advance("user-1", "topic-1");
    const result = await h.service.respond("user-1", "topic-1", "يعني إيه علامة =؟");
    expect(result.content).toContain("متساويين");
    expect(result.currentStepIndex).toBe(0);
  });

  it("K: leaving and reopening (a fresh advance() call) resumes at the current position rather than restarting", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1"); // s1
    await h.service.advance("user-1", "topic-1"); // s2
    const resumed = await h.service.advance("user-1", "topic-1"); // simulates reopening — same call shape as first visit
    // Step 2 (EXPLAIN) was already delivered, so this call moves to step 3, not back to step 0.
    expect(resumed.currentStepIndex).toBe(2);
  });

  it("L: a completed session stays completed on further advance() calls", async () => {
    const h = makeHarness({
      generateImpl: async () => ({ content: JSON.stringify({ intent: "answer", isCorrect: true, say: "yes" }), inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" }),
    });
    for (let i = 0; i < STEPS.length; i++) {
      await h.service.advance("user-1", "topic-1");
      const state = await h.service.getState("user-1", "topic-1") as any;
      if (state.stepType === "CHECK" && !state.completed) {
        await h.service.respond("user-1", "topic-1", "answer");
      }
    }
    let finalState = await h.service.advance("user-1", "topic-1");
    expect(finalState.status).toBe("COMPLETED");
    expect(finalState.completed).toBe(true);
    const again = await h.service.advance("user-1", "topic-1");
    expect(again.status).toBe("COMPLETED");
  });

  it("M: a student cannot access another student's LessonSession", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1");
    // user-2 has never started this topic — advance() must create THEIR OWN session, not reuse user-1's.
    await h.service.advance("user-2", "topic-1");
    const s1 = h.getSession("user-1", "topic-1");
    const s2 = h.getSession("user-2", "topic-1");
    expect(s1.id).not.toBe(s2.id);
    expect(s1.studentId).toBe("student-1");
    expect(s2.studentId).toBe("student-2");
  });

  it("N: a genuinely unknown topic id is rejected", async () => {
    const h = makeHarness();
    await expect(h.service.advance("user-1", "no-such-topic")).rejects.toThrow(NotFoundException);
  });

  it("N2: a title-only topic (teachingStepsJson: null) is lazily generated on first advance(), not rejected", async () => {
    const h = makeHarness();
    h.state.topics["topic-2"] = { id: "topic-2", nameEn: "No Plan", nameAr: "بلا خطة", unitId: "unit-1", teachingStepsJson: null, unit: { subjectId: "subject-1", subject: { nameEn: "Mathematics" } } };
    const result = await h.service.advance("user-1", "topic-2");
    expect(h.draftGenerator.ensureTopicHasLesson).toHaveBeenCalledWith("topic-2", expect.any(Object), expect.any(String));
    expect(result.totalSteps).toBe(STEPS.length);
  });

  it("N3: getState() on a title-only topic (teachingStepsJson: null) reports { started: false } instead of throwing — so the frontend can still render the Start Lesson button", async () => {
    const h = makeHarness();
    h.state.topics["topic-2"] = { id: "topic-2", nameEn: "No Plan", nameAr: "بلا خطة", unitId: "unit-1", teachingStepsJson: null, unit: { subjectId: "subject-1", subject: { nameEn: "Mathematics" } } };
    const result = await h.service.getState("user-1", "topic-2");
    expect(result).toEqual({ started: false, preparation: { status: "READY" } });
  });

  /**
   * Production hotfix (2026-09-25): when grounding preparation reports
   * CONFIGURATION_ERROR (e.g. a missing R2 source object, or the new
   * retry-ceiling — see UnitGroundingService), the student must get one
   * clear, safe, generic error immediately — never the internal `reason`
   * string (which could otherwise carry a storage key/error name), and
   * never an endless PREPARING loop.
   */
  it("a title-only topic whose grounding preparation reports CONFIGURATION_ERROR surfaces one safe, generic error — never the internal reason", async () => {
    const h = makeHarness({ groundingPreparationResult: { status: "CONFIGURATION_ERROR" } });
    h.state.topics["topic-2"] = { id: "topic-2", nameEn: "No Plan", nameAr: "بلا خطة", unitId: "unit-1", teachingStepsJson: null, unit: { subjectId: "subject-1", subject: { nameEn: "Mathematics" } } };

    await expect(h.service.advance("user-1", "topic-2")).rejects.toThrow("This lesson is not available yet.");
    expect(h.draftGenerator.ensureTopicHasLesson).not.toHaveBeenCalled();

    try {
      await h.service.advance("user-1", "topic-2");
      fail("expected advance() to throw");
    } catch (err: any) {
      // Never leaks the internal machine-readable reason (e.g.
      // "source_object_not_found") to the student-facing exception.
      expect(String(err.message)).not.toMatch(/source_object_not_found|retryable_failure_limit_exceeded|NoSuchKey/);
    }
  });

  it("getState() on a genuinely unknown topic id still throws NotFoundException", async () => {
    const h = makeHarness();
    await expect(h.service.getState("user-1", "no-such-topic")).rejects.toThrow(NotFoundException);
  });

  it("reserves entitlement exactly once at session start, never again on resume", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1"); // starts — reserves
    await h.service.advance("user-1", "topic-1"); // resumes/continues — must not reserve again
    await h.service.advance("user-1", "topic-1");
    expect(h.trialService.reserveLessonTrial).toHaveBeenCalledTimes(1);
  });

  /**
   * Subject entitlement fix (2026-09-20) — Lesson access is gated by
   * StudentSubject for the SPECIFIC Subject being opened, never
   * account-wide Subscription.status (there is no `subscription` mock at
   * all anymore — see the harness's own comment on `studentSubject`).
   */
  describe("Subject entitlement gate (never account-wide Subscription.status)", () => {
    it("a permanently owned Subject (expiresAt: null) uses the daily/extra quota path, never the trial", async () => {
      const h = makeHarness({ studentSubjectRow: { expiresAt: null } });
      await h.service.advance("user-1", "topic-1");
      expect(h.questionPacks.consumeForTutor).toHaveBeenCalledWith("student-1", "subject-1");
      expect(h.trialService.reserveLessonTrial).not.toHaveBeenCalled();
    });

    it("an active time-limited Subject grant (e.g. a referral reward, expiresAt in the future) also uses the daily/extra quota path — with no active Subscription at all", async () => {
      const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const h = makeHarness({ studentSubjectRow: { expiresAt: future } });
      await h.service.advance("user-1", "topic-1");
      expect(h.questionPacks.consumeForTutor).toHaveBeenCalledWith("student-1", "subject-1");
      expect(h.trialService.reserveLessonTrial).not.toHaveBeenCalled();
    });

    it("an EXPIRED Subject grant (expiresAt in the past) is never treated as owned — falls through to the trial gate like any unentitled Subject", async () => {
      const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const h = makeHarness({ studentSubjectRow: { expiresAt: past } });
      await h.service.advance("user-1", "topic-1");
      expect(h.questionPacks.consumeForTutor).not.toHaveBeenCalled();
      expect(h.trialService.reserveLessonTrial).toHaveBeenCalledWith("student-1", "subject-1", "topic-1");
    });

    it("no StudentSubject row at all falls through to the trial gate (the pre-existing default every other test in this file relies on)", async () => {
      const h = makeHarness();
      await h.service.advance("user-1", "topic-1");
      expect(h.questionPacks.consumeForTutor).not.toHaveBeenCalled();
      expect(h.trialService.reserveLessonTrial).toHaveBeenCalledWith("student-1", "subject-1", "topic-1");
    });
  });

  it("rejects a respond() call with an empty message", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1");
    await expect(h.service.respond("user-1", "topic-1", "   ")).rejects.toThrow(BadRequestException);
  });

  it("rejects an oversized respond() message BEFORE any provider call (Phase 9.4A/9.4B — parity with TutorService's 4000-char cap)", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1");
    h.generateSpy.mockClear();
    const oversized = "a".repeat(4001);
    await expect(h.service.respond("user-1", "topic-1", oversized)).rejects.toThrow(BadRequestException);
    expect(h.generateSpy).not.toHaveBeenCalled();
  });

  it("accepts a message at exactly the 4000-character limit", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1");
    const atLimit = "a".repeat(4000);
    await expect(h.service.respond("user-1", "topic-1", atLimit)).resolves.toBeDefined();
  });

  describe("non-progress AI-spend guard (Phase 9.4B — closes the Phase 9.4A unbounded-respond() finding)", () => {
    it("blocks further AI calls once the non-progress-turn limit is reached on a non-CHECK step, without ever calling the provider again", async () => {
      const h = makeHarness();
      await h.service.advance("user-1", "topic-1"); // s1 (INTRO) delivered — current step is non-CHECK
      h.generateSpy.mockClear();

      for (let i = 0; i < 20; i++) {
        await h.service.respond("user-1", "topic-1", `interruption question #${i}`);
      }
      expect(h.generateSpy).toHaveBeenCalledTimes(20);

      const blocked = await h.service.respond("user-1", "topic-1", "one more question");
      expect(h.generateSpy).toHaveBeenCalledTimes(20); // no new call
      // user-1's profile is Arabic (preferredLang: "ar") — the fixed
      // limit message is locale-aware, never AI-generated.
      expect(blocked.content).toMatch(/أسئلة/);
    });

    it("does not grow the counter past the limit once blocked (stays capped, not unbounded)", async () => {
      const h = makeHarness();
      await h.service.advance("user-1", "topic-1");
      for (let i = 0; i < 22; i++) {
        await h.service.respond("user-1", "topic-1", `question #${i}`);
      }
      const session = h.getSession("user-1", "topic-1");
      expect(session.nonProgressTurns).toBe(20);
    });

    it("never counts a genuine deterministic CHECK answer attempt against the non-progress budget", async () => {
      // Mirrors the "deterministic answer validation" harness below: s5's
      // delivery is mocked to return a real captured `expression`, so "6"/"7"
      // responses are validated deterministically (never reaching the
      // AI-classification branch this guard applies to). s3 (conceptual, no
      // expression) resolves via one genuine AI-classification call, which
      // DOES count — establishing a non-zero `before` on purpose, to prove
      // the deterministic calls after it add nothing further.
      const h = makeHarness({
        generateImpl: async (args: any) => {
          const isCheckDelivery = args.messages?.[0]?.content === 'Teach the "CHECK" step now.';
          if (isCheckDelivery && args.systemPrompt.includes("check application")) {
            return { content: JSON.stringify({ say: "4 + 3 = ?", expression: { op: "add", operands: [4, 3] } }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
          }
          if (isCheckDelivery) {
            return { content: JSON.stringify({ say: "what does + mean?", expression: null }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" };
          }
          if (args.responseFormat === "json_object") {
            return { content: JSON.stringify({ intent: "answer", isCorrect: true, say: "good" }), inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" };
          }
          return { content: "ok, moving on", inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" };
        },
      });
      await h.service.advance("user-1", "topic-1"); // s1
      await h.service.advance("user-1", "topic-1"); // s2
      await h.service.advance("user-1", "topic-1"); // s3 CHECK delivered (no expression)
      await h.service.respond("user-1", "topic-1", "anything"); // resolves s3 via AI-classification fallback — counts
      await h.service.advance("user-1", "topic-1"); // s4 EXAMPLE
      await h.service.advance("user-1", "topic-1"); // s5 CHECK delivered (expression: 4+3) — deterministic-eligible
      const before = h.getSession("user-1", "topic-1").nonProgressTurns;
      expect(before).toBe(1); // exactly the one AI-classification resolution of s3, nothing from delivery turns
      await h.service.respond("user-1", "topic-1", "6"); // wrong, deterministic path
      await h.service.respond("user-1", "topic-1", "7"); // correct, deterministic path
      const after = h.getSession("user-1", "topic-1").nonProgressTurns;
      expect(after).toBe(before); // deterministic answer attempts never consume this budget
    });

    it("also blocks the AI-classification fallback path on a CHECK step (e.g. repeated non-answer chatter), before any provider call", async () => {
      const h = makeHarness({
        generateImpl: async () => ({ content: JSON.stringify({ intent: "question", isCorrect: null, say: "Still just a question." }), inputTokens: 5, outputTokens: 5, model: "gpt-4o-mini" }),
      });
      await h.service.advance("user-1", "topic-1"); // s1
      await h.service.advance("user-1", "topic-1"); // s2
      await h.service.advance("user-1", "topic-1"); // s3 (conceptual CHECK — AI-classification path)
      h.generateSpy.mockClear();

      for (let i = 0; i < 20; i++) {
        await h.service.respond("user-1", "topic-1", `not really an answer #${i}`);
      }
      expect(h.generateSpy).toHaveBeenCalledTimes(20);

      await h.service.respond("user-1", "topic-1", "still not an answer");
      expect(h.generateSpy).toHaveBeenCalledTimes(20); // blocked before the call
    });
  });

  it("logs lesson turns with feature 'lesson_chat' and creditsUsed 0 (entitlement already reserved once at session start)", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1");
    expect(h.state.usage[0].feature).toBe("lesson_chat");
    expect(h.state.usage[0].creditsUsed).toBe(0);
  });

  it("persists every teaching turn as a real AIMessage on the session's own conversation (so /tutor/speech can verify and speak it)", async () => {
    const h = makeHarness();
    const result = await h.service.advance("user-1", "topic-1");
    const stored = h.state.messages.find((m) => m.conversationId === result.conversationId);
    expect(stored).toBeDefined();
    expect(stored.content).toBe(result.content);
    expect(stored.role).toBe("assistant");
  });

  describe("getVisualAsset (Phase 4)", () => {
    it("returns the stored asset when it exists", async () => {
      const h = makeHarness();
      const asset = { id: "asset-1", topicId: "topic-1", stepId: "s4", mimeType: "image/png", data: Buffer.from("fake-bytes") };
      h.prisma.client.lessonVisualAsset.findUnique.mockResolvedValueOnce(asset);
      const result = await h.service.getVisualAsset("asset-1");
      expect(result).toBe(asset);
    });

    it("throws NotFoundException for an unknown asset id, rather than serving nothing silently", async () => {
      const h = makeHarness();
      await expect(h.service.getVisualAsset("does-not-exist")).rejects.toThrow(NotFoundException);
    });
  });

  describe("teaching strategy (Phase 8 V1)", () => {
    // s3 (checkType: "conceptual") is the pilot's switch point. Responses
    // are keyed to the exact call sequence the test below drives.
    function strategyGenerateImpl() {
      let call = 0;
      return async (args: any) => {
        call++;
        if (call <= 2) return { content: "teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // s1, s2 deliver
        if (call === 3) return { content: JSON.stringify({ say: "How many apples do you have?", expression: null }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // s3 deliver (conceptual, no expression)
        if (call === 4) return { content: JSON.stringify({ intent: "answer", isCorrect: false, say: "Not quite, try again." }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // attempt 1: wrong
        if (call === 5) return { content: JSON.stringify({ intent: "answer", isCorrect: false, say: "Still not it — let's try differently." }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // attempt 2: wrong -> should switch
        return { content: JSON.stringify({ intent: "answer", isCorrect: true, say: "That's it!" }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // attempt 3: correct
      };
    }

    async function driveToSecondWrongAttempt(h: ReturnType<typeof makeHarness>) {
      await h.service.advance("user-1", "topic-1"); // deliver s1
      await h.service.advance("user-1", "topic-1"); // deliver s2
      await h.service.advance("user-1", "topic-1"); // deliver s3 (CHECK conceptual)
      await h.service.respond("user-1", "topic-1", "5"); // attempt 1: wrong
      return h.service.respond("user-1", "topic-1", "5"); // attempt 2: wrong -> switch
    }

    it("defaults to CONCRETE_OBJECTS with no prior state", async () => {
      const h = makeHarness({ generateImpl: strategyGenerateImpl() });
      await h.service.advance("user-1", "topic-1"); // s1
      const result = await h.service.advance("user-1", "topic-1"); // deliver s2 (EXPLAIN)
      const session = h.getSession("user-1", "topic-1");
      const s2 = session.stepResultsJson.find((r: any) => r.stepId === "s2");
      expect(s2.strategy).toBe("CONCRETE_OBJECTS");
      expect(result).toBeDefined();
    });

    it("does not switch after the first meaningful wrong attempt", async () => {
      const h = makeHarness({ generateImpl: strategyGenerateImpl() });
      await h.service.advance("user-1", "topic-1");
      await h.service.advance("user-1", "topic-1");
      await h.service.advance("user-1", "topic-1");
      await h.service.respond("user-1", "topic-1", "5");
      const session = h.getSession("user-1", "topic-1");
      const s3 = session.stepResultsJson.find((r: any) => r.stepId === "s3");
      expect(s3.strategy).toBe("CONCRETE_OBJECTS");
      expect(s3.strategyHistory ?? []).toHaveLength(0);
      expect(s3.correct).toBe(false);
    });

    it("switches to NUMBER_LINE on the second meaningful wrong attempt, recording the reason", async () => {
      const h = makeHarness({ generateImpl: strategyGenerateImpl() });
      await driveToSecondWrongAttempt(h);
      const session = h.getSession("user-1", "topic-1");
      const s3 = session.stepResultsJson.find((r: any) => r.stepId === "s3");
      expect(s3.strategy).toBe("NUMBER_LINE");
      expect(s3.strategyHistory).toHaveLength(1);
      expect(s3.strategyHistory[0]).toMatchObject({ strategy: "NUMBER_LINE", atStepId: "s3" });
      expect(s3.strategyHistory[0].reason).toMatch(/2.*meaningful/);
      // The switch itself is the second chance — not yet force-resolved.
      expect(s3.correct).toBe(false);
    });

    it("preserves strategy history across a resumed session (fresh getState call)", async () => {
      const h = makeHarness({ generateImpl: strategyGenerateImpl() });
      await driveToSecondWrongAttempt(h);
      const state = await h.service.getState("user-1", "topic-1") as any;
      const s3 = state.stepResults.find((r: any) => r.stepId === "s3");
      expect(s3.strategy).toBe("NUMBER_LINE");
      expect(s3.strategyHistory).toHaveLength(1);
      expect(state.currentStepIndex).toBe(2); // still on s3, not advanced past the check
    });

    it("changes the prompt's strategy guidance after a switch", async () => {
      const h = makeHarness({ generateImpl: strategyGenerateImpl() });
      await driveToSecondWrongAttempt(h); // 5 calls: s1, s2, s3-deliver, attempt1, attempt2(switch)
      const beforeSwitchPrompt = h.generateSpy.mock.calls[3][0].systemPrompt as string; // attempt 1 call
      await h.service.respond("user-1", "topic-1", "4"); // attempt 3, post-switch — 6th call
      const afterSwitchPrompt = h.generateSpy.mock.calls[5][0].systemPrompt as string;
      expect(beforeSwitchPrompt).toContain("CONCRETE_OBJECTS");
      expect(afterSwitchPrompt).toContain("NUMBER_LINE");
      expect(afterSwitchPrompt).toMatch(/number line/i);
      expect(afterSwitchPrompt).not.toBe(beforeSwitchPrompt);
    });

    it("accepts a correct answer after the switch, without a duplicate LessonSession", async () => {
      const h = makeHarness({ generateImpl: strategyGenerateImpl() });
      await driveToSecondWrongAttempt(h);
      const sessionCountBefore = Object.keys(h.state.sessions).length;
      const result = await h.service.respond("user-1", "topic-1", "4"); // attempt 3: correct
      const session = h.getSession("user-1", "topic-1");
      const s3 = session.stepResultsJson.find((r: any) => r.stepId === "s3");
      expect(s3.correct).toBe(true);
      expect(Object.keys(h.state.sessions).length).toBe(sessionCountBefore); // no duplicate session
      expect(result.content).toBe("That's it!");
    });

    it("never switches strategy on the deterministic applied check (s5) — only conceptual checks are eligible", async () => {
      let call = 0;
      const impl = async () => {
        call++;
        if (call <= 3) return { content: "teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // s1, s2, and s3 delivered as plain content
        if (call === 4) return { content: JSON.stringify({ intent: "answer", isCorrect: true, say: "Good!" }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // s3 answered correctly first try — no switch
        return { content: JSON.stringify({ say: "What is 5 plus 0?", expression: { op: "add", operands: [5, 0] } }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // s5 deliver
      };
      const h = makeHarness({ generateImpl: impl });
      await h.service.advance("user-1", "topic-1"); // s1
      await h.service.advance("user-1", "topic-1"); // s2
      await h.service.advance("user-1", "topic-1"); // s3 deliver
      await h.service.respond("user-1", "topic-1", "4"); // s3 correct — no switch
      await h.service.advance("user-1", "topic-1"); // move to s4
      await h.service.advance("user-1", "topic-1"); // deliver s5 (deterministic, expression captured)
      await h.service.respond("user-1", "topic-1", "6"); // wrong — deterministic rejects regardless of strategy
      const wrongSession = h.getSession("user-1", "topic-1");
      const s5AfterWrong = wrongSession.stepResultsJson.find((r: any) => r.stepId === "s5");
      expect(s5AfterWrong.correct).toBe(false); // deterministic validator, not AI, decided this
      expect(s5AfterWrong.strategyHistory ?? []).toHaveLength(0); // never eligible for switching

      await h.service.respond("user-1", "topic-1", "5"); // correct
      const finalSession = h.getSession("user-1", "topic-1");
      const s5Final = finalSession.stepResultsJson.find((r: any) => r.stepId === "s5");
      expect(s5Final.correct).toBe(true);
      expect(finalSession.stepResultsJson.find((r: any) => r.stepId === "s3").strategyHistory ?? []).toHaveLength(0);
    });

    it("strategy selection itself causes no additional AI call: exactly one generate() call per attempt, none extra for the switch", async () => {
      const h = makeHarness({ generateImpl: strategyGenerateImpl() });
      await driveToSecondWrongAttempt(h); // 5 calls: s1, s2, s3-deliver, attempt1, attempt2(switch)
      expect(h.generateSpy).toHaveBeenCalledTimes(5);
    });
  });

  /**
   * Production hotfix (2026-09-25): a real Student E2E found a Science
   * lesson about flowering/non-flowering plants taught with "take 2 steps
   * forward on a number line" — the Phase 8 math-strategy system
   * (CONCRETE_OBJECTS/NUMBER_LINE switching + guidance) was running for
   * every subject, unconditionally. These tests prove a Science topic
   * (isMathSubject("Science") === false) never triggers any of it, while
   * the Mathematics tests above (unchanged) prove Math behavior is
   * preserved exactly as before.
   */
  describe("subject-safe teaching strategy hotfix (2026-09-25)", () => {
    const SCIENCE_STEPS = [
      { id: "sc1", type: "INTRO", order: 1, objective: "greet and frame" },
      { id: "sc2", type: "EXPLAIN", order: 2, objective: "explain flowering vs non-flowering plants" },
      { id: "sc3", type: "CHECK", order: 3, objective: "check concept", checkType: "conceptual" },
      { id: "sc4", type: "COMPLETE", order: 4, objective: "acknowledge completion" },
    ];

    function scienceExtraTopics(overrides: Partial<{ session: any }> = {}) {
      return {
        "topic-science": {
          id: "topic-science",
          nameEn: "Flowering and Non-Flowering Plants",
          teachingStepsJson: SCIENCE_STEPS,
          unit: { subjectId: "subject-science", subject: { nameEn: "Science" } },
        },
      };
    }

    // Two consecutive wrong conceptual-CHECK attempts — for Mathematics
    // (see strategyGenerateImpl above) this exact call sequence is what
    // triggers the CONCRETE_OBJECTS -> NUMBER_LINE switch.
    function scienceGenerateImpl() {
      let call = 0;
      return async () => {
        call++;
        if (call <= 2) return { content: "teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // sc1, sc2 deliver
        if (call === 3) return { content: JSON.stringify({ say: "Does this plant produce flowers?", expression: null }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // sc3 deliver
        if (call === 4) return { content: JSON.stringify({ intent: "answer", isCorrect: false, say: "Not quite, try again." }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // attempt 1: wrong
        if (call === 5) return { content: JSON.stringify({ intent: "answer", isCorrect: false, say: "Still not it — let's look at the plant again." }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // attempt 2: wrong
        return { content: JSON.stringify({ intent: "answer", isCorrect: true, say: "That's right!" }), inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }; // attempt 3: correct
      };
    }

    it("1. repeated incorrect conceptual CHECKs never switch to NUMBER_LINE", async () => {
      const h = makeHarness({ generateImpl: scienceGenerateImpl(), extraTopics: scienceExtraTopics() });
      await h.service.advance("user-1", "topic-science"); // sc1
      await h.service.advance("user-1", "topic-science"); // sc2
      await h.service.advance("user-1", "topic-science"); // sc3 deliver
      await h.service.respond("user-1", "topic-science", "no"); // attempt 1: wrong
      await h.service.respond("user-1", "topic-science", "no"); // attempt 2: wrong — would switch for Math
      const session = h.getSession("user-1", "topic-science");
      const sc3 = session.stepResultsJson.find((r: any) => r.stepId === "sc3");
      expect(sc3.strategy).toBeUndefined();
      expect(sc3.strategyHistory ?? []).toHaveLength(0);
    });

    it("2. teaching/check prompts contain no mandatory number-line/math strategy guidance", async () => {
      const h = makeHarness({ generateImpl: scienceGenerateImpl(), extraTopics: scienceExtraTopics() });
      await h.service.advance("user-1", "topic-science"); // sc1
      await h.service.advance("user-1", "topic-science"); // sc2 (EXPLAIN — would carry strategy guidance for Math)
      await h.service.advance("user-1", "topic-science"); // sc3 deliver (CHECK)
      await h.service.respond("user-1", "topic-science", "no"); // attempt 1 — evaluate_check prompt
      for (const call of h.generateSpy.mock.calls) {
        const prompt = call[0].systemPrompt as string;
        expect(prompt).not.toMatch(/number.line/i);
        expect(prompt).not.toMatch(/MANDATORY REPRESENTATION/i);
        expect(prompt).not.toContain("CONCRETE_OBJECTS");
        expect(prompt).not.toContain("NUMBER_LINE");
      }
    });

    it("3. a resumed Science session already containing strategy: \"NUMBER_LINE\" ignores that persisted strategy", async () => {
      const h = makeHarness({ generateImpl: scienceGenerateImpl(), extraTopics: scienceExtraTopics() });
      await h.service.advance("user-1", "topic-science"); // sc1
      await h.service.advance("user-1", "topic-science"); // sc2
      await h.service.advance("user-1", "topic-science"); // sc3 deliver

      // Simulate a session left over from BEFORE this hotfix, where sc3 was
      // persisted with a stale math strategy (the exact production bug).
      const session = h.getSession("user-1", "topic-science");
      const sc3 = session.stepResultsJson.find((r: any) => r.stepId === "sc3");
      sc3.strategy = "NUMBER_LINE";
      sc3.strategyHistory = [{ strategy: "NUMBER_LINE", reason: "stale_pre_hotfix_data", atStepId: "sc3", switchedAt: new Date().toISOString() }];

      const result = await h.service.respond("user-1", "topic-science", "no"); // attempt 1: wrong
      expect(result.content).toBe("Not quite, try again.");
      const evaluatePrompt = h.generateSpy.mock.calls[h.generateSpy.mock.calls.length - 1][0].systemPrompt as string;
      expect(evaluatePrompt).not.toMatch(/number.line/i);
      expect(evaluatePrompt).not.toContain("NUMBER_LINE");

      const updatedSession = h.getSession("user-1", "topic-science");
      const updatedSc3 = updatedSession.stepResultsJson.find((r: any) => r.stepId === "sc3");
      // Self-healed: the stale value was overwritten with undefined on this
      // step's next write — no manual DB cleanup was needed.
      expect(updatedSc3.strategy).toBeUndefined();
    });

    it("4. remains on normal curriculum/topic remediation — the generic hint-then-force-resolve path, never the Math strategy-switch branch", async () => {
      const h = makeHarness({ generateImpl: scienceGenerateImpl(), extraTopics: scienceExtraTopics() });
      await h.service.advance("user-1", "topic-science");
      await h.service.advance("user-1", "topic-science");
      await h.service.advance("user-1", "topic-science");
      await h.service.respond("user-1", "topic-science", "no"); // attempt 1: wrong -> hint given
      const sc3AfterFirst = h.getSession("user-1", "topic-science").stepResultsJson.find((r: any) => r.stepId === "sc3");
      expect(sc3AfterFirst.correct).toBe(false);
      expect(sc3AfterFirst.hintGiven).toBe(true);

      // For Math, this exact second wrong attempt triggers a strategy
      // switch instead of force-resolving (see "H:" test above). For
      // Science there is no switch to fall back on, so the EXISTING
      // generic "no infinite retry — force-resolve after one hint" rule
      // applies untouched: the check simply resolves.
      await h.service.respond("user-1", "topic-science", "no"); // attempt 2: wrong, force-resolved
      const session = h.getSession("user-1", "topic-science");
      const sc3 = session.stepResultsJson.find((r: any) => r.stepId === "sc3");
      expect(sc3.correct).toBe(true); // force-resolved — normal remediation, no switch ever happened
      expect(sc3.strategyHistory ?? []).toHaveLength(0);
    });
  });

  /**
   * 2026-09-26 factual-provenance fix regression tests: proves the
   * already-selected Topic-scoped GroundingSlice (grounding-selector.util.ts)
   * is threaded into the runtime teaching prompt with ZERO extra Prisma
   * queries and ZERO extra provider/model calls, and that Topic.teachingStepsJson
   * is never touched by this fix.
   */
  describe("2026-09-26 factual-provenance fix", () => {
  const GROUNDED_STEPS = [
    { id: "g1", type: "INTRO", order: 1, objective: "greet and frame" },
    { id: "g2", type: "EXAMPLE", order: 2, objective: "Give an example of an author who has written more than one story." },
    { id: "g3", type: "COMPLETE", order: 3, objective: "acknowledge completion" },
  ];

  const GROUNDING_NOTES_JSON = {
    unitTitle: "Fiction: Different stories by the same author",
    gradeLevel: "Year 3",
    subject: "English Language",
    learningObjectives: ["Recognise that different stories can share the same author, style, or themes."],
    concepts: [
      { name: "Author style", description: "Different stories by the same author often share a similar style, characters, or setting.", sourcePages: [5, 6], importance: "core" },
    ],
    facts: [{ fact: "Atinuke is an author who has written several different stories.", sourcePages: [6], importance: "core" }],
    vocabulary: [],
    skills: [],
    topicHints: [],
    scopeNotes: [],
  };

  function groundedExtraTopics() {
    return {
      "topic-grounded": {
        id: "topic-grounded",
        nameEn: "Fiction: Different stories by the same author",
        teachingStepsJson: GROUNDED_STEPS,
        unit: { subjectId: "subject-english", subject: { nameEn: "English Language" }, groundingNotesJson: GROUNDING_NOTES_JSON },
      },
      "topic-ungrounded": {
        id: "topic-ungrounded",
        nameEn: "Fiction: Different stories by the same author",
        teachingStepsJson: GROUNDED_STEPS,
        unit: { subjectId: "subject-english", subject: { nameEn: "English Language" } }, // no groundingNotesJson at all
      },
    };
  }

  it("threads the Topic-scoped grounding into the runtime prompt for a grounded Unit — no unsupported named example is invited", async () => {
    const h = makeHarness({
      extraTopics: groundedExtraTopics(),
      generateImpl: async () => ({ content: "teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }),
    });
    await h.service.advance("user-1", "topic-grounded");
    const lastCallArgs = h.generateSpy.mock.calls[h.generateSpy.mock.calls.length - 1][0];
    expect(lastCallArgs.systemPrompt).toContain("Atinuke");
    expect(lastCallArgs.systemPrompt).toMatch(/FACTUAL PROVENANCE/i);
  });

  it("with no grounding available for the Unit, the prompt forbids any specific named real-world example", async () => {
    const h = makeHarness({
      extraTopics: groundedExtraTopics(),
      generateImpl: async () => ({ content: "teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }),
    });
    await h.service.advance("user-1", "topic-ungrounded");
    const lastCallArgs = h.generateSpy.mock.calls[h.generateSpy.mock.calls.length - 1][0];
    expect(lastCallArgs.systemPrompt).not.toContain("Atinuke");
    expect(lastCallArgs.systemPrompt).toMatch(/no REFERENCE NOTES are available/i);
  });

  it("adds zero extra Prisma queries — grounding selection reuses the Topic already fetched, never a new lookup", async () => {
    const h = makeHarness({
      extraTopics: groundedExtraTopics(),
      generateImpl: async () => ({ content: "teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }),
    });
    (h.prisma.client.topic.findUnique as jest.Mock).mockClear();
    await h.service.advance("user-1", "topic-grounded");
    // Exactly one Topic lookup per advance() call (getTopicOrThrow) — the
    // same count as every ungrounded topic in this file's other tests;
    // selectRelevantGrounding is a pure in-memory function over data that
    // single fetch already returned.
    expect((h.prisma.client.topic.findUnique as jest.Mock).mock.calls.length).toBe(1);
  });

  it("adds zero extra provider/model calls — exactly one generate() call for a single INTRO delivery", async () => {
    const h = makeHarness({
      extraTopics: groundedExtraTopics(),
      generateImpl: async () => ({ content: "teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }),
    });
    await h.service.advance("user-1", "topic-grounded");
    expect(h.generateSpy).toHaveBeenCalledTimes(1);
  });

  it("never mutates Topic.teachingStepsJson — the same object reference/content persists through delivery", async () => {
    const extraTopics = groundedExtraTopics();
    const before = JSON.stringify(extraTopics["topic-grounded"].teachingStepsJson);
    const h = makeHarness({
      extraTopics,
      generateImpl: async () => ({ content: "teaching content", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" }),
    });
    await h.service.advance("user-1", "topic-grounded");
    expect(JSON.stringify(h.state.topics["topic-grounded"].teachingStepsJson)).toBe(before);
  });
  });
});
