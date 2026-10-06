import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { AIProviderFactory } from "../ai/ai-provider.factory";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { PrismaService } from "../prisma/prisma.service";
import { estimateImageTokens, estimateTextTokens, pngDimensions } from "../ai/vision-request-sizing";

export type HomeworkImage = { buffer: Buffer; mimetype: string; size: number };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function imageMime(buffer: Buffer): "image/png" | "image/jpeg" | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  return null;
}

function jpegDimensions(bytes: Buffer) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) throw new BadRequestException("Invalid homework image.");
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      const height = bytes.readUInt16BE(offset + 5); const width = bytes.readUInt16BE(offset + 7);
      if (!width || !height) throw new BadRequestException("Invalid homework image dimensions.");
      return { width, height };
    }
    offset += 2 + length;
  }
  throw new BadRequestException("Invalid homework image dimensions.");
}

@Injectable()
export class HomeworkImageService {
  constructor(private readonly providers: AIProviderFactory, private readonly usage: AIUsageService, private readonly prisma: PrismaService) {}

  async extract(userId: string, studentId: string, subjectId: string, file: HomeworkImage) {
    try {
      const mime = imageMime(file.buffer);
      if (!file.buffer?.length || file.size > MAX_IMAGE_BYTES || !mime || (file.mimetype !== mime)) {
        throw new BadRequestException("Upload one clear JPG or PNG image, up to 8 MB.");
      }
      await this.usage.assertWithinBudget(userId);
      const { provider, providerKey, model } = await this.providers.getActiveProvider();
      if (!provider.supportsVision) throw new ServiceUnavailableException("Homework photo reading is temporarily unavailable.");
      const dimensions = mime === "image/png" ? pngDimensions(file.buffer) : jpegDimensions(file.buffer);
      if (dimensions.width > 8000 || dimensions.height > 8000 || dimensions.width * dimensions.height > 40_000_000) {
        throw new BadRequestException("Homework photo dimensions are too large. Upload a smaller image.");
      }
      const imageTokens = estimateImageTokens(model, dimensions.width, dimensions.height, "high");
      let dataUrl = `data:${mime};base64,${file.buffer.toString("base64")}`;
      const systemPrompt = "Read exactly one school homework exercise from the image. Return only JSON: {\"readable\":boolean,\"question\":string,\"topicQuery\":string}. Do not solve it. If multiple exercises or unreadable, readable=false and question empty. topicQuery is a short curriculum topic phrase.";
      const promptText = `${systemPrompt}\nSubject ID: ${subjectId}`;
      const estimate = await this.usage.estimateMaxChatCostUsd({ providerKey, inputText: promptText,
        estimatedInputTokens: estimateTextTokens(promptText) + imageTokens, maxOutputTokens: 350 });
      const reserved = await this.usage.reserveBudget(userId, estimate);
      if (!reserved.ok) throw new ServiceUnavailableException("Homework Help is temporarily unavailable.");
      let result;
      try {
        result = await provider.generate({ systemPrompt, messages: [{ role: "user", content: [
          { type: "text", text: "Read one exercise only. Do not answer it." },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ] }], responseFormat: "json_object", maxOutputTokens: 350 });
      } catch { await this.usage.releaseBudget(reserved.reservationId); throw new ServiceUnavailableException("Homework photo reading is temporarily unavailable."); }
      finally { dataUrl = ""; }
      let usageRow;
      try {
        usageRow = await this.usage.buildUsageRow({ userId, studentId, subjectId, providerKey, model: result.model,
          inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: "homework_helper", creditsUsed: 0 });
      } catch (error) {
        this.usage.logUntrackedUsage({ userId, studentId, subjectId, providerKey, model: result.model,
          inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: "homework_helper" }, error);
        await this.usage.reconcileBudget(reserved.reservationId, estimate);
        throw error;
      }
      try {
        await this.prisma.client.aIUsage.create({ data: usageRow });
        await this.usage.reconcileBudget(reserved.reservationId, usageRow.costUsd);
      } catch (error) {
        this.usage.logUntrackedUsage(usageRow, error);
        await this.usage.reconcileBudget(reserved.reservationId, usageRow.costUsd);
        throw error;
      }
      let parsed: any;
      try { parsed = JSON.parse(result.content); } catch { return { readable: false, question: "", topicQuery: "" }; }
      const question = typeof parsed.question === "string" ? parsed.question.trim().slice(0, 4000) : "";
      const topicQuery = typeof parsed.topicQuery === "string" ? parsed.topicQuery.trim().slice(0, 300) : "";
      return { readable: parsed.readable === true && question.length > 0, question, topicQuery };
    } finally {
      // Multer keeps this only in request memory. Zero and release the reference after extraction.
      if (Buffer.isBuffer(file?.buffer)) file.buffer.fill(0);
    }
  }
}
