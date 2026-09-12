import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { TutorService } from "./tutor.service";

/**
 * Covers the Phase 10 hardening added to the AI Tutor: input-length
 * validation, the active-subscription gate, ownership isolation on
 * conversation access, and — most importantly per the acceptance
 * review — that a reserved daily-limit slot is correctly released when
 * the flow fails before real AI cost is incurred, so a failed request
 * never silently costs the student one of their daily questions.
 */
describe("TutorService", () => {
  const studentProfile = {
    id: "student-1",
    fullName: "Test Student",
    age: 14,
    preferredLang: "en",
    curriculum: { nameEn: "Egyptian National Curriculum" },
    grade: { nameEn: "Grade 7" },
    subjects: [{ subjectId: "subject-1", subject: { id: "subject-1", nameEn: "Mathematics" } }],
  };

  function makeService(overrides: {
    subscription?: any;
    freeTrial?: any;
    reserveResult?: { reserved: boolean; limit: number };
    providerGenerate?: jest.Mock;
    providerFactoryError?: Error;
    conversation?: any;
    assertWithinBudget?: jest.Mock;
  } = {}) {
    const releaseDailySlot = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      client: {
        studentProfile: { findUnique: jest.fn().mockResolvedValue(studentProfile) },
        subscription: {
          findUnique: jest.fn().mockResolvedValue(
            overrides.subscription !== undefined ? overrides.subscription : { status: "active" },
          ),
        },
        freeTutorTrial: {
          upsert: jest.fn().mockResolvedValue(overrides.freeTrial ?? { id: "trial-1", subjectId: "subject-1", questionsUsed: 0 }),
          findUnique: jest.fn().mockResolvedValue(overrides.freeTrial ?? null),
          create: jest.fn().mockResolvedValue({ id: "trial-1", subjectId: "subject-1", questionsUsed: 1 }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        aIConversation: {
          findUnique: jest.fn().mockResolvedValue(overrides.conversation ?? null),
          create: jest.fn().mockResolvedValue({ id: "conv-1", studentId: "student-1" }),
        },
        aIMessage: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
        topic: { findUnique: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn().mockResolvedValue([]),
      },
    } as any;

    const providerFactory = {
      getActiveProvider: overrides.providerFactoryError
        ? jest.fn().mockRejectedValue(overrides.providerFactoryError)
        : jest.fn().mockResolvedValue({
            provider: { generate: overrides.providerGenerate ?? jest.fn().mockResolvedValue({ content: "Here's a hint...", inputTokens: 50, outputTokens: 30, model: "gpt-4o-mini" }) },
            providerKey: "openai",
            model: "gpt-4o-mini",
          }),
    } as any;

    const contextBuilder = { buildTutorSystemPrompt: jest.fn().mockReturnValue("system prompt") } as any;

    const usageService = {
      assertWithinBudget: overrides.assertWithinBudget ?? jest.fn().mockResolvedValue(undefined),
      reserveDailySlot: jest.fn().mockResolvedValue(overrides.reserveResult ?? { reserved: true, limit: 10 }),
      releaseDailySlot,
      buildUsageRow: jest.fn().mockResolvedValue({ costUsd: 0.0001 }),
      getRemainingToday: jest.fn().mockResolvedValue({ used: 1, limit: 10, remaining: 9 }),
      logUntrackedUsage: jest.fn(),
    } as any;

    const questionPacks = {
      consumeForTutor: jest.fn().mockImplementation(async () => {
        if (overrides.reserveResult && !overrides.reserveResult.reserved) throw new ForbiddenException("No questions remaining");
        return { source: "daily", limit: 10 };
      }),
      getRemaining: jest.fn().mockResolvedValue({ dailyRemaining: 9, extraRemaining: 3, totalRemaining: 12, packPriceEGP: 50, packSize: 10 }),
    } as any;
    const answerCache = {
      find: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;
    return { service: new TutorService(prisma, providerFactory, contextBuilder, usageService, questionPacks, answerCache), prisma, usageService, releaseDailySlot, questionPacks };
  }

  it("rejects an empty message before reserving a slot or calling the provider", async () => {
    const { service, usageService } = makeService();
    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "   " })).rejects.toThrow(BadRequestException);
    expect(usageService.reserveDailySlot).not.toHaveBeenCalled();
  });

  it("rejects an oversized message before reserving a slot or calling the provider", async () => {
    const { service, usageService } = makeService();
    const hugeMessage = "a".repeat(5000);
    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: hugeMessage })).rejects.toThrow(BadRequestException);
    expect(usageService.reserveDailySlot).not.toHaveBeenCalled();
  });

  it("rejects use of a subject the student didn't select, before touching subscription or usage", async () => {
    const { service, usageService } = makeService();
    await expect(service.sendMessage("user-1", { subjectId: "unrelated-subject", message: "hi" })).rejects.toThrow(ForbiddenException);
    expect(usageService.reserveDailySlot).not.toHaveBeenCalled();
  });

  it("rejects the message when the AI budget circuit breaker is tripped, before reserving a slot or calling the provider — the student's question is never silently consumed", async () => {
    const assertWithinBudget = jest.fn().mockRejectedValue(new ServiceUnavailableException("budget exceeded"));
    const { service, usageService, questionPacks } = makeService({ assertWithinBudget });
    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).rejects.toThrow(ServiceUnavailableException);
    expect(usageService.reserveDailySlot).not.toHaveBeenCalled();
    expect(questionPacks.consumeForTutor).not.toHaveBeenCalled();
  });

  it("allows students without an active subscription to use their one-time free trial", async () => {
    const { service, usageService } = makeService({ subscription: null });
    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).resolves.toMatchObject({ reply: "Here's a hint..." });
    expect(usageService.reserveDailySlot).not.toHaveBeenCalled();
  });

  it("allows an un subscribed student to use exactly two questions in one free lesson", async () => {
    const { service, prisma } = makeService({ subscription: null });

    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "first" })).resolves.toMatchObject({
      reply: "Here's a hint...",
    });
    prisma.client.freeTutorTrial.findUnique.mockResolvedValueOnce({ id: "trial-1", subjectId: "subject-1", questionsUsed: 1 });

    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "second" })).resolves.toMatchObject({
      reply: "Here's a hint...",
    });
    expect(prisma.client.freeTutorTrial.updateMany).toHaveBeenCalled();
  });

  it("rejects a free-trial student after two questions and prevents another subject", async () => {
    const { service, prisma } = makeService({
      subscription: null,
      freeTrial: { id: "trial-1", subjectId: "subject-1", questionsUsed: 2, completedAt: new Date() },
    });

    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "third" })).rejects.toThrow(ForbiddenException);
    await expect(service.sendMessage("user-1", { subjectId: "subject-2", message: "other lesson" })).rejects.toThrow(ForbiddenException);
    expect(prisma.client.freeTutorTrial.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when the daily reservation fails (limit already reached)", async () => {
    const { service } = makeService({ reserveResult: { reserved: false, limit: 10 } });
    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).rejects.toThrow(ForbiddenException);
  });

  it("releases the reserved slot when the AI provider call itself fails", async () => {
    const failingGenerate = jest.fn().mockRejectedValue(new Error("OpenAI network error"));
    const { service, releaseDailySlot } = makeService({ providerGenerate: failingGenerate });

    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).rejects.toThrow();
    expect(releaseDailySlot).toHaveBeenCalledWith("student-1", "subject-1");
  });

  describe("conversation context (regression: unrelated follow-up reusing the previous answer's structure)", () => {
    // The fix itself lives in the system prompt (AIContextBuilderService),
    // tested there. What's mechanically testable here, without a real
    // model call, is the prerequisite the fix depends on: that the FULL
    // prior conversation (both roles, in order) genuinely reaches the
    // provider for a follow-up — proving the app has real conversational
    // memory to reason over, and that nothing in the app code post-processes
    // or re-labels prior turns in a way that would bias the new answer's
    // structure (e.g. no injected "previous answer used these headings"
    // hint). Whether the MODEL then correctly chooses to anchor or not is a
    // live/manual verification concern (Case A-D in the task), not
    // something a deterministic unit test can assert about OpenAI's prose.
    it("passes the full prior conversation, in order, to the provider for a follow-up message", async () => {
      const priorMessages = [
        { role: "user", content: "What are the different types of soil?" },
        { role: "assistant", content: "Clay Soil, Sandy Soil, Silt Soil, Loamy Soil..." },
      ];
      const generate = jest.fn().mockResolvedValue({ content: "Flowers vary widely...", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" });
      const { service, prisma } = makeService({
        conversation: { id: "conv-1", studentId: "student-1" },
        providerGenerate: generate,
      });
      prisma.client.aIMessage.findMany.mockResolvedValue(priorMessages);

      await service.sendMessage("user-1", { subjectId: "subject-1", conversationId: "conv-1", message: "What kinds of flowers are there?" });

      const call = generate.mock.calls[0][0];
      expect(call.messages).toEqual([
        { role: "user", content: "What are the different types of soil?" },
        { role: "assistant", content: "Clay Soil, Sandy Soil, Silt Soil, Loamy Soil..." },
        { role: "user", content: "What kinds of flowers are there?" },
      ]);
    });

    it("does not inject any structural summary/label of the previous answer alongside the current message", async () => {
      // Guards against a naive fix that might have tried to solve this by
      // tagging history with something like "(ignore this structure)" —
      // the task requires a prompt-level instruction, not per-message
      // annotation. Prior turns must be passed exactly as stored.
      const priorMessages = [
        { role: "user", content: "Explain photosynthesis." },
        { role: "assistant", content: "Photosynthesis is..." },
      ];
      const generate = jest.fn().mockResolvedValue({ content: "Simpler version...", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" });
      const { service, prisma } = makeService({
        conversation: { id: "conv-1", studentId: "student-1" },
        providerGenerate: generate,
      });
      prisma.client.aIMessage.findMany.mockResolvedValue(priorMessages);

      await service.sendMessage("user-1", { subjectId: "subject-1", conversationId: "conv-1", message: "Can you explain that more simply?" });

      const call = generate.mock.calls[0][0];
      for (const m of call.messages) {
        expect(Object.keys(m).sort()).toEqual(["content", "role"]);
      }
    });

    it("starts with clean history (no prior turns sent) for a genuinely new conversation", async () => {
      const generate = jest.fn().mockResolvedValue({ content: "Planets vary...", inputTokens: 10, outputTokens: 10, model: "gpt-4o-mini" });
      const { service } = makeService({ providerGenerate: generate }); // no conversationId -> new conversation, aIMessage.findMany mocked to []

      await service.sendMessage("user-1", { subjectId: "subject-1", message: "What are the planets in the solar system?" });

      const call = generate.mock.calls[0][0];
      expect(call.messages).toEqual([{ role: "user", content: "What are the planets in the solar system?" }]);
    });
  });

  describe("provider failure modes — no entitlement bypass, no false success, no crash", () => {
    // sendMessage has exactly one catch-all release path (see its comment)
    // regardless of WHERE in the try block the failure came from — these
    // name each failure mode explicitly so a future regression that
    // special-cases one of them (e.g. swallowing a 401 as success) would
    // break a named, obvious test rather than surfacing only in production.
    it("releases the slot and propagates a useful error on provider 401/authentication failure", async () => {
      const authError = Object.assign(new Error("Incorrect API key provided"), { status: 401 });
      const { service, releaseDailySlot } = makeService({ providerGenerate: jest.fn().mockRejectedValue(authError) });
      await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).rejects.toThrow("Incorrect API key provided");
      expect(releaseDailySlot).toHaveBeenCalledWith("student-1", "subject-1");
    });

    it("releases the slot and propagates a useful error on provider 429/rate limit", async () => {
      const rateLimitError = Object.assign(new Error("Rate limit reached"), { status: 429 });
      const { service, releaseDailySlot } = makeService({ providerGenerate: jest.fn().mockRejectedValue(rateLimitError) });
      await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).rejects.toThrow("Rate limit reached");
      expect(releaseDailySlot).toHaveBeenCalledWith("student-1", "subject-1");
    });

    it("releases the slot and propagates a useful error on provider timeout", async () => {
      const timeoutError = Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT" });
      const { service, releaseDailySlot } = makeService({ providerGenerate: jest.fn().mockRejectedValue(timeoutError) });
      await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).rejects.toThrow("Request timed out");
      expect(releaseDailySlot).toHaveBeenCalledWith("student-1", "subject-1");
    });

    it("releases the slot when no AI provider is configured/available at all", async () => {
      const { service, releaseDailySlot } = makeService({ providerFactoryError: new ServiceUnavailableException("No active AI provider is configured.") });
      await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).rejects.toThrow("No active AI provider is configured.");
      expect(releaseDailySlot).toHaveBeenCalledWith("student-1", "subject-1");
    });

    it("does not crash on an empty/malformed provider response, and does not release the slot (real cost was still incurred)", async () => {
      const malformedGenerate = jest.fn().mockResolvedValue({ content: "", inputTokens: 0, outputTokens: 0, model: "gpt-4o-mini" });
      const { service, releaseDailySlot } = makeService({ providerGenerate: malformedGenerate });
      const result = await service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" });
      expect(result.reply).toBe("");
      expect(releaseDailySlot).not.toHaveBeenCalled();
    });

    it("rejects a second free-trial question that races past the two-question cap, without double-counting", async () => {
      // Simulates the atomic updateMany's WHERE guard losing a race: the
      // upsert sees an existing trial row, but by the time the guarded
      // updateMany runs, another concurrent request already consumed the
      // last slot — updateMany's count comes back 0, exactly like the
      // reserveDailySlot concurrency guard AIUsageService already has
      // dedicated coverage for.
      const { service, prisma } = makeService({ subscription: null, freeTrial: { id: "trial-1", subjectId: "subject-1", questionsUsed: 1 } });
      prisma.client.freeTutorTrial.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).rejects.toThrow(ForbiddenException);
      expect(prisma.client.aIConversation.create).not.toHaveBeenCalled();
    });
  });

  it("releases the reserved slot when a conversation-ownership check fails", async () => {
    const { service, releaseDailySlot } = makeService({ conversation: { id: "conv-x", studentId: "someone-elses-student-id" } });

    await expect(
      service.sendMessage("user-1", { subjectId: "subject-1", conversationId: "conv-x", message: "hi" }),
    ).rejects.toThrow(ForbiddenException);
    expect(releaseDailySlot).toHaveBeenCalledWith("student-1", "subject-1");
  });

  it("does NOT release the slot on a successful reply, even if the message-persist transaction fails", async () => {
    const { service, prisma, releaseDailySlot } = makeService();
    prisma.client.$transaction.mockRejectedValueOnce(new Error("DB write failed"));

    const result = await service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" });

    // The AI already generated a real (billable) reply — the slot must
    // stay consumed. Only the cost-ledger write failed, which is handled
    // by logUntrackedUsage(), not by releasing the rate-limit slot.
    expect(result.reply).toBe("Here's a hint...");
    expect(releaseDailySlot).not.toHaveBeenCalled();
  });

  it("logs untracked usage (rather than throwing to the caller) when the persist transaction fails after a successful AI reply", async () => {
    const { service, prisma, usageService } = makeService();
    prisma.client.$transaction.mockRejectedValueOnce(new Error("DB write failed"));

    await service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" });

    expect(usageService.logUntrackedUsage).toHaveBeenCalled();
  });

  describe("getRemainingToday — the single authoritative quota-state endpoint", () => {
    // Phase 10 hardening: this endpoint previously wasn't what the frontend
    // called at all (it called TutorQuestionPacksService's endpoint, which
    // has no concept of the free trial), producing a misleading "10 daily
    // questions left" display for an exhausted free-trial account. These
    // tests lock in the corrected, unified shape for every account state.
    it("reports an untouched free trial as 2 remaining, isFreeTrial true, not exhausted", async () => {
      const { service } = makeService({ subscription: null, freeTrial: null });
      await expect(service.getRemainingToday("user-1", "subject-1")).resolves.toMatchObject({
        isFreeTrial: true,
        freeTrialExhausted: false,
        totalRemaining: 2,
        dailyRemaining: 0,
        extraRemaining: 0,
      });
    });

    it("reports an exhausted free trial clearly (freeTrialExhausted true, totalRemaining 0)", async () => {
      const { service } = makeService({
        subscription: null,
        freeTrial: { id: "trial-1", subjectId: "subject-1", questionsUsed: 2, completedAt: new Date() },
      });
      await expect(service.getRemainingToday("user-1", "subject-1")).resolves.toMatchObject({
        isFreeTrial: true,
        freeTrialExhausted: true,
        totalRemaining: 0,
      });
    });

    it("reports a free trial bound to a different subject as exhausted for THIS subject", async () => {
      const { service } = makeService({
        subscription: null,
        freeTrial: { id: "trial-1", subjectId: "subject-2", questionsUsed: 0, completedAt: null },
      });
      await expect(service.getRemainingToday("user-1", "subject-1")).resolves.toMatchObject({
        isFreeTrial: true,
        freeTrialExhausted: true,
        totalRemaining: 0,
        trialSubjectId: "subject-2",
      });
    });

    it("delegates to TutorQuestionPacksService.getRemaining for an active subscriber, unchanged from its existing behavior", async () => {
      const { service, questionPacks } = makeService({ subscription: { status: "active" } });
      await expect(service.getRemainingToday("user-1", "subject-1")).resolves.toMatchObject({
        isFreeTrial: false,
        freeTrialExhausted: false,
        dailyRemaining: 9,
        extraRemaining: 3,
        totalRemaining: 12,
        packPriceEGP: 50,
        packSize: 10,
      });
      expect(questionPacks.getRemaining).toHaveBeenCalledWith("user-1", "subject-1");
    });
  });

  describe("getConversation — ownership isolation", () => {
    it("throws NotFoundException rather than returning another student's conversation", async () => {
      const { service, prisma } = makeService();
      prisma.client.aIConversation.findUnique = jest.fn().mockResolvedValue({
        id: "conv-1",
        studentId: "someone-elses-student-id",
        messages: [],
      });

      await expect(service.getConversation("user-1", "conv-1")).rejects.toThrow(NotFoundException);
    });

    it("returns the conversation when it genuinely belongs to the requesting student", async () => {
      const { service, prisma } = makeService();
      prisma.client.aIConversation.findUnique = jest.fn().mockResolvedValue({
        id: "conv-1",
        studentId: "student-1",
        messages: [],
      });

      await expect(service.getConversation("user-1", "conv-1")).resolves.toMatchObject({ id: "conv-1" });
    });
  });
});
