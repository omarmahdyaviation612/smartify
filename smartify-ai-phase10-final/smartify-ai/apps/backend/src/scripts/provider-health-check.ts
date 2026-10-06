/**
 * Cheapest possible REAL production OpenAI health check — uses the exact
 * same AIProviderFactory/AIUsageService/API key/model the app itself uses,
 * routed through the platform content-authoring actor and normal budget
 * reserve/reconcile accounting (never a student). A tiny 1-2 token prompt,
 * maxOutputTokens capped at 5. Touches NO Unit/Topic/LessonSession/
 * AIConversation/AIMessage row — only AIUsage + AIDailyBudgetCounter, the
 * same tables every real platform-authoring call already writes to.
 *
 * Not a models.list() call on purpose: that endpoint doesn't consume quota
 * and would NOT have failed during the "no credits remaining" incident, so
 * it wouldn't actually prove the same failure mode is now fixed. A real
 * minimal chat completion goes through the identical billing gate that
 * failed before.
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { AIProviderFactory } from "../ai/ai-provider.factory";
import { AIUsageService } from "../ai/usage/ai-usage.service";
import { CONTENT_AUTHORING_ACTOR_ID } from "../ai/content-authoring-actor.const";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService);
    const providerFactory = app.get(AIProviderFactory);
    const usageService = app.get(AIUsageService);

    await usageService.assertWithinBudget(CONTENT_AUTHORING_ACTOR_ID);

    const active = await providerFactory.getActiveProvider();
    const estimatedUsd = await usageService.estimateMaxChatCostUsd({ providerKey: active.providerKey, inputText: "Reply with only the word: OK.", maxOutputTokens: 5 });
    const reserve = await usageService.reserveBudget(CONTENT_AUTHORING_ACTOR_ID, estimatedUsd);
    if (!reserve.ok) {
      console.log(JSON.stringify({ status: "BLOCKED_BY_BUDGET", reason: reserve.reason }, null, 2));
      return;
    }

    let result: { content: string; inputTokens: number; outputTokens: number; model: string } | undefined;
    try {
      result = await active.provider.generate({
        systemPrompt: "Reply with only the single word: OK.",
        messages: [{ role: "user", content: "Health check." }],
        maxOutputTokens: 5,
        diagnostics: { operation: "provider_health_check" },
      });
    } catch (err) {
      await usageService.releaseBudget(reserve.reservationId);
      console.log(JSON.stringify({ status: "PROVIDER_CALL_FAILED", error: err instanceof Error ? { name: err.name, message: err.message, status: (err as any).status, code: (err as any).code, type: (err as any).type } : String(err) }, null, 2));
      return;
    }

    const usageRow = await usageService.buildUsageRow({
      userId: CONTENT_AUTHORING_ACTOR_ID, studentId: CONTENT_AUTHORING_ACTOR_ID, subjectId: "provider-health-check",
      providerKey: active.providerKey, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      feature: "provider_health_check", creditsUsed: 0,
    });
    await prisma.client.aIUsage.create({ data: usageRow });
    await usageService.reconcileBudget(reserve.reservationId, usageRow.costUsd);

    console.log(JSON.stringify({
      status: "OK",
      model: result.model,
      providerKey: active.providerKey,
      responseContent: result.content,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: usageRow.costUsd,
    }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
