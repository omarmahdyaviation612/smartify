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
}

// Exactly the values already validated in Phase 2/3 live QA — changing the
// SystemConfig row is how you change these now, not editing this constant.
export const DEFAULT_TTS_CONFIG: TtsConfig = {
  provider: "openai",
  model: "tts-1-hd",
  voice: "nova",
  speed: 0.94,
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
  };
}
