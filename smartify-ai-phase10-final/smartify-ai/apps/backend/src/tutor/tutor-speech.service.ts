import { BadRequestException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { stripMarkdownForSpeech } from "./speech-text.util";
import { containsArabicScript, prepareArabicSpeechText } from "./arabic-speech-preparation.util";
import { TtsProviderFactory } from "./tts/tts-provider.factory";
import { SMARTIFY_TTS_INSTRUCTIONS, SMARTIFY_TTS_INSTRUCTIONS_EN } from "./tts/tts-config.util";
import { TtsAudioCacheService, computeLessonTtsCacheKey } from "./tts/tts-audio-cache.service";
import type { TtsProvider } from "./tts/tts-provider.interface";

const MAX_INPUT_CHARS = 4000; // generous for a tutor reply; bounds cost/abuse per call

@Injectable()
export class TutorSpeechService {
  private readonly logger = new Logger(TutorSpeechService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageService: AIUsageService,
    // Defaulted (not required) so this remains constructible exactly as
    // before wherever it's built directly rather than through Nest's DI —
    // in production Nest still injects one shared TtsProviderFactory.
    private readonly ttsProviderFactory: TtsProviderFactory = new TtsProviderFactory(prisma),
    private readonly audioCache: TtsAudioCacheService = new TtsAudioCacheService(),
  ) {}

  /**
   * Synthesizes speech for an already-generated Tutor reply OR Lesson
   * teaching turn. This is deliberately NOT gated by Free Trial/
   * subscription quota — the question was already paid for (in trial-
   * question or usage terms) when /tutor/message or the Lesson engine
   * produced this text; reading it aloud, or replaying it, is not a
   * second question. Logs its own AIUsage row (feature: "tutor_tts") so
   * real cost is tracked separately from "tutor_chat"/"lesson_chat" — on
   * a real synthesis. A Lesson-originated CACHE HIT (2026-09-20, see
   * below) logs nothing at all, since nothing was spent.
   *
   * Security: `text` is never trusted as arbitrary client input. The
   * caller must identify an existing conversation they own, and the text
   * must exactly match one of that conversation's own assistant replies —
   * otherwise this endpoint would be an unrestricted "turn any text into
   * speech using my OpenAI key" proxy for any authenticated user. This is
   * the only check that ties speech generation back to real, already-paid
   * content rather than to the caller's identity alone. The cache below
   * is strictly an optimization AFTER this check passes — it is never
   * itself a source of authorization, and is never consulted before it.
   *
   * Which engine actually renders the audio (OpenAI today, potentially a
   * premium Arabic/Egyptian voice provider later) is entirely decided by
   * TtsProviderFactory — this method, the Interactive Lesson engine, and
   * the frontend never know or care which one produced the bytes. The
   * same is true of whether the bytes came from a fresh synthesis or the
   * shared Lesson cache — the response contract (raw audio/mpeg Buffer)
   * is identical either way, so the frontend needs no changes.
   */
  async synthesize(input: { userId: string; conversationId: string; text: string }): Promise<Buffer> {
    // Resolves (and, for OpenAI, validates OPENAI_API_KEY) before any DB
    // work — an unconfigured/misconfigured TTS setup fails the same way it
    // always has: fast, before touching the database. Unchanged position —
    // a Lesson cache HIT still resolves this today (a known, minor V1
    // limitation: a hit currently still requires OPENAI_API_KEY to be
    // configured, even though it wouldn't otherwise need it — see this
    // task's final report for why that tradeoff was accepted rather than
    // restructuring this further).
    const provider = await this.ttsProviderFactory.getActiveProvider();

    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId: input.userId } });
    if (!profile) {
      throw new ForbiddenException("Complete onboarding before using Tutor voice playback.");
    }

    // lessonSession is included ONLY to classify the conversation's origin
    // for cache-scope purposes below (§ CACHE) — this is an additive read
    // of the SAME row already being fetched for the ownership check;
    // nothing about the ownership check itself changes.
    const conversation = await this.prisma.client.aIConversation.findUnique({
      where: { id: input.conversationId },
      include: { lessonSession: { select: { id: true } } },
    });
    if (!conversation || conversation.studentId !== profile.id) {
      throw new ForbiddenException("This conversation does not belong to you.");
    }

    const requestedText = (input.text ?? "").trim();
    const matchingReply = await this.prisma.client.aIMessage.findFirst({
      where: { conversationId: conversation.id, role: "assistant", content: requestedText },
    });
    if (!matchingReply) {
      throw new ForbiddenException("This text does not match a Tutor reply from this conversation.");
    }

    // ---- Everything above this line is the unchanged security gate:
    // authentication (guard) -> ownership -> exact-text match. Nothing
    // below this point ever runs before all three have passed, and the
    // cache (below) is never consulted before this point either. ----

    // displayText (requestedText, verified above against the real stored
    // reply) is never altered. speechText is a separate, purely-derived
    // string used ONLY for this TTS call — markdown-stripped, then (Arabic
    // only) passed through a small deterministic tashkeel layer for known
    // pronunciation trouble spots (symbols, small numbers, a short list of
    // domain terms). Both steps are pure functions of requestedText, so the
    // frontend's existing per-turn audio cache (keyed off the unchanged
    // displayText) stays correct with no extra invalidation logic needed.
    const displayStripped = stripMarkdownForSpeech(requestedText).trim();
    const isArabic = containsArabicScript(displayStripped);
    const spoken = isArabic ? prepareArabicSpeechText(displayStripped) : displayStripped;
    if (!spoken) {
      throw new BadRequestException("Nothing to read aloud.");
    }
    if (spoken.length > MAX_INPUT_CHARS) {
      throw new BadRequestException(`Text is too long to synthesize (max ${MAX_INPUT_CHARS} characters).`);
    }

    // ---- CACHE (2026-09-20, Lesson-originated only — see module doc) ----
    // A conversation with a real LessonSession row was created exclusively
    // by InteractiveLessonService.advance() — an already-existing, unique
    // 1:1 relation, so this needs no schema change and no ambiguity.
    // Tutor-originated conversations (lessonSession null) always fall
    // through to the exact pre-existing, fully uncached path below,
    // unchanged in every respect (budget/AIUsage behavior identical to
    // before this task).
    if (conversation.lessonSession) {
      // getConfig() (not getActiveProvider()) — cheap, DB-only, no
      // provider/API-key involved — resolves the SAME TtsConfig
      // getActiveProvider() already derived provider.model from, just
      // exposing the voice/speed/instructions fields that provider itself
      // deliberately keeps private (see OpenAiTtsProvider) without
      // touching that class's visibility for this one call site.
      const config = await this.ttsProviderFactory.getConfig();
      // Mirrors the exact instructionsOverride rule used for the real
      // synthesize() call below — content language is ground truth, never
      // the student's UI-language setting (see that call site's own
      // comment). Whatever is ACTUALLY used for a given call is what gets
      // hashed, so an admin editing the Arabic instructions in SystemConfig
      // naturally produces a new key for Arabic content, while English
      // content (always the hardcoded EN constant) is unaffected by that
      // same edit — exactly matching real synthesis behavior.
      // normalizeTtsConfig() always fills `instructions` with a real
      // string at runtime (falling back to SMARTIFY_TTS_INSTRUCTIONS) —
      // the `??` here only satisfies TtsConfig's optional-field type, it
      // is not expected to ever actually apply.
      const effectiveInstructions = isArabic ? (config.instructions ?? SMARTIFY_TTS_INSTRUCTIONS) : SMARTIFY_TTS_INSTRUCTIONS_EN;
      const cacheKey = computeLessonTtsCacheKey({ spokenText: spoken, model: config.model, voice: config.voice, speed: config.speed, instructions: effectiveInstructions });

      let cached: Buffer | null = null;
      try {
        cached = await this.audioCache.get(cacheKey);
      } catch (err) {
        // Cache READ failure degrades to a miss — never exposed to the
        // student, never blocks voice playback.
        this.logger.warn(`Lesson TTS cache read failed (treating as miss): ${err instanceof Error ? err.message : String(err)}`);
      }
      if (cached) {
        // HIT: zero provider call, zero budget reservation, zero AIUsage
        // row — no real spend occurred, so there is nothing to charge or
        // log, matching how an already-generated Topic's own cache hit
        // (LessonDraftGeneratorService.ensureTopicHasLesson) also skips
        // budget/usage entirely.
        return cached;
      }

      const audio = await this.synthesizeAndAccount({ userId: input.userId, profile, conversation, provider, spoken, isArabic });
      try {
        await this.audioCache.put(cacheKey, audio);
      } catch (err) {
        // Cache WRITE failure must never make an otherwise-valid, already-
        // paid-for synthesis unusable — log and still return the audio.
        this.logger.warn(`Lesson TTS cache write failed (audio still returned to the student): ${err instanceof Error ? err.message : String(err)}`);
      }
      return audio;
    }

    // Tutor-originated — the exact pre-existing uncached path.
    return this.synthesizeAndAccount({ userId: input.userId, profile, conversation, provider, spoken, isArabic });
  }

  /**
   * The pre-existing synthesis + budget + AIUsage logic, extracted
   * verbatim (2026-09-20) so the Lesson-cache-MISS path and the always-
   * uncached Tutor path share the exact same code, never two copies that
   * could quietly drift apart. Behavior is byte-for-byte identical to
   * before this task.
   */
  private async synthesizeAndAccount(args: {
    userId: string;
    profile: { id: string };
    conversation: { subjectId: string | null };
    provider: TtsProvider;
    spoken: string;
    isArabic: boolean;
  }): Promise<Buffer> {
    const { userId, profile, conversation, provider, spoken, isArabic } = args;

    await this.usageService.assertWithinBudget(userId);

    // Phase 9.4C: atomic USD reservation immediately before the provider
    // call. TTS cost is deterministic (billedUnits === spoken.length,
    // confirmed in openai-tts.provider.ts), so the "estimate" here is
    // exactly the real cost, not a worst-case ceiling like the chat path
    // — reconciliation below should always land at delta=0 in practice,
    // but goes through the same path for consistency and defense in
    // depth. Skipped entirely when cost is genuinely zero (e.g. a
    // zero-cost provider stub) — nothing to protect against there.
    const estimatedUsd = spoken.length * provider.costPerUnitUsd;
    let budgetReservationId: string | null = null;
    if (estimatedUsd > 0) {
      const reserveResult = await this.usageService.reserveBudget(userId, estimatedUsd);
      if (!reserveResult.ok) {
        throw new ServiceUnavailableException(
          reserveResult.reason === "misconfigured"
            ? "The AI Tutor is temporarily unavailable. Please try again later."
            : "The AI Tutor is temporarily unavailable due to daily usage limits. Please try again later.",
        );
      }
      budgetReservationId = reserveResult.reservationId;
    }

    let audio: Buffer;
    let billedUnits: number;
    try {
      ({ audio, billedUnits } = await provider.synthesize({
        text: spoken,
        // Content language is ground truth for how a call should sound —
        // never the student's profile/UI language setting, which can
        // legitimately differ from the language of any one piece of
        // content (e.g. a British-curriculum lesson served to an
        // Arabic-UI student). Arabic content keeps using the provider's
        // own configured (admin-editable) instructions, unchanged.
        instructionsOverride: isArabic ? undefined : SMARTIFY_TTS_INSTRUCTIONS_EN,
      }));
    } catch (err) {
      if (budgetReservationId) {
        await this.usageService.releaseBudget(budgetReservationId).catch(() => undefined);
      }
      throw err;
    }

    if (budgetReservationId) {
      await this.usageService.reconcileBudget(budgetReservationId, billedUnits * provider.costPerUnitUsd).catch(() => undefined);
    }

    await this.prisma.client.aIUsage
      .create({
        data: {
          userId,
          studentId: profile.id,
          subjectId: conversation.subjectId,
          feature: "tutor_tts",
          provider: provider.providerKey,
          model: provider.model,
          inputTokens: billedUnits, // characters, not tokens — TTS is priced per character
          outputTokens: 0,
          creditsUsed: 0, // does not consume a Tutor question/credit
          costUsd: billedUnits * provider.costPerUnitUsd,
        },
      })
      .catch(() => undefined); // cost-ledger write failure must never break audio playback for the student

    return audio;
  }
}
