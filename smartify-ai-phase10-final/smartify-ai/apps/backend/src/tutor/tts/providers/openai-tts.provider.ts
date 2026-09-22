import { ServiceUnavailableException } from "@nestjs/common";
import OpenAI from "openai";
import { loadBackendEnv } from "@smartify/config";
import type { TtsProvider, TtsSynthesizeRequest, TtsSynthesizeResult } from "../tts-provider.interface";
import type { TtsConfig } from "../tts-config.util";

// tts-1-hd costs 2x tts-1 ($0.030/1K characters vs $0.015/1K) — kept as a
// small lookup (not a guess) so cost logging stays accurate if the
// configured model changes; unrecognized models fall back to the tts-1-hd
// rate rather than silently logging $0.
//
// gpt-4o-mini-tts (Phase 9.4B): OpenAI prices this model per TOKEN
// ($0.60/1M input text tokens, $12/1M audio output tokens —
// developers.openai.com/api/docs/pricing), not per character, and the
// audio.speech.create response exposes no usage/token data at all
// (verified empirically during the Phase 9.4B Stage A bake-off) — so an
// exact per-call cost cannot be computed from the API response the way
// text-chat calls can. This rate is an ESTIMATE derived from that same
// bake-off: $0.019564 measured-duration-based cost across 717 spoken
// characters (9 real calls, marin/cedar/coral) ≈ $0.0000273/char. Kept in
// the same billedUnits-x-rate accounting shape as the other two models
// (no architecture change) — real spend should still be reconciled
// against OpenAI's actual billing once production traffic exists; the
// $5/day and $0.25/user/day USD caps are the real financial backstop
// regardless of this estimate's precision.
const OPENAI_TTS_COST_PER_CHARACTER_USD: Record<string, number> = {
  "tts-1": 0.000015,
  "tts-1-hd": 0.00003,
  "gpt-4o-mini-tts": 0.0000273,
};

// speed: unsupported by gpt-4o-mini-tts (OpenAI SDK: "Does not work with
// `gpt-4o-mini-tts`") — sent only for older models that honor it.
// instructions: the inverse — only gpt-4o-mini-tts honors voice-style
// steering ("Does not work with `tts-1` or `tts-1-hd`").
const MODELS_SUPPORTING_INSTRUCTIONS = new Set(["gpt-4o-mini-tts"]);
const MODELS_SUPPORTING_SPEED = new Set(["tts-1", "tts-1-hd"]);

export class OpenAiTtsProvider implements TtsProvider {
  readonly providerKey = "openai";
  readonly model: string;
  readonly costPerUnitUsd: number;
  private readonly client: OpenAI;
  private readonly voice: string;
  private readonly speed: number;
  private readonly instructions?: string;

  constructor(config: TtsConfig) {
    const env = loadBackendEnv();
    if (!env.OPENAI_API_KEY) {
      throw new ServiceUnavailableException("Voice playback is not configured yet — OPENAI_API_KEY is missing on the backend.");
    }
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    this.model = config.model;
    this.voice = config.voice;
    this.speed = config.speed;
    this.instructions = config.instructions;
    this.costPerUnitUsd = OPENAI_TTS_COST_PER_CHARACTER_USD[config.model] ?? OPENAI_TTS_COST_PER_CHARACTER_USD["tts-1-hd"];
  }

  async synthesize({ text, instructionsOverride }: TtsSynthesizeRequest): Promise<TtsSynthesizeResult> {
    const instructions = instructionsOverride ?? this.instructions;
    const response = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as OpenAI.Audio.Speech.SpeechCreateParams["voice"],
      input: text,
      ...(MODELS_SUPPORTING_SPEED.has(this.model) ? { speed: this.speed } : {}),
      ...(MODELS_SUPPORTING_INSTRUCTIONS.has(this.model) && instructions ? { instructions } : {}),
    });
    const audio = Buffer.from(await response.arrayBuffer());
    return { audio, billedUnits: text.length };
  }
}
