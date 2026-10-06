import { ServiceUnavailableException } from "@nestjs/common";
import { HomeworkImageService } from "./homework-image.service";

function png() {
  const b = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
  b.write("IHDR", 12, "ascii"); b.writeUInt32BE(100, 16); b.writeUInt32BE(100, 20); return b;
}

describe("HomeworkImageService", () => {
  function setup(supportsVision = true) {
    const provider = { supportsVision, generate: jest.fn().mockResolvedValue({ content: JSON.stringify({ readable: true, question: "What is 2+2?", topicQuery: "Addition" }), inputTokens: 100, outputTokens: 30, model: "gpt-4o" }) };
    const providers = { getActiveProvider: jest.fn().mockResolvedValue({ provider, providerKey: "openai", model: "gpt-4o" }) };
    const usage = { assertWithinBudget: jest.fn(), estimateMaxChatCostUsd: jest.fn().mockResolvedValue(0.01), reserveBudget: jest.fn().mockResolvedValue({ ok: true, reservationId: "budget-1" }),
      releaseBudget: jest.fn(), reconcileBudget: jest.fn(), buildUsageRow: jest.fn().mockResolvedValue({ feature: "homework_helper", costUsd: 0.001 }), logUntrackedUsage: jest.fn() };
    const prisma: any = { client: { aIUsage: { create: jest.fn() } } };
    return { service: new HomeworkImageService(providers as any, usage as any, prisma), provider, providers, usage, prisma };
  }

  it("validates an image, bounds spend using image dimensions, logs actual feature use, and clears its buffer", async () => {
    const h = setup(); const buffer = png(); const file = { buffer, mimetype: "image/png", size: buffer.length };
    await expect(h.service.extract("user-1", "student-1", "subject-1", file)).resolves.toMatchObject({ readable: true, question: "What is 2+2?" });
    expect(h.usage.estimateMaxChatCostUsd).toHaveBeenCalledWith(expect.objectContaining({ estimatedInputTokens: expect.any(Number) }));
    expect(h.prisma.client.aIUsage.create).toHaveBeenCalledWith({ data: { feature: "homework_helper", costUsd: 0.001 } });
    expect(buffer.every(byte => byte === 0)).toBe(true);
  });

  it("fails closed for non-vision active providers and still clears the uploaded image", async () => {
    const h = setup(false); const buffer = png();
    await expect(h.service.extract("user-1", "student-1", "subject-1", { buffer, mimetype: "image/png", size: buffer.length })).rejects.toThrow(ServiceUnavailableException);
    expect(h.provider.generate).not.toHaveBeenCalled(); expect(buffer.every(byte => byte === 0)).toBe(true);
  });

  it("rejects spoofed MIME types before budget reservation", async () => {
    const h = setup(); const buffer = Buffer.from("not an image");
    await expect(h.service.extract("user-1", "student-1", "subject-1", { buffer, mimetype: "image/png", size: buffer.length })).rejects.toThrow();
    expect(h.usage.reserveBudget).not.toHaveBeenCalled(); expect(buffer.every(byte => byte === 0)).toBe(true);
  });
});
