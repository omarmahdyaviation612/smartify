import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { OpenAiTtsProvider } from "./providers/openai-tts.provider";
import type { TtsProvider } from "./tts-provider.interface";
import { DEFAULT_TTS_CONFIG, normalizeTtsConfig, TTS_CONFIG_KEY, type TtsConfig } from "./tts-config.util";

/**
 * Resolves the active TtsProvider from SystemConfig — mirrors
 * AIProviderFactory (../../ai/ai-provider.factory.ts) so this codebase has
 * one consistent "swap the provider via config, not a deploy" pattern.
 *
 * Deliberately never throws: an unsupported/malformed/missing
 * configuration falls back to DEFAULT_TTS_CONFIG (OpenAI) rather than
 * failing the request — voice playback is a nice-to-have on top of the
 * lesson/tutor text, and a TTS misconfiguration must never be able to take
 * the lesson down with it.
 *
 * TODO(premium voice): add a case here (e.g. `case "elevenlabs":`) once a
 * second TtsProvider implementation exists — see tts-provider.interface.ts.
 */
@Injectable()
export class TtsProviderFactory {
  private readonly logger = new Logger(TtsProviderFactory.name);

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<TtsConfig> {
    try {
      const row = await this.prisma.client.systemConfig.findUnique({ where: { key: TTS_CONFIG_KEY } });
      return normalizeTtsConfig(row?.value);
    } catch (err) {
      this.logger.warn(`Could not read TTS config (${err instanceof Error ? err.message : String(err)}) — using defaults.`);
      return DEFAULT_TTS_CONFIG;
    }
  }

  async getActiveProvider(): Promise<TtsProvider> {
    const config = await this.getConfig();

    switch (config.provider) {
      case "openai":
        return new OpenAiTtsProvider(config);
      default:
        // normalizeTtsConfig already restricts `provider` to known values,
        // so this is unreachable today — kept as the safe-fallback seam for
        // when a second provider key exists but isn't fully wired yet.
        this.logger.warn(`Unsupported TTS provider "${config.provider}" — falling back to OpenAI defaults.`);
        return new OpenAiTtsProvider(DEFAULT_TTS_CONFIG);
    }
  }
}
