import { BadRequestException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";

const mockCreate = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ audio: { speech: { create: mockCreate } } })),
}));

let mockEnv: any = { OPENAI_API_KEY: "sk-test-fixture" };
jest.mock("@smartify/config", () => ({ loadBackendEnv: () => mockEnv }));

import { TutorSpeechService } from "./tutor-speech.service";

const CONVERSATION_ID = "conv-1";

function fakeAudioResponse(bytes = 10) {
  return { arrayBuffer: async () => new Uint8Array(bytes).fill(1).buffer };
}

function makePrisma(opts: { profile?: any; conversation?: any; matchingMessage?: any; ttsConfig?: unknown } = {}) {
  const usageCreate = jest.fn().mockResolvedValue({ id: "usage-1" });
  const profile = "profile" in opts ? opts.profile : { id: "student-1" };
  const conversation = "conversation" in opts ? opts.conversation : { id: CONVERSATION_ID, studentId: "student-1", subjectId: "subject-1" };
  // Default: a matching assistant reply exists for whatever text the test sends.
  const matchingMessage = "matchingMessage" in opts ? opts.matchingMessage : { id: "msg-1" };
  const prisma = {
    client: {
      studentProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
      aIConversation: { findUnique: jest.fn().mockResolvedValue(conversation) },
      aIMessage: { findFirst: jest.fn().mockResolvedValue(matchingMessage) },
      aIUsage: { create: usageCreate },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(opts.ttsConfig ? { key: "tts_config", value: opts.ttsConfig } : null) },
    },
  } as any;
  return { prisma, usageCreate };
}

