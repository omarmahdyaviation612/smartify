export type TokenRateLimitMetadata = {
  limitTokens?: number | null;
  remainingTokens?: number | null;
  resetTokensMs?: number | null;
  retryAfterMs?: number | null;
  quota?: boolean;
};

export type TpmPacingRequest = {
  model: string;
  unitId: string;
  pageStart: number;
  pageEnd: number;
  estimatedTokens: number;
};

type PacerOptions = {
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  jitterMs?: () => number;
  log?: (entry: Record<string, unknown>) => void;
  maxWaitMs?: number;
  signal?: AbortSignal;
};

const DEFAULT_MAX_WAIT_MS = 120_000;
const MAX_JITTER_MS = 500;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Rate-limit wait cancelled"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Rate-limit wait cancelled"));
    }, { once: true });
  });
}

/**
 * Per-extraction, in-process token pacing. It deliberately has no shared
 * state: a future distributed coordinator can replace this boundary without
 * changing UnitGrounding's request sequencing.
 */
export class UnitGroundingTpmPacer {
  private lastSuccessful: TokenRateLimitMetadata | null = null;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly jitterMs: () => number;
  private readonly log: (entry: Record<string, unknown>) => void;
  private readonly maxWaitMs: number;
  private readonly signal?: AbortSignal;

  constructor(options: PacerOptions = {}) {
    this.sleep = options.sleep ?? defaultSleep;
    this.jitterMs = options.jitterMs ?? (() => Math.floor(Math.random() * (MAX_JITTER_MS + 1)));
    this.log = options.log ?? (() => undefined);
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.signal = options.signal;
  }

  recordSuccessfulResponse(metadata: TokenRateLimitMetadata | null | undefined) {
    this.lastSuccessful = metadata ?? null;
  }

  async waitBeforeNextChunk(request: TpmPacingRequest): Promise<void> {
    const metadata = this.lastSuccessful;
    if (!metadata || metadata.remainingTokens == null || metadata.remainingTokens > request.estimatedTokens) return;
    if (metadata.resetTokensMs == null) return;
    await this.wait(request, metadata, metadata.resetTokensMs, "next_chunk_insufficient_tpm");
    this.lastSuccessful = null;
  }

  async waitAfterTpm429(request: TpmPacingRequest, metadata: TokenRateLimitMetadata, attempt: number): Promise<void> {
    if (metadata.quota) throw new Error("Rate-limit wait not permitted for quota failure");
    const exponentialFallback = Math.min(15_000, 1_000 * 2 ** Math.max(0, attempt - 1));
    // Retry-After is a floor. A zero-token TPM window needs the token reset,
    // even when the provider also sends a much shorter retry hint.
    const baseWait = metadata.remainingTokens === 0 && metadata.resetTokensMs != null
      ? Math.max(metadata.resetTokensMs, metadata.retryAfterMs ?? 0)
      : Math.max(metadata.retryAfterMs ?? 0, metadata.resetTokensMs ?? 0, exponentialFallback);
    const reason = metadata.remainingTokens === 0 && metadata.resetTokensMs != null
      ? "tpm_429_reset_tokens"
      : "tpm_429_bounded_fallback";
    await this.wait(request, metadata, baseWait, reason);
    this.lastSuccessful = null;
  }

  private async wait(request: TpmPacingRequest, metadata: TokenRateLimitMetadata, baseWaitMs: number, reason: string): Promise<void> {
    const waitMs = Math.ceil(baseWaitMs + Math.max(0, Math.min(MAX_JITTER_MS, this.jitterMs())));
    if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > this.maxWaitMs) {
      throw new Error(`Rate-limit wait exceeds configured maximum (${this.maxWaitMs}ms)`);
    }
    this.log({
      event: "AI_RATE_LIMIT_WAIT",
      model: request.model,
      unitId: request.unitId,
      pageStart: request.pageStart,
      pageEnd: request.pageEnd,
      estimatedTokens: request.estimatedTokens,
      remainingTokens: metadata.remainingTokens ?? null,
      resetTokensMs: metadata.resetTokensMs ?? null,
      waitMs,
      reason,
    });
    await this.sleep(waitMs, this.signal);
  }
}
