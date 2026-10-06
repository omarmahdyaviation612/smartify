/**
 * Abstraction over "which LLM answers this request". Feature code (the
 * tutor, future exercise generation/grading) only ever talks to
 * AIProviderFactory / this interface — never to an SDK directly. Adding
 * Anthropic or a local model later means writing one new class here and
 * flipping AIProviderConfig.isActive in the database; no feature code changes.
 */
/**
 * A message's content is plain text almost everywhere in this app. The
 * array-of-parts form (2026-09-19) exists ONLY for the offline unit-
 * grounding extraction pipeline (UnitGroundingService), which must show a
 * vision-capable model real rendered textbook page images — no other
 * caller in this codebase sends images. Mirrors OpenAI's own multimodal
 * content-parts shape so OpenAiProvider can forward it unchanged.
 */
export type AIMessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "high" | "low" | "auto" } }>;

export interface AIGenerateRequest {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: AIMessageContent }>;
  maxOutputTokens?: number;
  diagnostics?: { operation: string; unitId?: string; pageStart?: number; pageEnd?: number; estimatedInputTokens?: number };
  /** UnitGrounding owns TPM pacing and therefore disables SDK short retries. */
  transportRetryMode?: "sdk" | "none";
  /**
   * "json_object" forces the provider to return a single valid JSON
   * object as the entire response — used by the Interactive Lesson
   * engine's check-evaluation turn so the caller can deterministically
   * parse intent/correctness rather than trusting free-form prose.
   * Omitted (default) preserves normal free-text behavior everywhere else.
   */
  responseFormat?: "text" | "json_object";
}

export interface AIRateLimitMetadata {
  limitTokens: number | null;
  remainingTokens: number | null;
  resetTokensMs: number | null;
  retryAfterMs: number | null;
}

export interface AIGenerateResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  rateLimit?: AIRateLimitMetadata;
}

export interface AIProvider {
  /** Explicit capability gate; image based Homework requests fail closed unless true. */
  readonly supportsVision?: boolean;
  generate(request: AIGenerateRequest): Promise<AIGenerateResult>;
}

export const AI_PROVIDER = Symbol("AI_PROVIDER");