function makeUsageService(
  assertWithinBudget = jest.fn().mockResolvedValue(undefined),
  reserveBudgetResult: { ok: true; reservationId: string } | { ok: false; reason: "misconfigured" | "global_exceeded" | "user_exceeded" } = {
    ok: true,
    reservationId: "reservation-1",
  },
) {
  return {
    assertWithinBudget,
    reserveBudget: jest.fn().mockResolvedValue(reserveBudgetResult),
    reconcileBudget: jest.fn().mockResolvedValue(undefined),
    releaseBudget: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe("TutorSpeechService", () => {
  beforeEach(() => {
    mockEnv = { OPENAI_API_KEY: "sk-test-fixture" };
    mockCreate.mockReset();
  });

  it("throws ServiceUnavailableException when OPENAI_API_KEY is missing, without calling OpenAI", async () => {
    mockEnv = { OPENAI_API_KEY: undefined };
    const { prisma } = makePrisma();
    const service = new TutorSpeechService(prisma, makeUsageService());
    await expect(service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello" })).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when the caller has no onboarded profile, without calling OpenAI", async () => {
    const { prisma } = makePrisma({ profile: null });
    const service = new TutorSpeechService(prisma, makeUsageService());
    await expect(service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello" })).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when the conversation does not belong to the caller, without calling OpenAI", async () => {
    const { prisma } = makePrisma({ conversation: { id: CONVERSATION_ID, studentId: "someone-else", subjectId: "subject-1" } });
    const service = new TutorSpeechService(prisma, makeUsageService());
    await expect(service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello" })).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when the conversation does not exist, without calling OpenAI", async () => {
    const { prisma } = makePrisma({ conversation: null });
    const service = new TutorSpeechService(prisma, makeUsageService());
    await expect(service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello" })).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects text that does not match any assistant reply in the conversation, without calling OpenAI — this is what stops /tutor/speech from being an arbitrary text-to-speech proxy", async () => {
    const { prisma } = makePrisma({ matchingMessage: null });
    const service = new TutorSpeechService(prisma, makeUsageService());
    await expect(
      service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "anything the client wants read aloud" }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects when the global/per-user AI budget is exceeded, without calling OpenAI", async () => {
    const { prisma } = makePrisma();
    const usageService = makeUsageService(jest.fn().mockRejectedValue(new ServiceUnavailableException("budget exceeded")));
    const service = new TutorSpeechService(prisma, usageService);
    await expect(service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello" })).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("checks the budget for the calling user before generating audio", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse());
    const { prisma } = makePrisma();
    const assertWithinBudget = jest.fn().mockResolvedValue(undefined);
    const service = new TutorSpeechService(prisma, makeUsageService(assertWithinBudget));
    await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello" });
    expect(assertWithinBudget).toHaveBeenCalledWith("user-1");
  });

  it("Phase 9.4C: rejects when the atomic budget RESERVATION is refused (even though the cheap early assertWithinBudget check passed), without calling OpenAI", async () => {
    const { prisma } = makePrisma();
    const usageService = makeUsageService(jest.fn().mockResolvedValue(undefined), { ok: false, reason: "user_exceeded" });
    const service = new TutorSpeechService(prisma, usageService);
    await expect(service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello" })).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("Phase 9.4C: releases the budget reservation when the OpenAI call itself fails, and never reconciles it", async () => {
    mockCreate.mockRejectedValue(new Error("OpenAI down"));
    const { prisma } = makePrisma();
    const usageService = makeUsageService();
    const service = new TutorSpeechService(prisma, usageService);
    await expect(service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello" })).rejects.toThrow("OpenAI down");
    expect(usageService.releaseBudget).toHaveBeenCalledWith("reservation-1");
    expect(usageService.reconcileBudget).not.toHaveBeenCalled();
  });

  it("Phase 9.4C: reconciles the budget reservation to the real billed cost after a successful synthesis", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse());
    const { prisma } = makePrisma();
    const usageService = makeUsageService();
    const service = new TutorSpeechService(prisma, usageService);
    await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello" });
    expect(usageService.reconcileBudget).toHaveBeenCalledWith("reservation-1", expect.any(Number));
  });

  it("rejects empty/whitespace-only text before calling OpenAI", async () => {
    const { prisma } = makePrisma({ matchingMessage: { id: "msg-1", content: "   " } });
    const service = new TutorSpeechService(prisma, makeUsageService());
    await expect(service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "   " })).rejects.toThrow(
      BadRequestException,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects text over the length cap before calling OpenAI", async () => {
    const longText = "a".repeat(5000);
    const { prisma } = makePrisma({ matchingMessage: { id: "msg-1", content: longText } });
    const service = new TutorSpeechService(prisma, makeUsageService());
    await expect(service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: longText })).rejects.toThrow(
      BadRequestException,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("strips markdown before sending text to OpenAI, and returns the generated audio bytes", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse(42));
    const text = "1. **Soil type:** clay.";
    const { prisma } = makePrisma({ matchingMessage: { id: "msg-1", content: text } });
    const service = new TutorSpeechService(prisma, makeUsageService());

    const result = await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ input: "Soil type: clay." }));
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(42);
  });

  it("applies Arabic tashkeel preparation for Arabic text before sending it to OpenAI, without altering non-Arabic text", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse());
    const text = "لو عندك 4 + 3، الناتج 7.";
    const { prisma } = makePrisma({ matchingMessage: { id: "msg-1", content: text } });
    const service = new TutorSpeechService(prisma, makeUsageService());

    await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text });

    const sentInput = mockCreate.mock.calls[0][0].input as string;
    expect(sentInput).toContain("زائِد");
    expect(sentInput).toContain("أَرْبَعة");
    expect(sentInput).not.toContain("+");
  });

  it("Phase 9.4B: passes the approved Smartify speaking instructions to OpenAI for pacing/style control on the default model (gpt-4o-mini-tts doesn't support `speed`)", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse());
    const { prisma } = makePrisma({ matchingMessage: { id: "msg-1", content: "Hello there." } });
    const service = new TutorSpeechService(prisma, makeUsageService());
    await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ instructions: expect.any(String) }));
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("speed");
  });

  it("still passes a speed parameter for a model that supports it (e.g. tts-1/tts-1-hd, configured via SystemConfig)", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse());
    const { prisma } = makePrisma({
      matchingMessage: { id: "msg-1", content: "Hello there." },
      ttsConfig: { provider: "openai", model: "tts-1-hd", voice: "nova", speed: 0.94 },
    });
    const service = new TutorSpeechService(prisma, makeUsageService());
    await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ speed: expect.any(Number) }));
  });

  it("uses a custom provider/model/voice/speed from the admin-editable TTS config (SystemConfig), without any code change", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse());
    const { prisma } = makePrisma({
      matchingMessage: { id: "msg-1", content: "Hello there." },
      ttsConfig: { provider: "openai", model: "tts-1", voice: "shimmer", speed: 1.2 },
    });
    const service = new TutorSpeechService(prisma, makeUsageService());
    await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "tts-1", voice: "shimmer", speed: 1.2 }));
  });

  it("falls back to default config safely when the SystemConfig row is malformed, rather than breaking voice playback", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse());
    const { prisma } = makePrisma({
      matchingMessage: { id: "msg-1", content: "Hello there." },
      ttsConfig: { speed: "not-a-number", voice: 12345 },
    });
    const service = new TutorSpeechService(prisma, makeUsageService());
    const result = await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." });
    expect(Buffer.isBuffer(result)).toBe(true);
    // Phase 9.4B default: gpt-4o-mini-tts/marin — doesn't send `speed` (unsupported by this model).
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini-tts", voice: "marin" }));
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("speed");
  });

  it("uses the gpt-4o-mini-tts model (owner-approved MVP default) and the openai provider for cost tracking", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse());
    const { prisma } = makePrisma({ matchingMessage: { id: "msg-1", content: "Hello there." } });
    const service = new TutorSpeechService(prisma, makeUsageService());
    await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini-tts" }));
  });

  it("logs a tutor_tts usage row with zero creditsUsed (does not consume a Tutor question), cost proportional to characters, and subjectId derived from the conversation", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse());
    const { prisma, usageCreate } = makePrisma({
      profile: { id: "student-9" },
      conversation: { id: CONVERSATION_ID, studentId: "student-9", subjectId: "subject-1" },
      matchingMessage: { id: "msg-1", content: "Hello there." },
    });
    const service = new TutorSpeechService(prisma, makeUsageService());

    await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." });

    expect(usageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        studentId: "student-9",
        subjectId: "subject-1",
        feature: "tutor_tts",
        provider: "openai",
        model: "gpt-4o-mini-tts",
        creditsUsed: 0,
      }),
    });
    const loggedRow = usageCreate.mock.calls[0][0].data;
    expect(loggedRow.costUsd).toBeGreaterThan(0);
    expect(loggedRow.inputTokens).toBe("Hello there.".length);
  });

  it("still returns audio even if the usage-ledger write fails", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse(5));
    const { prisma, usageCreate } = makePrisma({ matchingMessage: { id: "msg-1", content: "Hello." } });
    usageCreate.mockRejectedValue(new Error("db down"));
    const service = new TutorSpeechService(prisma, makeUsageService());

    const result = await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello." });
    expect(result.length).toBe(5);
  });
});
