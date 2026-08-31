import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
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
    reserveResult?: { reserved: boolean; limit: number };
    providerGenerate?: jest.Mock;
    conversation?: any;
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
      getActiveProvider: jest.fn().mockResolvedValue({
        provider: { generate: overrides.providerGenerate ?? jest.fn().mockResolvedValue({ content: "Here's a hint...", inputTokens: 50, outputTokens: 30, model: "gpt-4o-mini" }) },
        providerKey: "openai",
        model: "gpt-4o-mini",
      }),
    } as any;

    const contextBuilder = { buildTutorSystemPrompt: jest.fn().mockReturnValue("system prompt") } as any;

    const usageService = {
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
    } as any;
    const answerCache = {
      find: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;
    return { service: new TutorService(prisma, providerFactory, contextBuilder, usageService, questionPacks, answerCache), prisma, usageService, releaseDailySlot };
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

  it("requires an active subscription — rejects when the student has none", async () => {
    const { service, usageService } = makeService({ subscription: null });
    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).rejects.toThrow(ForbiddenException);
    expect(usageService.reserveDailySlot).not.toHaveBeenCalled();
  });

  it("requires the subscription to be ACTIVE, not just present (e.g. rejects 'past_due')", async () => {
    const { service, usageService } = makeService({ subscription: { status: "past_due" } });
    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).rejects.toThrow(ForbiddenException);
    expect(usageService.reserveDailySlot).not.toHaveBeenCalled();
  });

  it("rejects when the daily reservation fails (limit already reached)", async () => {
    const { service, usageService } = makeService({ reserveResult: { reserved: false, limit: 10 } });
    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).rejects.toThrow(ForbiddenException);
  });

  it("releases the reserved slot when the AI provider call itself fails", async () => {
    const failingGenerate = jest.fn().mockRejectedValue(new Error("OpenAI network error"));
    const { service, releaseDailySlot } = makeService({ providerGenerate: failingGenerate });

    await expect(service.sendMessage("user-1", { subjectId: "subject-1", message: "hi" })).rejects.toThrow();
    expect(releaseDailySlot).toHaveBeenCalledWith("student-1", "subject-1");
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
