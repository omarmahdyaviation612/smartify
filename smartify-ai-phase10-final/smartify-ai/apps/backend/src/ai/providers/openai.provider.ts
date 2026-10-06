import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { createInstrumentedOpenAI, tokenRateLimitMetadata, withRequestDiagnostics } from "./openai-request-diagnostics";
import OpenAI from "openai";
import { loadBackendEnv } from "@smartify/config";
import type { AIGenerateRequest, AIGenerateResult, AIProvider } from "../ai-provider.interface";

@Injectable()
export class OpenAIProvider implements AIProvider {
  readonly supportsVision: boolean;
  private client: OpenAI | null = null;
  private readonly model: string;
  private readonly logger = new Logger(OpenAIProvider.name);

  constructor(model: string) {
    this.model = model;
    this.supportsVision = /^(?:gpt-4o-mini(?:-\d{4}-\d{2}-\d{2})?|gpt-4o(?:-\d{4}-\d{2}-\d{2})?|gpt-4\.1(?:-\d{4}-\d{2}-\d{2})?)$/i.test(model);
    const env = loadBackendEnv();
    if (env.OPENAI_API_KEY) {
      this.client = createInstrumentedOpenAI(env.OPENAI_API_KEY, entry => this.logger.log(JSON.stringify(entry)));
    }
    // No key configured yet — client stays null, generate() fails fast
    // with a clear, catchable error rather than a confusing SDK crash.
  }

  async generate(request: AIGenerateRequest): Promise<AIGenerateResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        "AI Tutor is not configured yet — OPENAI_API_KEY is missing on the backend.",
      );
    }

    const client = this.client;
    const { data: completion, response } = await withRequestDiagnostics(this.model, request, () => client.chat.completions.create({
      model: this.model,
      max_tokens: request.maxOutputTokens ?? 600,
      ...(request.responseFormat === "json_object" ? { response_format: { type: "json_object" as const } } : {}),
      messages: [
        { role: "system", content: request.systemPrompt },
        // Cast: AIGenerateRequest.messages[].content is a union (plain
        // string, or image content-parts for the grounding-extraction
        // pipeline only) that the SDK's own discriminated
        // ChatCompletionMessageParam type can't correlate against a bare
        // "user"|"assistant" role through a .map() — the shape itself is
        // exactly OpenAI's own multimodal format, so this is a type-system
        // limitation, not a runtime risk.
        ...(request.messages.map((m) => ({ role: m.role, content: m.content })) as OpenAI.Chat.ChatCompletionMessageParam[]),
      ],
    }, { maxRetries: request.transportRetryMode === "none" ? 0 : undefined }).withResponse());

    const choice = completion.choices[0];
    this.logger.log(JSON.stringify({ event: "AI_REQUEST_COMPLETED", model: this.model, inputTokens: completion.usage?.prompt_tokens ?? null, outputTokens: completion.usage?.completion_tokens ?? null }));
    return {
      content: choice?.message?.content ?? "",
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      model: completion.model,
      rateLimit: tokenRateLimitMetadata(response.headers),
    };
  }
}
