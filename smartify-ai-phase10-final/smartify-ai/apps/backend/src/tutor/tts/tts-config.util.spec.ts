import { DEFAULT_TTS_CONFIG, normalizeTtsConfig } from "./tts-config.util";

describe("normalizeTtsConfig", () => {
  it("returns the defaults when given undefined/null (no SystemConfig row exists yet)", () => {
    expect(normalizeTtsConfig(undefined)).toEqual(DEFAULT_TTS_CONFIG);
    expect(normalizeTtsConfig(null)).toEqual(DEFAULT_TTS_CONFIG);
  });

  it("returns the defaults for a completely empty object", () => {
    expect(normalizeTtsConfig({})).toEqual(DEFAULT_TTS_CONFIG);
  });

  it("accepts a fully valid custom config", () => {
    const custom = { provider: "openai", model: "tts-1", voice: "shimmer", speed: 1.1 };
    expect(normalizeTtsConfig(custom)).toEqual(custom);
  });

  it("falls back field-by-field for a partially malformed config, rather than discarding the whole row", () => {
    const result = normalizeTtsConfig({ voice: "shimmer", speed: "fast" }); // speed is the wrong type
    expect(result.voice).toBe("shimmer"); // valid field kept
    expect(result.speed).toBe(DEFAULT_TTS_CONFIG.speed); // invalid field falls back
    expect(result.model).toBe(DEFAULT_TTS_CONFIG.model); // missing field falls back
  });

  it("rejects a speed outside the provider's valid range", () => {
    expect(normalizeTtsConfig({ speed: 10 }).speed).toBe(DEFAULT_TTS_CONFIG.speed);
    expect(normalizeTtsConfig({ speed: 0.1 }).speed).toBe(DEFAULT_TTS_CONFIG.speed);
    expect(normalizeTtsConfig({ speed: 0.94 }).speed).toBe(0.94);
  });

  it("falls back to the default provider for an unsupported/unimplemented provider key, never throwing", () => {
    expect(normalizeTtsConfig({ provider: "premium-egyptian-voice" }).provider).toBe("openai");
  });

  it("ignores garbage input types entirely (e.g. a string instead of an object)", () => {
    expect(normalizeTtsConfig("not-an-object" as any)).toEqual(DEFAULT_TTS_CONFIG);
  });
});
