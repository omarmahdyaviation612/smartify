import { AsyncLocalStorage } from "async_hooks";
import OpenAI, { type ClientOptions } from "openai";
import type { AIGenerateRequest, AIRateLimitMetadata } from "../ai-provider.interface";
import { estimateImageTokens, estimateTextTokens, pngDimensions } from "../vision-request-sizing";

type Context = Record<string, unknown> & { attempt: number };
const context = new AsyncLocalStorage<Context>();
const headerNames = ["x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens", "x-ratelimit-reset-tokens", "x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "x-ratelimit-reset-requests", "x-ratelimit-limit-project-tokens", "x-ratelimit-remaining-project-tokens", "x-ratelimit-reset-project-tokens"];
const safeId = (value: string | undefined | null) => value && /^[\w./:-]{1,200}$/.test(value) ? value : null;

export function isQuotaError(error: unknown): boolean {
  const value = error as { code?: string; type?: string; error?: { code?: string; type?: string } } | null;
  return [value?.code, value?.type, value?.error?.code, value?.error?.type].some(code => ["insufficient_quota", "billing_hard_limit_reached", "billing_not_active", "usage_limit_reached"].includes(code ?? ""));
}

export function retryAfterMs(headers: { get(name: string): string | null }): number | null {
  const ms = headers.get("retry-after-ms");
  if (ms !== null && Number.isFinite(Number(ms)) && Number(ms) >= 0) return Number(ms);
  const seconds = headers.get("retry-after");
  if (seconds === null) return null;
  const delay = Number.isFinite(Number(seconds)) ? Number(seconds) * 1000 : Date.parse(seconds) - Date.now();
  return Number.isFinite(delay) && delay >= 0 ? delay : null;
}

export function parseRateLimitResetMs(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.ceil(Number(value));
  let total = 0, found = false;
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    found = true;
    const amount = Number(match[1]);
    total += amount * (match[2] === "ms" ? 1 : match[2] === "s" ? 1_000 : match[2] === "m" ? 60_000 : 3_600_000);
  }
  return found && Number.isFinite(total) && total >= 0 ? Math.ceil(total) : null;
}

function safeIntegerHeader(headers: { get(name: string): string | null }, name: string): number | null {
  const value = headers.get(name);
  return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

export function tokenRateLimitMetadata(headers: { get(name: string): string | null }): AIRateLimitMetadata {
  return {
    limitTokens: safeIntegerHeader(headers, "x-ratelimit-limit-tokens"),
    remainingTokens: safeIntegerHeader(headers, "x-ratelimit-remaining-tokens"),
    resetTokensMs: parseRateLimitResetMs(headers.get("x-ratelimit-reset-tokens")),
    retryAfterMs: retryAfterMs(headers),
  };
}

export function createInstrumentedOpenAI(apiKey: string, log: (entry: Record<string, unknown>) => void, transport: typeof globalThis.fetch = globalThis.fetch): OpenAI {
  const fetch: typeof globalThis.fetch = async (url, options) => {
    const current = context.getStore();
    if (current) { current.attempt++; log({ event: "AI_REQUEST_STARTED", ...current }); }
    const response = await transport(url, options);
    if (response.status === 429) {
      const body = await response.clone().json().catch(() => null) as { error?: { code?: string; type?: string; message?: string } } | null;
      const quota = isQuotaError(body);
      const message = body?.error?.message ?? "";
      const safeHeaders = Object.fromEntries(headerNames.map(name => [name, response.headers.get(name)]).filter(([, value]) => value !== null && /^[0-9a-z. -]{1,100}$/i.test(value!)));
      log({ event: "AI_RATE_LIMITED", ...current, limitType: quota ? "QUOTA" : /\bTPM\b|tokens per min/i.test(message) ? "TPM" : /\bRPM\b|requests per min/i.test(message) ? "RPM" : "UNKNOWN", retryAfterMs: retryAfterMs(response.headers), requestId: safeId(response.headers.get("x-request-id")), rateLimitHeaders: safeHeaders, retryable: !quota });
      if (quota) {
        // Installed SDK honors x-should-retry before its generic 429 rule.
        // Proxy only this header: preserve status/body/error code for caller accounting.
        const headers = new Proxy(response.headers, { get(target, key) {
          if (key === "get") return (name: string) => name.toLowerCase() === "x-should-retry" ? "false" : target.get(name);
          const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
        } });
        return new Proxy(response, { get(target, key) {
          if (key === "headers") return headers;
          const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
        } });
      }
    }
    return response;
  };
  return new OpenAI({ apiKey, maxRetries: 2, fetch: fetch as unknown as ClientOptions["fetch"] });
}

export function withRequestDiagnostics<T>(model: string, request: AIGenerateRequest, run: () => Promise<T>): Promise<T> {
  let text = request.systemPrompt, imageCount = 0, imageTokens = 0, known = true;
  for (const message of request.messages) {
    if (typeof message.content === "string") text += message.content;
    else for (const part of message.content) {
      if (part.type === "text") text += part.text;
      else {
        imageCount++;
        try {
          if (!part.image_url.url.startsWith("data:image/png;base64,")) throw new Error("unknown dimensions");
          const dimensions = pngDimensions(Buffer.from(part.image_url.url.slice(22), "base64"));
          imageTokens += estimateImageTokens(model, dimensions.width, dimensions.height, part.image_url.detail === "low" ? "low" : "high");
        } catch { known = false; }
      }
    }
  }
  return context.run({ model, operation: safeId(request.diagnostics?.operation) ?? "chat_completion", unitId: safeId(request.diagnostics?.unitId), pageStart: request.diagnostics?.pageStart ?? null, pageEnd: request.diagnostics?.pageEnd ?? null, imageCount, estimatedInputTokens: request.diagnostics?.estimatedInputTokens ?? (known ? estimateTextTokens(text) + imageTokens : null), maxOutputTokens: request.maxOutputTokens ?? 600, attempt: 0 }, run);
}
