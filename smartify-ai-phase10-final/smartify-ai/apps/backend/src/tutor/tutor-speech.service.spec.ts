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

/** Mock TtsAudioCacheService — real R2 behavior is covered by tts-audio-cache.service.spec.ts; these tests only need get/put call-shape control. */
function makeAudioCache(opts: { get?: jest.Mock; put?: jest.Mock } = {}) {
  return {
    get: opts.get ?? jest.fn().mockResolvedValue(null),
    put: opts.put ?? jest.fn().mockResolvedValue(undefined),
  } as any;
}

const LESSON_CONVERSATION = { id: CONVERSATION_ID, studentId: "student-1", subjectId: "subject-1", lessonSession: { id: "session-1" } };
const TUTOR_CONVERSATION = { id: CONVERSATION_ID, studentId: "student-1", subjectId: "subject-1", lessonSession: null };

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

  it("uses the English speaking instructions (not the default Egyptian-Arabic ones) for non-Arabic-script text — a British-curriculum lesson must not be narrated with Arabic voice direction", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse());
    const { prisma } = makePrisma({ matchingMessage: { id: "msg-1", content: "Fractions show parts of a whole." } });
    const service = new TutorSpeechService(prisma, makeUsageService());
    await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Fractions show parts of a whole." });
    const sentInstructions = mockCreate.mock.calls[0][0].instructions as string;
    expect(sentInstructions).toMatch(/warm, natural English/);
    expect(sentInstructions).not.toMatch(/Egyptian Arabic/);
  });

  it("keeps the default (admin-configurable) Egyptian-Arabic instructions for Arabic-script text", async () => {
    mockCreate.mockResolvedValue(fakeAudioResponse());
    const { prisma } = makePrisma({ matchingMessage: { id: "msg-1", content: "أربعة زائد أربعة يساوي ثمانية." } });
    const service = new TutorSpeechService(prisma, makeUsageService());
    await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "أربعة زائد أربعة يساوي ثمانية." });
    const sentInstructions = mockCreate.mock.calls[0][0].instructions as string;
    expect(sentInstructions).toMatch(/Egyptian Arabic/);
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

/**
 * Lesson TTS server-side cache, V1 (2026-09-20) — Lesson-originated
 * conversations only (conversation.lessonSession != null); Tutor-chat TTS
 * stays fully uncached in this phase. The cache is strictly an
 * optimization AFTER the exact same security gate covered above — every
 * test in the "security" block below asserts the cache is never even
 * queried until authentication/ownership/exact-text all pass.
 */
