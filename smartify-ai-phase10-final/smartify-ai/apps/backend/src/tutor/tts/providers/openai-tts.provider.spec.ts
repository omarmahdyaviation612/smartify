const create = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ audio: { speech: { create } } })),
}));
let mockEnv: any = { OPENAI_API_KEY: "sk-test-fixture" };
jest.mock("@smartify/config", () => ({ loadBackendEnv: () => mockEnv }));

import { OpenAiTtsProvider } from "./openai-tts.provider";

/**
 * Phase 9.4B: gpt-4o-mini-tts (the owner-approved MVP model) supports
 * `instructions` but NOT `speed`; tts-1/tts-1-hd are the reverse. Getting
 * this backwards would either silently drop the approved Smartify
 * speaking-style guidance, or send an unsupported/rejected parameter to
 * the real API — these tests pin the exact parameter shape sent per model.
 */
describe("OpenAiTtsProvider — per-model parameter shape", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv = { OPENAI_API_KEY: "sk-test-fixture" };
    create.mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8) });
  });

  it("sends instructions (not speed) for gpt-4o-mini-tts", async () => {
    const provider = new OpenAiTtsProvider({ provider: "openai", model: "gpt-4o-mini-tts", voice: "marin", speed: 0.94, instructions: "Speak warmly." });
    await provider.synthesize({ text: "مرحبا" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini-tts", voice: "marin", input: "مرحبا", instructions: "Speak warmly." }),
    );
    expect(create.mock.calls[0][0]).not.toHaveProperty("speed");
  });

  it("sends speed (not instructions) for tts-1-hd", async () => {
    const provider = new OpenAiTtsProvider({ provider: "openai", model: "tts-1-hd", voice: "nova", speed: 0.94, instructions: "Speak warmly." });
    await provider.synthesize({ text: "hello" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: "tts-1-hd", voice: "nova", input: "hello", speed: 0.94 }));
    expect(create.mock.calls[0][0]).not.toHaveProperty("instructions");
  });

  it("omits instructions for gpt-4o-mini-tts when none is configured, rather than sending an empty string", async () => {
    const provider = new OpenAiTtsProvider({ provider: "openai", model: "gpt-4o-mini-tts", voice: "marin", speed: 1 });
    await provider.synthesize({ text: "hi" });
    expect(create.mock.calls[0][0]).not.toHaveProperty("instructions");
  });

  it("bills by character count (billedUnits) regardless of model, unchanged accounting shape", async () => {
    const provider = new OpenAiTtsProvider({ provider: "openai", model: "gpt-4o-mini-tts", voice: "marin", speed: 0.94 });
    const result = await provider.synthesize({ text: "12345" });
    expect(result.billedUnits).toBe(5);
  });

  it("uses the gpt-4o-mini-tts estimated per-character rate, distinct from tts-1-hd's", () => {
    const gptMini = new OpenAiTtsProvider({ provider: "openai", model: "gpt-4o-mini-tts", voice: "marin", speed: 0.94 });
    const ttsHd = new OpenAiTtsProvider({ provider: "openai", model: "tts-1-hd", voice: "nova", speed: 0.94 });
    expect(gptMini.costPerUnitUsd).not.toBe(ttsHd.costPerUnitUsd);
    expect(gptMini.costPerUnitUsd).toBeGreaterThan(0);
  });
});
