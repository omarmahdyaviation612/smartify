let mockEnv: any = { OPENAI_API_KEY: "sk-test-fixture" };
jest.mock("@smartify/config", () => ({ loadBackendEnv: () => mockEnv }));

import { TtsProviderFactory } from "./tts-provider.factory";
import { DEFAULT_TTS_CONFIG, TTS_CONFIG_KEY } from "./tts-config.util";
import { OpenAiTtsProvider } from "./providers/openai-tts.provider";

function makePrisma(systemConfigValue?: unknown) {
  const findUnique = jest.fn().mockResolvedValue(systemConfigValue === undefined ? null : { key: TTS_CONFIG_KEY, value: systemConfigValue });
  return { client: { systemConfig: { findUnique } } } as any;
}

describe("TtsProviderFactory", () => {
  beforeEach(() => {
    mockEnv = { OPENAI_API_KEY: "sk-test-fixture" };
  });

  it("returns the default config when no SystemConfig row exists", async () => {
    const factory = new TtsProviderFactory(makePrisma());
    expect(await factory.getConfig()).toEqual(DEFAULT_TTS_CONFIG);
  });

  it("reads provider/model/voice/speed/instructions from the SystemConfig row when present", async () => {
    const custom = { provider: "openai", model: "tts-1", voice: "shimmer", speed: 1.1, instructions: "Speak warmly." };
    const factory = new TtsProviderFactory(makePrisma(custom));
    expect(await factory.getConfig()).toEqual(custom);
  });

  it("falls back to defaults, without throwing, if reading SystemConfig itself fails", async () => {
    const prisma = { client: { systemConfig: { findUnique: jest.fn().mockRejectedValue(new Error("db down")) } } } as any;
    const factory = new TtsProviderFactory(prisma);
    expect(await factory.getConfig()).toEqual(DEFAULT_TTS_CONFIG);
  });

  it("resolves an OpenAiTtsProvider configured with the resolved config", async () => {
    const custom = { provider: "openai", model: "tts-1", voice: "shimmer", speed: 1.1, instructions: "Speak warmly." };
    const factory = new TtsProviderFactory(makePrisma(custom));
    const provider = await factory.getActiveProvider();
    expect(provider).toBeInstanceOf(OpenAiTtsProvider);
    expect(provider.model).toBe("tts-1");
    expect(provider.providerKey).toBe("openai");
  });

  it("resolves the owner-approved MVP default (gpt-4o-mini-tts / marin) when no SystemConfig row exists", async () => {
    const factory = new TtsProviderFactory(makePrisma());
    const provider = await factory.getActiveProvider();
    expect(provider.model).toBe("gpt-4o-mini-tts");
  });

  it("never throws for an unsupported provider — falls back to a working OpenAI provider instead", async () => {
    // A value that slips past normalizeTtsConfig's own defaulting would still be safe here in principle;
    // this exercises the factory's own fallback branch directly.
    const factory = new TtsProviderFactory(makePrisma({ provider: "some-future-provider" }));
    const provider = await factory.getActiveProvider();
    expect(provider).toBeInstanceOf(OpenAiTtsProvider);
  });

  it("still fails safely (throws a clear, catchable error) only when OpenAI itself is unconfigured — never a raw crash", async () => {
    mockEnv = { OPENAI_API_KEY: undefined };
    const factory = new TtsProviderFactory(makePrisma());
    await expect(factory.getActiveProvider()).rejects.toThrow(/OPENAI_API_KEY/);
  });
});
