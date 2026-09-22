/**
 * Abstraction over "which engine turns already-prepared speech text into
 * audio" — mirrors AIProvider/AIProviderFactory (../../ai/ai-provider.interface.ts)
 * on purpose, so this codebase has one consistent pattern for swappable
 * external providers rather than a one-off for TTS.
 *
 * TutorSpeechService is the ONLY caller of this interface. Neither the
 * frontend nor the Interactive Lesson engine ever see a provider name,
 * model, or voice — they call POST /tutor/speech and get audio bytes back,
 * regardless of which TtsProvider produced them.
 *
 * TODO(premium voice): to add a higher-quality/paid Arabic-Egyptian voice
 * provider later, write one new class here implementing TtsProvider (see
 * providers/openai-tts.provider.ts for the shape) and add one case to
 * TtsProviderFactory.getActiveProvider() — no changes needed to
 * TutorSpeechService, the lesson engine, or the frontend. Flip the active
 * provider via the existing SystemConfig admin mechanism (key "tts_config"),
 * not a deploy.
 */
export interface TtsSynthesizeRequest {
  /** Already-prepared speechText (markdown-stripped, Arabic-tashkeel-applied where relevant) — never raw displayText. */
  text: string;
  /**
   * Launch-speed addition (2026-09-19): overrides the provider's
   * configured `instructions` for this one call — TutorSpeechService sets
   * this to SMARTIFY_TTS_INSTRUCTIONS_EN when `text` isn't Arabic script,
   * so English-medium (e.g. British IG) content isn't narrated with
   * Egyptian-Arabic voice direction. Omitted (the common case, Arabic
   * content) means "use the provider's own configured instructions",
   * unchanged from before this field existed.
   */
  instructionsOverride?: string;
}

export interface TtsSynthesizeResult {
  audio: Buffer;
  /** Characters actually sent to the provider — a provider-agnostic unit for cost logging (some providers may price differently; each provider reports what it billed on). */
  billedUnits: number;
}

export interface TtsProvider {
  synthesize(request: TtsSynthesizeRequest): Promise<TtsSynthesizeResult>;
  /** USD cost per billedUnits, for accurate cost-ledger logging without TutorSpeechService hardcoding provider-specific pricing. */
  readonly costPerUnitUsd: number;
  readonly providerKey: string;
  readonly model: string;
}
