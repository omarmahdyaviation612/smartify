import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { stripMarkdownForSpeech } from "./speech-text.util";
import { containsArabicScript, prepareArabicSpeechText } from "./arabic-speech-preparation.util";
import { TtsProviderFactory } from "./tts/tts-provider.factory";

const MAX_INPUT_CHARS = 4000; // generous for a tutor reply; bounds cost/abuse per call

@Injectable()
export class TutorSpeechService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usageService: AIUsageService,
    // Defaulted (not required) so this remains constructible exactly as
    // before wherever it's built directly rather than through Nest's DI —
    // in production Nest still injects one shared TtsProviderFactory.
    private readonly ttsProviderFactory: TtsProviderFactory = new TtsProviderFactory(prisma),
  ) {}

  /**
   * Synthesizes speech for an already-generated Tutor reply. This is
   * deliberately NOT gated by Free Trial/subscription quota — the
   * question was already paid for (in trial-question or usage terms) when
   * /tutor/message produced this text; reading it aloud, or replaying it,
   * is not a second question. Logs its own AIUsage row (feature:
   * "tutor_tts") so real cost is tracked separately from "tutor_chat".
   *
   * Security: `text` is never trusted as arbitrary client input. The
   * caller must identify an existing conversation they own, and the text
   * must exactly match one of that conversation's own assistant replies —
   * otherwise this endpoint would be an unrestricted "turn any text into
   * speech using my OpenAI key" proxy for any authenticated user. This is
   * the only check that ties speech generation back to real, already-paid
   * Tutor content rather than to the caller's identity alone.
   *
   * Which engine actually renders the audio (OpenAI today, potentially a
   * premium Arabic/Egyptian voice provider later) is entirely decided by
   * TtsProviderFactory — this method, the Interactive Lesson engine, and
   * the frontend never know or care which one produced the bytes.
   */
  async synthesize(input: { userId: string; conversationId: string; text: string }): Promise<Buffer> {
    // Resolves (and, for OpenAI, validates OPENAI_API_KEY) before any DB
    // work — an unconfigured/misconfigured TTS setup fails the same way it
    // always has: fast, before touching the database.
    const provider = await this.ttsProviderFactory.getActiveProvider();

    const profile = await this.prisma.client.studentProfile.findUnique({ where: { userId: input.userId } });
    if (!profile) {
      throw new ForbiddenException("Complete onboarding before using Tutor voice playback.");
    }

    const conversation = await this.prisma.client.aIConversation.findUnique({ where: { id: input.conversationId } });
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

    await this.usageService.assertWithinBudget(input.userId);

    // displayText (requestedText, verified above against the real stored
    // reply) is never altered. speechText is a separate, purely-derived
    // string used ONLY for this TTS call — markdown-stripped, then (Arabic
    // only) passed through a small deterministic tashkeel layer for known
    // pronunciation trouble spots (symbols, small numbers, a short list of
    // domain terms). Both steps are pure functions of requestedText, so the
    // frontend's existing per-turn audio cache (keyed off the unchanged
    // displayText) stays correct with no extra invalidation logic needed.
    const displayStripped = stripMarkdownForSpeech(requestedText).trim();
    const spoken = containsArabicScript(displayStripped) ? prepareArabicSpeechText(displayStripped) : displayStripped;
    if (!spoken) {
      throw new BadRequestException("Nothing to read aloud.");
    }
    if (spoken.length > MAX_INPUT_CHARS) {
      throw new BadRequestException(`Text is too long to synthesize (max ${MAX_INPUT_CHARS} characters).`);
    }

    const { audio, billedUnits } = await provider.synthesize({ text: spoken });

    await this.prisma.client.aIUsage.create({
      data: {
        userId: input.userId,
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
    }).catch(() => undefined); // cost-ledger write failure must never break audio playback for the student

    return audio;
  }
}
