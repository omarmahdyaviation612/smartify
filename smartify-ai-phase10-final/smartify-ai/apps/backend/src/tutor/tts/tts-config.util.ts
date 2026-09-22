/**
 * TTS provider/model/voice/speed, resolved the same way the existing
 * AIProviderConfig/PaymentProviderConfig tables resolve provider choice:
 * a database row an admin can change without a deploy, never a code
 * constant. Reuses the ALREADY-EXISTING generic SystemConfig(key, value)
 * table (see admin-ai-config.service.ts getSystemConfig/updateSystemConfig,
 * already wired to GET/PATCH /admin/ai-config/system-config/:key) instead
 * of adding a new dedicated table or a parallel set of TTS_* env vars —
 * this is genuinely just small non-secret routing config, exactly what
 * SystemConfig already exists for. The one real secret involved
 * (OPENAI_API_KEY) stays in the environment, per the same convention
 * PaymentProviderConfig documents for payment secrets.
 *
 * TODO(premium voice): a future provider ("elevenlabs", "azure", etc.) is
 * selected the same way — set provider in this SystemConfig row to that
 * key once TtsProviderFactory has a case for it. No schema change needed.
 */
export const TTS_CONFIG_KEY = "tts_config";

export interface TtsConfig {
  provider: "openai";
  model: string;
  voice: string;
  speed: number;
  /**
   * Steerable voice-style guidance — only honored by models that support it
   * (gpt-4o-mini-tts; NOT tts-1/tts-1-hd, see OpenAiTtsProvider). Optional
   * so older/simpler models can leave it unset without any special-casing
   * here.
   */
  instructions?: string;
}

// Phase 9.4B: owner-selected MVP voice after the Stage A bake-off (marin,
// cedar, coral compared on gpt-4o-mini-tts) — see docs/voice-bakeoff report.
// `speed` is kept for backward compatibility with a possible future
// tts-1/tts-1-hd fallback but is never sent to the API for gpt-4o-mini-tts,
// which doesn't support it (OpenAiTtsProvider omits it for that model).
export const SMARTIFY_TTS_INSTRUCTIONS =
  "Speak in warm, natural Egyptian Arabic (Masri), not Modern Standard Arabic, unless the text itself is formal. " +
  "Personality: a kind, encouraging elementary-school teacher talking directly to a young child — human and " +
  "conversational, never an announcer or narrator. Warm and genuinely encouraging without sounding childish, " +
  "cartoonish, or exaggerated/theatrical. Pronounce Arabic words and numbers clearly and precisely. When " +
  "explaining a math step or reading an equation, slow down slightly and add a short natural pause right around " +
  "the numbers and the equals sign, as a real teacher would when making sure a child follows along. When the " +
  "text expresses praise for a correct answer, sound genuinely pleased and warm, not over-the-top. When the text " +
  "is calming/supportive after a mistake, sound patient and reassuring, never disappointed or flat. Avoid a " +
  "robotic, flat, or metronomic cadence — vary pacing and warmth like a real person speaking to a child they " +
  "care about. Do not change, add, or omit any words, numbers, or mathematical content from the given text — " +
  "speak exactly what is written.";

// Launch-speed addition (2026-09-19): SMARTIFY_TTS_INSTRUCTIONS above
// hardcodes "Speak in warm, natural Egyptian Arabic" — correct for the
// Egyptian-curriculum content this was written for, but wrong once British
// IG (English-medium) content exists too: a student reading an English
// lesson was hearing it narrated with Egyptian-Arabic voice direction,
// which OpenAI's TTS model apparently followed literally enough to sound
// like Arabic speech over English words. Same persona/warmth, English
// delivery instead. TutorSpeechService picks between the two per call
// based on the ACTUAL text being spoken (containsArabicScript), not the
// student's profile language setting — content language is the ground
// truth for what a text-to-speech call should sound like.
export const SMARTIFY_TTS_INSTRUCTIONS_EN =
  "Speak in warm, natural English, unless the text itself is formal. " +
  "Personality: a kind, encouraging elementary-school teacher talking directly to a young child — human and " +
  "conversational, never an announcer or narrator. Warm and genuinely encouraging without sounding childish, " +
  "cartoonish, or exaggerated/theatrical. Pronounce words and numbers clearly and precisely. When explaining a " +
  "math step or reading an equation, slow down slightly and add a short natural pause right around the numbers " +
  "and the equals sign, as a real teacher would when making sure a child follows along. When the text expresses " +
  "praise for a correct answer, sound genuinely pleased and warm, not over-the-top. When the text is " +
  "calming/supportive after a mistake, sound patient and reassuring, never disappointed or flat. Avoid a robotic, " +
  "flat, or metronomic cadence — vary pacing and warmth like a real person speaking to a child they care about. " +
  "Do not change, add, or omit any words, numbers, or content from the given text — speak exactly what is written.";

// Exactly the values already validated in Phase 2/3 live QA — changing the
// SystemConfig row is how you change these now, not editing this constant.
export const DEFAULT_TTS_CONFIG: TtsConfig = {
  provider: "openai",
  model: "gpt-4o-mini-tts",
  voice: "marin",
  speed: 0.94,
  instructions: SMARTIFY_TTS_INSTRUCTIONS,
};

/**
 * Merges a possibly-partial/malformed SystemConfig value over the safe
 * defaults, field by field — an admin typo, a missing key, or the
 * SystemConfig row not existing at all must never break voice playback,
 * only silently fall back to a known-good value for that one field.
 */
export function normalizeTtsConfig(raw: unknown): TtsConfig {
  const value = (raw ?? {}) as Partial<Record<keyof TtsConfig, unknown>>;
  return {
    provider: value.provider === "openai" ? "openai" : DEFAULT_TTS_CONFIG.provider,
    model: typeof value.model === "string" && value.model.trim() ? value.model : DEFAULT_TTS_CONFIG.model,
    voice: typeof value.voice === "string" && value.voice.trim() ? value.voice : DEFAULT_TTS_CONFIG.voice,
    speed: typeof value.speed === "number" && Number.isFinite(value.speed) && value.speed >= 0.25 && value.speed <= 4.0 ? value.speed : DEFAULT_TTS_CONFIG.speed,
    instructions: typeof value.instructions === "string" && value.instructions.trim() ? value.instructions : DEFAULT_TTS_CONFIG.instructions,
  };
}
