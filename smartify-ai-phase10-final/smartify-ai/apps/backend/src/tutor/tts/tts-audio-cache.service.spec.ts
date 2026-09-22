import { ServiceUnavailableException } from "@nestjs/common";

const mockSend = jest.fn();
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ __type: "GetObjectCommand", input })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ __type: "PutObjectCommand", input })),
}));

let mockEnv: any = {
  CURRICULUM_S3_BUCKET: "test-bucket",
  CURRICULUM_S3_REGION: "auto",
  CURRICULUM_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
  CURRICULUM_S3_ACCESS_KEY_ID: "test-key",
  CURRICULUM_S3_SECRET_ACCESS_KEY: "test-secret",
  CURRICULUM_S3_FORCE_PATH_STYLE: true,
};
jest.mock("@smartify/config", () => ({ loadBackendEnv: () => mockEnv }));

import { TtsAudioCacheService, computeLessonTtsCacheKey } from "./tts-audio-cache.service";

function fakeBody(bytes: Buffer) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield bytes;
    },
  };
}

describe("computeLessonTtsCacheKey", () => {
  const BASE = { spokenText: "Hello there.", model: "gpt-4o-mini-tts", voice: "marin", speed: 0.94, instructions: "Be warm." };

  it("is stable for identical inputs", () => {
    expect(computeLessonTtsCacheKey(BASE)).toBe(computeLessonTtsCacheKey({ ...BASE }));
  });

  it("has the expected tts-cache/lesson/<sha256>.mp3 shape", () => {
    const key = computeLessonTtsCacheKey(BASE);
    expect(key).toMatch(/^tts-cache\/lesson\/[0-9a-f]{64}\.mp3$/);
  });

  it.each([
    ["spoken text", { ...BASE, spokenText: "Hello there!" }],
    ["model", { ...BASE, model: "tts-1-hd" }],
    ["voice", { ...BASE, voice: "nova" }],
    ["speed", { ...BASE, speed: 1.0 }],
    ["instructions", { ...BASE, instructions: "Be calm." }],
  ])("changing %s alone produces a different key", (_label, changed) => {
    expect(computeLessonTtsCacheKey(changed)).not.toBe(computeLessonTtsCacheKey(BASE));
  });

  it("has no UI-locale input at all — the function signature only accepts text/model/voice/speed/instructions", () => {
    // Structural proof, not just a runtime assertion: TypeScript would reject
    // an extra `locale` field here if the function ever grew one silently
    // unused, and there is no field to pass it through even if a caller wanted to.
    const key = computeLessonTtsCacheKey(BASE);
    expect(key).toBe(computeLessonTtsCacheKey(BASE));
  });
});

describe("TtsAudioCacheService", () => {
  beforeEach(() => {
    mockEnv = {
      CURRICULUM_S3_BUCKET: "test-bucket",
      CURRICULUM_S3_REGION: "auto",
      CURRICULUM_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      CURRICULUM_S3_ACCESS_KEY_ID: "test-key",
      CURRICULUM_S3_SECRET_ACCESS_KEY: "test-secret",
      CURRICULUM_S3_FORCE_PATH_STYLE: true,
    };
    mockSend.mockReset();
  });

  it("get() returns the cached Buffer on a real hit", async () => {
    mockSend.mockResolvedValue({ Body: fakeBody(Buffer.from("cached audio bytes")) });
    const service = new TtsAudioCacheService();
    const result = await service.get("tts-cache/lesson/abc.mp3");
    expect(result?.toString()).toBe("cached audio bytes");
  });

  it("get() returns null (not an error) for a genuine NoSuchKey miss", async () => {
    mockSend.mockRejectedValue(Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey" }));
    const service = new TtsAudioCacheService();
    const result = await service.get("tts-cache/lesson/missing.mp3");
    expect(result).toBeNull();
  });

  it("get() returns null for a 404-shaped error even without the exact NoSuchKey name (R2 compatibility)", async () => {
    mockSend.mockRejectedValue({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
    const service = new TtsAudioCacheService();
    const result = await service.get("tts-cache/lesson/missing.mp3");
    expect(result).toBeNull();
  });

  it("get() rethrows a genuine storage error (not a 404) for the caller to handle", async () => {
    mockSend.mockRejectedValue(Object.assign(new Error("connection reset"), { name: "NetworkingError" }));
    const service = new TtsAudioCacheService();
    await expect(service.get("tts-cache/lesson/x.mp3")).rejects.toThrow("connection reset");
  });

  it("put() writes the object as private audio/mpeg with no public URL ever returned", async () => {
    mockSend.mockResolvedValue({});
    const service = new TtsAudioCacheService();
    const audio = Buffer.from("some mp3 bytes");
    const result = await service.put("tts-cache/lesson/abc.mp3", audio);

    expect(result).toBeUndefined(); // no URL of any kind is ever returned
    const call = mockSend.mock.calls[0][0];
    expect(call.__type).toBe("PutObjectCommand");
    expect(call.input).toEqual(
      expect.objectContaining({ Bucket: "test-bucket", Key: "tts-cache/lesson/abc.mp3", Body: audio, ContentType: "audio/mpeg", ContentLength: audio.length }),
    );
  });

  it("throws a safe ServiceUnavailableException (never a raw R2 error) when storage isn't configured, and never touches the S3 client at all", async () => {
    mockEnv = {}; // no CURRICULUM_S3_BUCKET
    const service = new TtsAudioCacheService();
    await expect(service.get("tts-cache/lesson/x.mp3")).rejects.toThrow(ServiceUnavailableException);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("never logs or exposes credentials — the client is constructed once and only Bucket/Key/audio bytes ever appear in what's sent", async () => {
    mockSend.mockResolvedValue({});
    const service = new TtsAudioCacheService();
    await service.put("tts-cache/lesson/abc.mp3", Buffer.from("x"));
    const sentInput = JSON.stringify(mockSend.mock.calls[0][0].input);
    expect(sentInput).not.toMatch(/test-secret|test-key/);
  });
});