describe("TutorSpeechService — Lesson TTS server-side cache", () => {
  beforeEach(() => {
    mockEnv = { OPENAI_API_KEY: "sk-test-fixture" };
    mockCreate.mockReset();
  });

  describe("security ordering (cache must never run before authorization)", () => {
    it("A: unauthorized conversation (wrong owner) is rejected before any cache lookup, even for a Lesson conversation", async () => {
      const { prisma } = makePrisma({ conversation: { ...LESSON_CONVERSATION, studentId: "someone-else" } });
      const audioCache = makeAudioCache();
      const service = new TutorSpeechService(prisma, makeUsageService(), undefined, audioCache);

      await expect(service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello" })).rejects.toThrow(ForbiddenException);
      expect(audioCache.get).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("B: text that does not exactly match a persisted assistant AIMessage is rejected before any cache lookup, even for a Lesson conversation", async () => {
      const { prisma } = makePrisma({ conversation: LESSON_CONVERSATION, matchingMessage: null });
      const audioCache = makeAudioCache();
      const service = new TutorSpeechService(prisma, makeUsageService(), undefined, audioCache);

      await expect(
        service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "text the client made up" }),
      ).rejects.toThrow(ForbiddenException);
      expect(audioCache.get).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("C: knowing/guessing what the cache key WOULD be cannot bypass ownership — a different student requesting the identical text still fails their own ownership check first", async () => {
      // Student "someone-else" does not own this conversation, even though
      // the text itself is real content that exists (and might even already
      // be cached under its content-addressed key) — that never matters,
      // because the conversation lookup rejects them before text/cache logic runs.
      const { prisma } = makePrisma({ conversation: { ...LESSON_CONVERSATION, studentId: "the-real-owner" } });
      const audioCache = makeAudioCache({ get: jest.fn().mockResolvedValue(Buffer.from("some real cached audio")) });
      const service = new TutorSpeechService(prisma, makeUsageService(), undefined, audioCache);

      await expect(
        service.synthesize({ userId: "someone-else-users-id", conversationId: CONVERSATION_ID, text: "Hello" }),
      ).rejects.toThrow(ForbiddenException);
      expect(audioCache.get).not.toHaveBeenCalled();
    });

    it("D: the cache service is never queried when the caller has no onboarded profile at all", async () => {
      const { prisma } = makePrisma({ profile: null, conversation: LESSON_CONVERSATION });
      const audioCache = makeAudioCache();
      const service = new TutorSpeechService(prisma, makeUsageService(), undefined, audioCache);

      await expect(service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello" })).rejects.toThrow(ForbiddenException);
      expect(audioCache.get).not.toHaveBeenCalled();
    });
  });

  describe("cache MISS (first request)", () => {
    it("does the full existing pipeline — cache get, provider synthesize, budget reservation, reconciliation, AIUsage, cache put — and returns the fresh audio", async () => {
      mockCreate.mockResolvedValue(fakeAudioResponse(7));
      const { prisma, usageCreate } = makePrisma({ conversation: LESSON_CONVERSATION, matchingMessage: { id: "msg-1", content: "Hello there." } });
      const usageService = makeUsageService();
      const audioCache = makeAudioCache(); // get() -> null (miss) by default
      const service = new TutorSpeechService(prisma, usageService, undefined, audioCache);

      const result = await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." });

      expect(audioCache.get).toHaveBeenCalledTimes(1);
      expect(usageService.assertWithinBudget).toHaveBeenCalledWith("user-1");
      expect(usageService.reserveBudget).toHaveBeenCalledWith("user-1", expect.any(Number));
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(usageService.reconcileBudget).toHaveBeenCalledWith("reservation-1", expect.any(Number));
      expect(usageCreate).toHaveBeenCalledTimes(1);
      expect(audioCache.put).toHaveBeenCalledTimes(1);
      expect(audioCache.put.mock.calls[0][0]).toBe(audioCache.get.mock.calls[0][0]); // same key for get and put
      expect(result.length).toBe(7);
    });
  });

  describe("cache HIT (second identical request)", () => {
    it("returns cached audio with ZERO provider call, ZERO budget reservation, and ZERO AIUsage row", async () => {
      const cachedAudio = Buffer.from("previously cached mp3 bytes");
      const { prisma, usageCreate } = makePrisma({ conversation: LESSON_CONVERSATION, matchingMessage: { id: "msg-1", content: "Hello there." } });
      const usageService = makeUsageService();
      const audioCache = makeAudioCache({ get: jest.fn().mockResolvedValue(cachedAudio) });
      const service = new TutorSpeechService(prisma, usageService, undefined, audioCache);

      const result = await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." });

      expect(result).toBe(cachedAudio);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(usageService.assertWithinBudget).not.toHaveBeenCalled();
      expect(usageService.reserveBudget).not.toHaveBeenCalled();
      expect(usageService.reconcileBudget).not.toHaveBeenCalled();
      expect(usageCreate).not.toHaveBeenCalled();
      expect(audioCache.put).not.toHaveBeenCalled(); // already cached — nothing new to write
    });
  });

  describe("cache key dimensions", () => {
    async function keyFor(overrides: { text?: string; ttsConfig?: unknown }) {
      const text = overrides.text ?? "Hello there.";
      const { prisma } = makePrisma({ conversation: LESSON_CONVERSATION, matchingMessage: { id: "msg-1", content: text }, ttsConfig: overrides.ttsConfig });
      const audioCache = makeAudioCache();
      const service = new TutorSpeechService(prisma, makeUsageService(), undefined, audioCache);
      mockCreate.mockResolvedValue(fakeAudioResponse());
      await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text });
      return audioCache.get.mock.calls[0][0] as string;
    }

    it("changed spoken text produces a different key", async () => {
      const keyA = await keyFor({ text: "Hello there." });
      const keyB = await keyFor({ text: "Hello there!" });
      expect(keyA).not.toBe(keyB);
    });

    it("changed model produces a different key", async () => {
      const keyA = await keyFor({ ttsConfig: { provider: "openai", model: "gpt-4o-mini-tts", voice: "marin", speed: 0.94 } });
      const keyB = await keyFor({ ttsConfig: { provider: "openai", model: "tts-1-hd", voice: "marin", speed: 0.94 } });
      expect(keyA).not.toBe(keyB);
    });

    it("changed voice produces a different key", async () => {
      const keyA = await keyFor({ ttsConfig: { provider: "openai", model: "tts-1", voice: "marin", speed: 1 } });
      const keyB = await keyFor({ ttsConfig: { provider: "openai", model: "tts-1", voice: "nova", speed: 1 } });
      expect(keyA).not.toBe(keyB);
    });

    it("changed speed produces a different key", async () => {
      const keyA = await keyFor({ ttsConfig: { provider: "openai", model: "tts-1", voice: "nova", speed: 0.9 } });
      const keyB = await keyFor({ ttsConfig: { provider: "openai", model: "tts-1", voice: "nova", speed: 1.2 } });
      expect(keyA).not.toBe(keyB);
    });

    it("changed effective instructions (English vs Arabic content) produces a different key", async () => {
      const keyEnglish = await keyFor({ text: "Fractions show parts of a whole." });
      const keyArabic = await keyFor({ text: "أربعة زائد أربعة يساوي ثمانية." });
      expect(keyEnglish).not.toBe(keyArabic);
    });

    it("UI locale (student's preferredLang) does NOT affect the key — only the profile lookup differs, everything else about the request is identical", async () => {
      const text = "Hello there.";
      const { prisma: prismaEn } = makePrisma({ profile: { id: "student-1", preferredLang: "en" }, conversation: LESSON_CONVERSATION, matchingMessage: { id: "msg-1", content: text } });
      const { prisma: prismaAr } = makePrisma({ profile: { id: "student-1", preferredLang: "ar" }, conversation: LESSON_CONVERSATION, matchingMessage: { id: "msg-1", content: text } });
      mockCreate.mockResolvedValue(fakeAudioResponse());

      const cacheEn = makeAudioCache();
      await new TutorSpeechService(prismaEn, makeUsageService(), undefined, cacheEn).synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text });
      const cacheAr = makeAudioCache();
      await new TutorSpeechService(prismaAr, makeUsageService(), undefined, cacheAr).synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text });

      expect(cacheEn.get.mock.calls[0][0]).toBe(cacheAr.get.mock.calls[0][0]);
    });
  });

  describe("cross-student Lesson sharing (intentional)", () => {
    it("Student A's cache MISS + Student B's independently-authorized identical text = Student B's cache HIT, using the SAME key, with zero provider call for B", async () => {
      const text = "Fractions show parts of a whole.";
      mockCreate.mockResolvedValue(fakeAudioResponse(9));

      // Student A: MISS — synthesizes and (would) write to cache.
      const { prisma: prismaA, usageCreate: usageCreateA } = makePrisma({
        profile: { id: "student-A" },
        conversation: { id: "conv-a", studentId: "student-A", subjectId: "subject-1", lessonSession: { id: "session-a" } },
        matchingMessage: { id: "msg-a", content: text },
      });
      const audioCacheA = makeAudioCache(); // get() -> null
      const serviceA = new TutorSpeechService(prismaA, makeUsageService(), undefined, audioCacheA);
      const resultA = await serviceA.synthesize({ userId: "user-A", conversationId: "conv-a", text });
      const keyUsedByA = audioCacheA.get.mock.calls[0][0] as string;
      expect(audioCacheA.put.mock.calls[0][0]).toBe(keyUsedByA);
      expect(usageCreateA).toHaveBeenCalledTimes(1);

      // Student B: owns a COMPLETELY DIFFERENT Lesson conversation, but was
      // independently, legitimately given the exact same text by their own
      // Lesson session (identical shared lesson content) — passes B's own
      // ownership/exact-text checks, then HITS the shared cache.
      mockCreate.mockClear();
      const { prisma: prismaB, usageCreate: usageCreateB } = makePrisma({
        profile: { id: "student-B" },
        conversation: { id: "conv-b", studentId: "student-B", subjectId: "subject-1", lessonSession: { id: "session-b" } },
        matchingMessage: { id: "msg-b", content: text },
      });
      const audioCacheB = makeAudioCache({ get: jest.fn().mockResolvedValue(resultA) }); // simulates the real R2 object A just wrote
      const usageServiceB = makeUsageService();
      const serviceB = new TutorSpeechService(prismaB, usageServiceB, undefined, audioCacheB);
      const resultB = await serviceB.synthesize({ userId: "user-B", conversationId: "conv-b", text });

      expect(audioCacheB.get.mock.calls[0][0]).toBe(keyUsedByA); // same content -> same key, independent of student/conversation
      expect(resultB).toBe(resultA);
      expect(mockCreate).not.toHaveBeenCalled(); // zero provider call for B
      expect(usageServiceB.reserveBudget).not.toHaveBeenCalled();
      expect(usageCreateB).not.toHaveBeenCalled();
    });

    it("Student B cannot retrieve it unless Student B independently passes authorization for that exact text in Student B's OWN conversation", async () => {
      const { prisma } = makePrisma({
        profile: { id: "student-B" },
        conversation: { id: "conv-b", studentId: "student-B", subjectId: "subject-1", lessonSession: { id: "session-b" } },
        matchingMessage: null, // B's conversation never actually received this exact text
      });
      const audioCache = makeAudioCache({ get: jest.fn().mockResolvedValue(Buffer.from("audio that exists in the shared cache")) });
      const service = new TutorSpeechService(prisma, makeUsageService(), undefined, audioCache);

      await expect(
        service.synthesize({ userId: "user-B", conversationId: "conv-b", text: "text B never actually received" }),
      ).rejects.toThrow(ForbiddenException);
      expect(audioCache.get).not.toHaveBeenCalled(); // never even reached, regardless of what's in the shared cache
    });
  });

  describe("Tutor conversations remain completely uncached", () => {
    it("two identical requests on a Tutor (non-Lesson) conversation both go through the existing uncached path — cache is never queried or written", async () => {
      mockCreate.mockResolvedValue(fakeAudioResponse());
      const { prisma, usageCreate } = makePrisma({ conversation: TUTOR_CONVERSATION, matchingMessage: { id: "msg-1", content: "Hello there." } });
      const usageService = makeUsageService();
      const audioCache = makeAudioCache();
      const service = new TutorSpeechService(prisma, usageService, undefined, audioCache);

      await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." });
      await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." });

      expect(audioCache.get).not.toHaveBeenCalled();
      expect(audioCache.put).not.toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledTimes(2); // real, unchanged, uncached behavior — every call re-synthesizes
      expect(usageService.reserveBudget).toHaveBeenCalledTimes(2);
      expect(usageCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe("cache failure handling", () => {
    it("a cache READ failure degrades to a miss — synthesis still succeeds normally, nothing leaks to the student", async () => {
      mockCreate.mockResolvedValue(fakeAudioResponse(11));
      const { prisma, usageCreate } = makePrisma({ conversation: LESSON_CONVERSATION, matchingMessage: { id: "msg-1", content: "Hello there." } });
      const audioCache = makeAudioCache({ get: jest.fn().mockRejectedValue(new Error("R2 network error")) });
      const service = new TutorSpeechService(prisma, makeUsageService(), undefined, audioCache);

      const result = await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." });

      expect(result.length).toBe(11);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(usageCreate).toHaveBeenCalledTimes(1);
    });

    it("a cache WRITE failure after a successful synthesis does not fail the request — audio is still returned and the real cost is still reconciled", async () => {
      mockCreate.mockResolvedValue(fakeAudioResponse(13));
      const { prisma, usageCreate } = makePrisma({ conversation: LESSON_CONVERSATION, matchingMessage: { id: "msg-1", content: "Hello there." } });
      const usageService = makeUsageService();
      const audioCache = makeAudioCache({ put: jest.fn().mockRejectedValue(new Error("R2 write failed")) });
      const service = new TutorSpeechService(prisma, usageService, undefined, audioCache);

      const result = await service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." });

      expect(result.length).toBe(13);
      expect(usageService.reconcileBudget).toHaveBeenCalledWith("reservation-1", expect.any(Number));
      expect(usageCreate).toHaveBeenCalledTimes(1);
    });

    it("a provider failure on a Lesson cache MISS releases the budget reservation and never writes to the cache", async () => {
      mockCreate.mockRejectedValue(new Error("OpenAI down"));
      const { prisma } = makePrisma({ conversation: LESSON_CONVERSATION, matchingMessage: { id: "msg-1", content: "Hello there." } });
      const usageService = makeUsageService();
      const audioCache = makeAudioCache();
      const service = new TutorSpeechService(prisma, usageService, undefined, audioCache);

      await expect(service.synthesize({ userId: "user-1", conversationId: CONVERSATION_ID, text: "Hello there." })).rejects.toThrow("OpenAI down");

      expect(usageService.releaseBudget).toHaveBeenCalledWith("reservation-1");
      expect(usageService.reconcileBudget).not.toHaveBeenCalled();
      expect(audioCache.put).not.toHaveBeenCalled();
    });
  });
});
