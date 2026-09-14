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

  function makeHarness(opts: { generateImpl?: (args: any) => any; subscriptionActive?: boolean } = {}) {
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
        subscription: { findUnique: jest.fn().mockResolvedValue(opts.subscriptionActive ? { status: "active" } : null) },
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
    } as any;

    const questionPacks = {
      consumeForTutor: jest.fn().mockResolvedValue({ source: "daily", limit: 10 }),
      refundExtraCredit: jest.fn().mockResolvedValue(undefined),
    } as any;

    const tutorService = {
      reserveFreeTrial: jest.fn().mockImplementation(async (studentId: string) => {
        reserveFreeTrialCalls++;
        state.freeTrials[studentId] = (state.freeTrials[studentId] ?? 0) + 1;
        return { source: "free-trial" as const };
      }),
      releaseFreeTrial: jest.fn().mockImplementation(async (studentId: string) => {
        releaseFreeTrialCalls++;
        state.freeTrials[studentId] = Math.max(0, (state.freeTrials[studentId] ?? 0) - 1);
      }),
    } as any;

    const service = new InteractiveLessonService(
      prisma,
      providerFactory,
      new AIContextBuilderService(),
      usageService,
      questionPacks,
      tutorService,
    );

    return {
      service,
      prisma,
      state,
      questionPacks,
      tutorService,
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

  it("N: an unknown/non-interactive topic (no teachingStepsJson) is rejected", async () => {
    const h = makeHarness();
    h.state.topics["topic-2"] = { id: "topic-2", nameEn: "No Plan", teachingStepsJson: null, unit: { subjectId: "subject-1", subject: { nameEn: "Mathematics" } } };
    await expect(h.service.advance("user-1", "topic-2")).rejects.toThrow(NotFoundException);
  });

  it("reserves entitlement exactly once at session start, never again on resume", async () => {
    const h = makeHarness();
    await h.service.advance("user-1", "topic-1"); // starts — reserves
    await h.service.advance("user-1", "topic-1"); // resumes/continues — must not reserve again
    await h.service.advance("user-1", "topic-1");
    expect(h.tutorService.reserveFreeTrial).toHaveBeenCalledTimes(1);
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
});
