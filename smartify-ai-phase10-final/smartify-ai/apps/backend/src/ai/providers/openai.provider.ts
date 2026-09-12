import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import OpenAI from "openai";
import { loadBackendEnv } from "@smartify/config";
import type { AIGenerateRequest, AIGenerateResult, AIProvider } from "../ai-provider.interface";

@Injectable()
export class OpenAIProvider implements AIProvider {
  private client: OpenAI | null = null;
  private readonly model: string;

  constructor(model: string) {
    this.model = model;
    const env = loadBackendEnv();
    if (env.OPENAI_API_KEY) {
      this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
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

    const completion = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: request.maxOutputTokens ?? 600,
      ...(request.responseFormat === "json_object" ? { response_format: { type: "json_object" as const } } : {}),
      messages: [
        { role: "system", content: request.systemPrompt },
        ...request.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    const choice = completion.choices[0];
    return {
      content: choice?.message?.content ?? "",
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      model: completion.model,
    };
  }
}
