/**
 * Abstraction over "which LLM answers this request". Feature code (the
 * tutor, future exercise generation/grading) only ever talks to
 * AIProviderFactory / this interface — never to an SDK directly. Adding
 * Anthropic or a local model later means writing one new class here and
 * flipping AIProviderConfig.isActive in the database; no feature code changes.
 */
export interface AIGenerateRequest {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxOutputTokens?: number;
  /**
   * "json_object" forces the provider to return a single valid JSON
   * object as the entire response — used by the Interactive Lesson
   * engine's check-evaluation turn so the caller can deterministically
   * parse intent/correctness rather than trusting free-form prose.
   * Omitted (default) preserves normal free-text behavior everywhere else.
   */
  responseFormat?: "text" | "json_object";
}

export interface AIGenerateResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface AIProvider {
  generate(request: AIGenerateRequest): Promise<AIGenerateResult>;
}

export const AI_PROVIDER = Symbol("AI_PROVIDER");
