import { ServiceUnavailableException } from "@nestjs/common";
import OpenAI from "openai";
import { loadBackendEnv } from "@smartify/config";
import type { TtsProvider, TtsSynthesizeRequest, TtsSynthesizeResult } from "../tts-provider.interface";
import type { TtsConfig } from "../tts-config.util";

// tts-1-hd costs 2x tts-1 ($0.030/1K characters vs $0.015/1K) — kept as a
// small lookup (not a guess) so cost logging stays accurate if the
// configured model changes; unrecognized models fall back to the tts-1-hd
// rate rather than silently logging $0.
const OPENAI_TTS_COST_PER_CHARACTER_USD: Record<string, number> = {
  "tts-1": 0.000015,
  "tts-1-hd": 0.00003,
};

export class OpenAiTtsProvider implements TtsProvider {
  readonly providerKey = "openai";
  readonly model: string;
  readonly costPerUnitUsd: number;
  private readonly client: OpenAI;
  private readonly voice: string;
  private readonly speed: number;

  constructor(config: TtsConfig) {
    const env = loadBackendEnv();
    if (!env.OPENAI_API_KEY) {
      throw new ServiceUnavailableException("Voice playback is not configured yet — OPENAI_API_KEY is missing on the backend.");
    }
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    this.model = config.model;
    this.voice = config.voice;
    this.speed = config.speed;
    this.costPerUnitUsd = OPENAI_TTS_COST_PER_CHARACTER_USD[config.model] ?? OPENAI_TTS_COST_PER_CHARACTER_USD["tts-1-hd"];
  }

  async synthesize({ text }: TtsSynthesizeRequest): Promise<TtsSynthesizeResult> {
    const response = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as OpenAI.Audio.Speech.SpeechCreateParams["voice"],
      input: text,
      speed: this.speed,
    });
    const audio = Buffer.from(await response.arrayBuffer());
    return { audio, billedUnits: text.length };
  }
}
