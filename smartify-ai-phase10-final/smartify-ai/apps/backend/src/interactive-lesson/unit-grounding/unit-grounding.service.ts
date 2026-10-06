import { estimateImageTokens, estimateTextTokens, groundingSizingConfig, planGroundingChunks, pngDimensions, type ImageDetail, type SizedPage } from "../../ai/vision-request-sizing";
import { GroundingSourceExtractionService } from "./grounding-source-extraction.service";
import { GroundingVisionExecutionService } from "./grounding-vision-execution.service";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@smartify/database";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../../ai/ai-provider.factory";
import { AIContextBuilderService } from "../../ai/context/ai-context-builder.service";
import { AIUsageService } from "../../ai/usage/ai-usage.service";
import { validateGroundingNotes } from "./unit-grounding-validator";
import { remapSourceImageIndexToPages } from "./unit-grounding-page-remap.util";
import type { GroundingNotes } from "./unit-grounding.types";
import { CurriculumSourceStorageFactory } from "./storage/curriculum-source-storage.factory";
import { resolveEffectiveSourceFile } from "./unit-effective-source.util";
import { UnitGroundingTpmPacer, type TokenRateLimitMetadata } from "./tpm-pacing.util";
import { isQuotaError, tokenRateLimitMetadata } from "../../ai/providers/openai-request-diagnostics";
import { CONTENT_AUTHORING_ACTOR_ID } from "../../ai/content-authoring-actor.const";
import { UnitGroundingProgressService } from "./unit-grounding-progress.service";
import type { GroundingChunkResult } from "./unit-grounding-progress.service";


const MAX_ATTEMPTS = 2; // one initial attempt + one corrective retry — same bound as every other AI-generation loop in this codebase

// Production hotfix (2026-09-25): a Unit whose source PDF object is
// missing from R2 (or any other deterministic chunk-extraction failure)
// used to retry forever — RETRYABLE_FAILURE with no ceiling, masked back
// to a plain "PREPARING" by the nextEligibleAt short-circuit below, so a
// student polling /advance never saw an error at all (see the
// "cmucxcubj00eh2qd5kfwohz11" incident: retryCount reached 237 with
// lastErrorCode "NoSuchKey"). A conservative bound: real transient
// failures (a momentary network blip, a non-quota 5xx) are expected to
// clear within a handful of attempts; anything past this many consecutive
// failures is treated as terminal rather than polled forever.
const MAX_RETRYABLE_ATTEMPTS = 5;
const MAX_PAGES_PER_RENDER = 10; // caps vision-token cost per call; a larger Unit range runs multiple sequential calls, merged into one GroundingNotes
const MAX_TPM_TRANSPORT_ATTEMPTS = 2;
export const MAX_UNIT_PAGE_COUNT = 40; // a sane ceiling on a single Unit's total page range — protects against an accidentally huge manifest range being silently rendered/processed in full

const CURRENT_GROUNDING_VERSION = 1; // bump only when the extraction schema/methodology changes in a way that makes old groundingNotesJson stale
// Page-provenance hotfix (2026-09-25): bumped v1 -> v2 because the
// extraction contract genuinely changed (model-generated absolute
// sourcePages -> model-generated sourceImageIndex + deterministic backend
// remapping — see unit-grounding-page-remap.util.ts). This bump is also
// the ZERO-MANUAL-INTERVENTION production recovery mechanism for any
// UnitGroundingProgress row stuck in CONFIGURATION_ERROR under the old
// contract (e.g. unitId cmucxcubj00eh2qd5kfwohz11): since promptVersion is
// part of UnitGroundingProgressService.sameIdentity()'s comparison, the
// next real student /advance request will find sameIdentity() false for
// that stale row and initialize() will delete-and-recreate a fresh
// IN_PROGRESS row automatically — no manual DB reset/delete, no
// grounding:extract, ever required.
const GROUNDING_PROMPT_VERSION = "grounding-extraction-v2";

// Production lazy-grounding lock tuning (ensureUnitGrounded). A stale lock
// (crashed worker) is reclaimed after this long — long enough to cover a
// real multi-chunk extraction, short enough that a genuine crash doesn't
// block a Unit for hours.
const LOCK_STALE_AFTER_MS = 5 * 60 * 1000;
// How long a request that LOST the lock race waits for the WINNING
// request's extraction to finish before giving up and falling back to
// legacy generation for itself only — bounded well under typical reverse-
// proxy read timeouts (commonly 60s+) so a slow winner never causes the
// loser's own request to hang past what infra will tolerate.
const GROUNDING_WAIT_TIMEOUT_MS = 45 * 1000;
const GROUNDING_WAIT_POLL_INTERVAL_MS = 2 * 1000;

type BoundedGroundingResult =
  | { status: "READY" }
  | { status: "PREPARING"; retryAfterMs?: number; nextEligibleAt?: Date }
  | { status: "RETRYABLE_FAILURE"; retryAfterMs: number; nextEligibleAt: Date; reason: string }
  | { status: "CONFIGURATION_ERROR"; reason: string }
  // 2026-09-26 provider-outage incident: an OpenAI account-level billing/
  // quota exhaustion (isQuotaError — a stable SDK error code, e.g.
  // "insufficient_quota", never fragile string matching) is NOT this
  // Unit's fault and is NOT expected to resolve by retrying THIS Unit — it
  // resolves only when the account's credits are restored. Distinct from
  // CONFIGURATION_ERROR on purpose: nothing is persisted to this Unit's
  // progress row (no retryCount increment, no status change, no
  // lastErrorCode) — the exact same Unit is fully retryable, unmarked and
  // unharmed, the moment the provider is healthy again. A caller (the bulk
  // warm-up script; a real student's lazy-generation request) must stop
  // immediately on seeing this rather than treating it like any other
  // transient failure and burning through more Units/retries against the
  // same outage.
  | { status: "PROVIDER_OUTAGE"; reason: string };

class BoundedGroundingRetryError extends Error {
  constructor(readonly metadata: TokenRateLimitMetadata) { super("Grounding provider retry deferred"); }
}

export class UnitGroundingExtractionError extends Error {
  constructor(
    message: string,
    readonly lastErrors: string[],
  ) {
    super(message);
    this.name = "UnitGroundingExtractionError";
  }
}

/** Polls `check()` until it returns true or `timeoutMs` elapses. Safe/non-blocking on Node's event loop — a plain setTimeout-based wait, not a library. */
async function pollUntil(check: () => Promise<boolean>, opts: { intervalMs: number; timeoutMs: number }): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
  }
  return await check(); // one last check right at the deadline
}

function chunkPageRange(start: number, end: number, maxPerChunk: number): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  for (let chunkStart = start; chunkStart <= end; chunkStart += maxPerChunk) {
    chunks.push([chunkStart, Math.min(chunkStart + maxPerChunk - 1, end)]);
  }
  return chunks;
}

/**
 * Deterministic bounded partition of a Unit page range into extraction windows of at most
 * `maxPages` pages (2026-10-02 large-Unit replacement support). A range within the limit is a
 * single window (unchanged behavior). Otherwise the minimum window count is used with an even
 * window size where possible, so window boundaries fall on the same ~2-page chunk pairing a
 * single pass would use. Windows are contiguous, ordered, non-overlapping and cover the range exactly.
 */
export function partitionUnitRange(start: number, end: number, maxPages: number): Array<[number, number]> {
  if (![start, end, maxPages].every(Number.isSafeInteger) || start < 1 || end < start || maxPages < 1) throw new Error("Invalid page range or window size");
  const n = end - start + 1;
  if (n <= maxPages) return [[start, end]];
  const windowCount = Math.ceil(n / maxPages);
  let size = Math.ceil(n / windowCount);
  if (size % 2 === 1 && size + 1 <= maxPages) size += 1;
  const windows: Array<[number, number]> = [];
  for (let s = start; s <= end; s += size) windows.push([s, Math.min(end, s + size - 1)]);
  return windows;
}

function mergeGroundingNotes(chunks: GroundingNotes[]): GroundingNotes {
  return {
    unitTitle: chunks[0].unitTitle,
    gradeLevel: chunks[0].gradeLevel,
    subject: chunks[0].subject,
    learningObjectives: chunks.flatMap((c) => c.learningObjectives),
    concepts: chunks.flatMap((c) => c.concepts),
    facts: chunks.flatMap((c) => c.facts),
    vocabulary: chunks.flatMap((c) => c.vocabulary),
    skills: chunks.flatMap((c) => c.skills),
    topicHints: chunks.flatMap((c) => c.topicHints),
    scopeNotes: chunks.flatMap((c) => c.scopeNotes),
  };
}

/**
 * Unit-grounding extraction — the one place a real textbook PDF is ever
 * read for content-generation purposes. Turns a Unit's real source pages
 * into original, structured, non-verbatim curriculum notes
 * (Unit.groundingNotesJson), ONCE per Unit, so every Topic's lazy
 * lesson/question generation under it can be grounded in real material at
 * zero added per-student cost forever after.
 *
 * Called from two places (2026-09-19): the offline
 * apps/backend/src/scripts/extract-unit-grounding.ts script (manual/admin
 * use), AND `ensureUnitGrounded()` below, invoked automatically from a
 * real student's live request the first time they open a Topic in a
 * never-grounded Unit (see LessonDraftGeneratorService.
 * ensureTopicHasLesson). Both share this exact same extraction logic —
 * nothing here is duplicated between the two call paths.
 *
 * "Prefer extraction failed over storing bad curriculum data that will
 * contaminate every downstream Topic" — never writes a partial or
 * unvalidated result.
 */
@Injectable()
export class UnitGroundingService {
  private readonly logger = new Logger(UnitGroundingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
    private readonly contextBuilder: AIContextBuilderService,
    private readonly usageService: AIUsageService,
    private readonly storageFactory: CurriculumSourceStorageFactory,
    @Optional() private readonly sharedExtraction?: GroundingSourceExtractionService,
    @Optional() private readonly sharedVision?: GroundingVisionExecutionService,
    @Optional() private readonly progressService?: UnitGroundingProgressService,
  ) {}

  private createTpmPacer() {
    return new UnitGroundingTpmPacer({ log: entry => this.logger.log(JSON.stringify(entry)) });
  }

  async getPreparationStatus(unitId: string) {
    const unit = await this.prisma.client.unit.findUnique({ where: { id: unitId }, select: { groundingNotesJson: true } });
    if (!unit) return { status: "CONFIGURATION_ERROR" as const };
    if (unit.groundingNotesJson) return { status: "READY" as const };
    const progress = this.progressService ? await this.progressService.get(unitId) : null;
    if (progress?.status === "CONFIGURATION_ERROR") return { status: "CONFIGURATION_ERROR" as const };
    return { status: "PREPARING" as const, retryAfterMs: progress?.nextEligibleAt ? Math.max(0, progress.nextEligibleAt.getTime() - Date.now()) : 1500 };
  }

  /**
   * Internal Phase 2 primitive. It deliberately processes one deterministic
   * page chunk only; public lesson orchestration is wired in a later phase.
   */
  async prepareNextGroundingChunk(unitId: string, requestingActorId: string): Promise<BoundedGroundingResult> {
    const progress = this.progressService;
    if (!progress) throw new Error("UnitGroundingProgressService is not configured");
    const unit = await this.prisma.client.unit.findUnique({ where: { id: unitId }, include: { subject: { include: { grade: { include: { curriculum: true } } } } } });
    if (!unit) return { status: "CONFIGURATION_ERROR", reason: "unit_not_found" };
    if (unit.groundingNotesJson) return { status: "READY" };
    const sourceKey = resolveEffectiveSourceFile(unit, unit.subject);
    if (!sourceKey || unit.sourcePageStart == null || unit.sourcePageEnd == null || unit.sourcePageEnd < unit.sourcePageStart) {
      return { status: "CONFIGURATION_ERROR", reason: "source_or_page_range_invalid" };
    }
    const active = await this.providerFactory.getActiveProvider();
    const identity = {
      sourceKey,
      sourceFingerprint: crypto.createHash("sha256").update(`${sourceKey}|${unit.sourcePageStart}-${unit.sourcePageEnd}`).digest("hex"),
      sourcePageStart: unit.sourcePageStart,
      sourcePageEnd: unit.sourcePageEnd,
      promptVersion: GROUNDING_PROMPT_VERSION,
      providerModel: active.model,
      rendererVersion: "pdf-renderer-v1",
    };
    const chunkPlan = [];
    for (let page = unit.sourcePageStart; page <= unit.sourcePageEnd; page += 2) chunkPlan.push({ chunkId: `${page}-${Math.min(page + 1, unit.sourcePageEnd)}`, pageStart: page, pageEnd: Math.min(page + 1, unit.sourcePageEnd) });
    const current = await progress.initialize(unitId, identity, chunkPlan);
    // Production hotfix (2026-09-25): once a Unit has been marked
    // terminally unrecoverable (missing source object, or the retry
    // ceiling below), every later call must keep reporting that — never
    // fall through to claimNextChunk(), whose WHERE clause only matches
    // status "IN_PROGRESS" and would otherwise return null (masked back
    // to a plain, misleading "PREPARING" at the `!chunk` branch below).
    if (current.status === "CONFIGURATION_ERROR") {
      return { status: "CONFIGURATION_ERROR", reason: current.lastErrorCode ?? "grounding_configuration_error" };
    }
    if (current.nextEligibleAt && current.nextEligibleAt > new Date()) return { status: "PREPARING", nextEligibleAt: current.nextEligibleAt, retryAfterMs: current.nextEligibleAt.getTime() - Date.now() };
    const leaseOwner = `${requestingActorId}:${crypto.randomUUID()}`;
    const chunk = await progress.claimNextChunk(unitId, leaseOwner, 120000);
    if (!chunk) return { status: "PREPARING", retryAfterMs: 1500 };
    try {
      const fetched = await this.storageFactory.get().fetchToTempFile(sourceKey, { curriculumCode: unit.subject.grade.curriculum.code, gradeLevel: unit.subject.grade.level });
      const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "smartify-grounding-chunk-"));
      try {
        const rendered = await (this.sharedExtraction ?? new GroundingSourceExtractionService(this.storageFactory)).renderSourcePages(sourceKey, unit.subject.grade.curriculum.code, unit.subject.grade.level, chunk.pageStart, chunk.pageEnd);
        const pages: SizedPage[] = rendered.imageDataUrls.map((image, index) => { const bytes=Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(",")+1),"base64");const d = pngDimensions(bytes); return { page: chunk.pageStart + index, imagePath: "", imageTokens: estimateImageTokens(active.model, d.width, d.height, groundingSizingConfig().detail), imageDataUrl:image.dataUrl } as SizedPage; });
        const textTokens = estimateTextTokens(this.contextBuilder.buildUnitGroundingExtractionPrompt({ curriculumNameEn: unit.subject.grade.curriculum.nameEn, gradeNameEn: unit.subject.grade.nameEn, subjectNameEn: unit.subject.nameEn, unitNameEn: unit.nameEn, pageRangeStart: chunk.pageStart, pageRangeEnd: chunk.pageEnd }) + "Extract the curriculum grounding now.");
        const notes = await this.extractChunk(pages, { curriculumNameEn: unit.subject.grade.curriculum.nameEn, gradeNameEn: unit.subject.grade.nameEn, subjectNameEn: unit.subject.nameEn, subjectNameAr: unit.subject.nameAr, unitNameEn: unit.nameEn }, requestingActorId, unitId, groundingSizingConfig().detail, active, textTokens, this.createTpmPacer(), true);
        await progress.persistChunk(unitId, leaseOwner, { chunkId: chunk.chunkId, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, notes } as GroundingChunkResult, false);
        const after = await progress.get(unitId);
        const done = Array.isArray(after?.completedChunksJson) ? after.completedChunksJson : [];
        if (after && done.length === chunkPlan.length) {
          const merged = mergeGroundingNotes(done.sort((a: any, b: any) => a.pageStart - b.pageStart).map((x: any) => x.notes));
          await progress.finalize(unitId, leaseOwner, { groundingNotesJson: merged as any, groundingVersion: CURRENT_GROUNDING_VERSION, groundingModel: active.model, groundingPromptVersion: GROUNDING_PROMPT_VERSION, groundingSourceFingerprint: identity.sourceFingerprint });
          return { status: "READY" };
        }
        await progress.releaseLease(unitId, leaseOwner);
        return { status: "PREPARING", retryAfterMs: 0 };
      } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); if (fetched.isTemporary) fs.rmSync(path.dirname(fetched.localPath), { recursive: true, force: true }); }
    } catch (err) {
      // Production hotfix (2026-09-25): a missing R2 object (AWS SDK
      // throws an error named exactly "NoSuchKey" — see
      // S3CurriculumSourceStorage.fetchToTempFile) is deterministic: it
      // will never resolve itself by retrying. Narrow, exact name check —
      // never a broad/guessed match — routes it straight to the existing
      // terminal CONFIGURATION_ERROR status instead of RETRYABLE_FAILURE.
      // No storage key, bucket, or exception detail is included in the
      // reason string — ensureTopicHasSteps() already maps
      // CONFIGURATION_ERROR to a single generic, student-safe message
      // (ServiceUnavailableException("This lesson is not available yet.")),
      // so nothing further is needed on the response side.
      if (err instanceof Error && err.name === "NoSuchKey") {
        await progress.markConfigurationError(unitId, leaseOwner, "source_object_not_found");
        return { status: "CONFIGURATION_ERROR", reason: "source_object_not_found" };
      }

      // Provider-outage hotfix (2026-09-26): checked BEFORE the generic
      // retryable/ceiling logic below, using the same isQuotaError() the
      // TPM pacer already trusts (real OpenAI error code/type, e.g.
      // "insufficient_quota" — never a fragile message-string match).
      // Deliberately does NOT call markRetryable/markConfigurationError —
      // this Unit's progress row (status, retryCount, lastErrorCode) is
      // left completely untouched, only its lease is released, so the
      // very next attempt (once the account has credits again) finds it
      // exactly as it was, including every already-completed chunk.
      if (isQuotaError(err)) {
        this.logger.error(`UNIT_GROUNDING_PROVIDER_OUTAGE unitId=${unitId}: provider account has no usable quota/credits — halting without marking this Unit or consuming its retry ceiling: ${err instanceof Error ? err.message : String(err)}`);
        await progress.releaseLease(unitId, leaseOwner);
        return { status: "PROVIDER_OUTAGE", reason: "provider_quota_exhausted" };
      }

      const metadata = err instanceof BoundedGroundingRetryError ? err.metadata : undefined;
      const retryAfterMs = Math.min(120000, Math.max(5000, metadata?.resetTokensMs ?? metadata?.retryAfterMs ?? 5000));
      const nextEligibleAt = new Date(Date.now() + retryAfterMs);
      const reason = metadata ? "provider_rate_limited" : (err instanceof Error ? err.name : "grounding_error");

      // Observability hotfix (2026-09-25): `lastErrorCode` on the DB row
      // only ever held `err.name` (a near-useless generic label like
      // "UnitGroundingExtractionError") and, worse, got fully overwritten
      // by the ceiling branch below — the real underlying cause was
      // provably unrecoverable after the fact (see the
      // cmucxcubj00eh2qd5kfwohz11 incident, 237 retries, no diagnosable
      // log anywhere). Logging err.message/status here — safe: it comes
      // from the SDK's own error object (API-response-derived, never an
      // echo of the request), never prompts/images/textbook/student data.
      const status = (err as { status?: number }).status;
      this.logger.warn(
        `UNIT_GROUNDING_CHUNK_FAILED unitId=${unitId} reason=${reason}: ${err instanceof Error ? err.message : String(err)}${status ? ` status=${status}` : ""}`,
      );

      // Bounded ceiling (2026-09-25): `current.retryCount` reflects
      // consecutive retryable failures SINCE the last successful chunk
      // (persistChunk resets it to 0 on real progress — see
      // UnitGroundingProgressService.persistChunk). Past the ceiling, a
      // failure that keeps recurring is treated as terminal rather than
      // polled forever, exactly like the NoSuchKey case above — this
      // covers any OTHER deterministic-but-unclassified failure mode, not
      // just missing storage objects. A quota/rate-limit retry
      // (BoundedGroundingRetryError) still counts toward this ceiling —
      // it is not exempt — but its own retryAfterMs/resetTokensMs timing
      // is preserved for every attempt up to the ceiling.
      if (current.retryCount + 1 >= MAX_RETRYABLE_ATTEMPTS) {
        // The terminal DB lastErrorCode becomes the generic
        // "retryable_failure_limit_exceeded" (it must stay a single,
        // stable, student-safe code) — but the LAST real reason/message
        // is logged here, one line above the state transition, so it's
        // never lost the way it was in the original incident.
        this.logger.warn(`UNIT_GROUNDING_RETRY_CEILING_REACHED unitId=${unitId} lastRealReason=${reason} retryCount=${current.retryCount + 1}`);
        await progress.markConfigurationError(unitId, leaseOwner, "retryable_failure_limit_exceeded");
        return { status: "CONFIGURATION_ERROR", reason: "retryable_failure_limit_exceeded" };
      }

      await progress.markRetryable(unitId, leaseOwner, nextEligibleAt, reason);
      return { status: "RETRYABLE_FAILURE", retryAfterMs, nextEligibleAt, reason };
    }
  }

  async extractUnitGrounding(
    unitId: string,
    opts: { pdfOverride?: string; pageRangeOverride?: [number, number] },
    requestingUserId: string,
  ): Promise<{ unitId: string; groundingVersion: number; conceptCount: number }> {
    this.logger.log(`GROUNDING_EXTRACTION_STARTED unitId=${unitId}`);

    const unit = await this.prisma.client.unit.findUnique({
      where: { id: unitId },
      include: { subject: { include: { grade: { include: { curriculum: true } } } } },
    });
    if (!unit) throw new NotFoundException(`Unit ${unitId} not found.`);

    const sourceFile = opts.pdfOverride ?? resolveEffectiveSourceFile(unit, unit.subject);
    if (!sourceFile) {
      throw new BadRequestException(`Unit ${unitId} has no source PDF mapped (neither its own sourceFileOverride nor its Subject's sourceFile) — pass --pdf explicitly, or backfill one of them first.`);
    }
    const pageStart = opts.pageRangeOverride?.[0] ?? unit.sourcePageStart;
    const pageEnd = opts.pageRangeOverride?.[1] ?? unit.sourcePageEnd;
    if (pageStart == null || pageEnd == null) {
      throw new BadRequestException(`Unit ${unitId} has no known page range — pass --pages=<start>-<end> explicitly, or backfill Unit.sourcePageStart/sourcePageEnd first.`);
    }
    if (pageEnd - pageStart + 1 > MAX_UNIT_PAGE_COUNT) {
      throw new BadRequestException(`Unit ${unitId}'s page range (${pageStart}-${pageEnd}) is ${pageEnd - pageStart + 1} pages — exceeds the ${MAX_UNIT_PAGE_COUNT}-page limit for a single Unit.`);
    }

    const ctx = {
      curriculumNameEn: unit.subject.grade.curriculum.nameEn,
      gradeNameEn: unit.subject.grade.nameEn,
      subjectNameEn: unit.subject.nameEn,
      subjectNameAr: unit.subject.nameAr,
      unitNameEn: unit.nameEn,
    };

    const generated = await this.generateGroundingForRange(unit, unitId, sourceFile, pageStart, pageEnd, ctx, requestingUserId);
    await this.prisma.client.unit.update({
      where: { id: unitId },
      data: {
        groundingNotesJson: generated.merged as any,
        groundingGeneratedAt: new Date(),
        groundingVersion: CURRENT_GROUNDING_VERSION,
        groundingModel: generated.model,
        groundingPromptVersion: GROUNDING_PROMPT_VERSION,
        groundingSourceFingerprint: generated.pdfFingerprint,
      },
    });
    this.logger.log(`GROUNDING_EXTRACTION_COMPLETED unitId=${unitId} conceptCount=${generated.merged.concepts.length} chunks=${generated.chunkCount}`);
    return { unitId, groundingVersion: CURRENT_GROUNDING_VERSION, conceptCount: generated.merged.concepts.length };
  }

  /**
   * Replacement-grounding primitive for controlled re-grounding (2026-10-02):
   * runs the exact extraction pipeline extractUnitGrounding() uses for the
   * Unit's CURRENT effective source and page range, but persists NOTHING —
   * the caller validates the result and performs its own guarded write, so a
   * failure here can never remove or alter the existing grounding.
   */
  async generateReplacementGrounding(unitId: string, requestingUserId: string): Promise<{ notes: GroundingNotes; model: string; chunkCount: number; sourceKey: string; pageStart: number; pageEnd: number; groundingVersion: number; groundingPromptVersion: string }> {
    const unit = await this.prisma.client.unit.findUnique({ where: { id: unitId }, include: { subject: { include: { grade: { include: { curriculum: true } } } } } });
    if (!unit) throw new NotFoundException(`Unit ${unitId} not found.`);
    const sourceKey = resolveEffectiveSourceFile(unit, unit.subject);
    if (!sourceKey || unit.sourcePageStart == null || unit.sourcePageEnd == null || unit.sourcePageEnd < unit.sourcePageStart) throw new BadRequestException(`Unit ${unitId} has no valid source/page range.`);
    // A range above MAX_UNIT_PAGE_COUNT is processed as several bounded windows (each <= the limit)
    // through the SAME pipeline; nothing is persisted here, so the caller's single guarded write
    // happens only after every window has succeeded.
    const windows = partitionUnitRange(unit.sourcePageStart, unit.sourcePageEnd, MAX_UNIT_PAGE_COUNT);
    const ctx = { curriculumNameEn: unit.subject.grade.curriculum.nameEn, gradeNameEn: unit.subject.grade.nameEn, subjectNameEn: unit.subject.nameEn, subjectNameAr: unit.subject.nameAr, unitNameEn: unit.nameEn };
    if (windows.length > 1) this.logger.log(`GROUNDING_REPLACEMENT_WINDOWS unitId=${unitId} range=${unit.sourcePageStart}-${unit.sourcePageEnd} windows=${windows.map(([a, b]) => `${a}-${b}`).join(",")}`);
    const results = [];
    for (const [windowStart, windowEnd] of windows) results.push(await this.generateGroundingForRange(unit, unitId, sourceKey, windowStart, windowEnd, ctx, requestingUserId));
    if (new Set(results.map((r) => r.model)).size !== 1) throw new Error("Active grounding model changed between extraction windows; replacement aborted.");
    const generated = results.length === 1 ? results[0] : { merged: mergeGroundingNotes(results.flatMap((r) => r.chunkNotes)), model: results[0].model, chunkCount: results.reduce((n, r) => n + r.chunkCount, 0) };
    return { notes: generated.merged, model: generated.model, chunkCount: generated.chunkCount, sourceKey, pageStart: unit.sourcePageStart, pageEnd: unit.sourcePageEnd, groundingVersion: CURRENT_GROUNDING_VERSION, groundingPromptVersion: GROUNDING_PROMPT_VERSION };
  }

  private async generateGroundingForRange(
    unit: { subject: { grade: { level: number; curriculum: { code: string } } } },
    unitId: string,
    sourceFile: string,
    pageStart: number,
    pageEnd: number,
    ctx: { curriculumNameEn: string; gradeNameEn: string; subjectNameEn: string; subjectNameAr?: string | null; unitNameEn: string },
    requestingUserId: string,
  ): Promise<{ merged: GroundingNotes; chunkNotes: GroundingNotes[]; model: string; chunkCount: number; pdfFingerprint: string }> {
    this.logger.log(`CURRICULUM_SOURCE_FETCH_STARTED unitId=${unitId}`);
    let fetched: { localPath: string; isTemporary: boolean };
    try {
      fetched = await this.storageFactory.get().fetchToTempFile(sourceFile, {
        curriculumCode: unit.subject.grade.curriculum.code,
        gradeLevel: unit.subject.grade.level,
      });
      this.logger.log(`CURRICULUM_SOURCE_FETCH_COMPLETED unitId=${unitId}`);
    } catch (err) {
      this.logger.warn(`CURRICULUM_SOURCE_FETCH_FAILED unitId=${unitId}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    const pdfPath = fetched.localPath;

    const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "smartify-grounding-"));
    try {
      const active = await this.providerFactory.getActiveProvider();
      if (active.providerKey !== "openai") throw new Error("Grounding vision sizing currently requires a supported OpenAI model");
      const { detail, target } = groundingSizingConfig();
      const pages: SizedPage[] = [];
      // Render in bounded batches, but plan ALL AI requests before sending any.
      for (const [start, end] of chunkPageRange(pageStart, pageEnd, MAX_PAGES_PER_RENDER)) {
        const rendered = await (this.sharedExtraction ?? new GroundingSourceExtractionService(this.storageFactory)).renderSourcePages(sourceFile, unit.subject.grade.curriculum.code, unit.subject.grade.level, start, end);
        if (rendered.imageDataUrls.length !== end - start + 1) throw new Error("Renderer page count does not match requested range");
        for (let index = 0; index < rendered.imageDataUrls.length; index++) {
          const image=rendered.imageDataUrls[index];const dimensions = pngDimensions(Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(",")+1),"base64"));
          pages.push({ page: start + index, imagePath: "", imageTokens: estimateImageTokens(active.model, dimensions.width, dimensions.height, detail), imageDataUrl:image.dataUrl } as SizedPage);
        }
      }
      const textTokens = (start: number, end: number) => estimateTextTokens(this.contextBuilder.buildUnitGroundingExtractionPrompt({ ...ctx, pageRangeStart: start, pageRangeEnd: end }) + "Extract the curriculum grounding now.");
      const chunks = planGroundingChunks(pages, target, 4000, textTokens);
      const chunkNotes: GroundingNotes[] = [];
      const pacer = this.createTpmPacer();
      for (const chunk of chunks) {
        const chunkStart = chunk[0].page, chunkEnd = chunk[chunk.length - 1].page;
        const chunkEstimatedTokens = textTokens(chunkStart, chunkEnd) + chunk.reduce((sum, page) => sum + page.imageTokens, 0);
        await pacer.waitBeforeNextChunk({ model: active.model, unitId, pageStart: chunkStart, pageEnd: chunkEnd, estimatedTokens: chunkEstimatedTokens });
        const notes = await this.extractChunk(chunk, ctx, requestingUserId, unitId, detail, active, textTokens(chunkStart, chunkEnd), pacer);
        chunkNotes.push(notes);
      }

      const merged = mergeGroundingNotes(chunkNotes);
      return { merged, chunkNotes, model: active.model, chunkCount: chunks.length, pdfFingerprint: this.computeFingerprint(pdfPath, pageStart, pageEnd) };
    } catch (err) {
      this.logger.warn(`GROUNDING_EXTRACTION_FAILED unitId=${unitId}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      // Only ever removes a file WE fetched into a temp location (cloud
      // storage) — a local dev source file (isTemporary: false) is never
      // touched, on success or failure.
      if (fetched.isTemporary) fs.rmSync(path.dirname(fetched.localPath), { recursive: true, force: true });
      this.logger.log(`CURRICULUM_TEMP_FILES_CLEANED unitId=${unitId}`);
    }
  }

  /**
   * Production lazy-grounding entry point (2026-09-19) — the ONLY place a
   * real student's live request ever touches grounding. Called from
   * LessonDraftGeneratorService.ensureTopicHasLesson(), strictly AFTER
   * that method's own Topic-cache check, so an already-generated Topic
   * never reaches here at all (checking the Topic cache before any
   * grounding work is the caller's responsibility, not this method's).
   *
   * Never throws to the caller — every failure mode (no source mapped,
   * no page range, storage unavailable, budget exhausted, extraction/
   * validation failure) resolves to `{used: false}` so the caller can
   * fall back to today's title-only generation. Concurrency-safe across
   * multiple backend instances via a Postgres row-level CAS lock
   * (Unit.groundingLockedAt) — no Redis/advisory-lock/queue involved, and
   * no long-held DB transaction spans the OpenAI call.
   */
  async ensureUnitGrounded(unitId: string, requestingActorId: string): Promise<{ used: boolean; reason?: string }> {
    const unit = await this.prisma.client.unit.findUnique({ where: { id: unitId }, select: { groundingNotesJson: true, sourcePageStart: true, sourcePageEnd: true, subjectId: true, sourceFileOverride: true, subject: { select: { sourceFile: true } } } });
    if (!unit) return { used: false, reason: "unit-not-found" };
    if (unit.groundingNotesJson) return { used: true };

    this.logger.log(`LAZY_GROUNDING_REQUIRED unitId=${unitId}`);

    if (!resolveEffectiveSourceFile(unit, unit.subject)) {
      this.logger.log(`LAZY_GROUNDING_FALLBACK_LEGACY unitId=${unitId} reason=no-source`);
      return { used: false, reason: "no-source" };
    }
    if (unit.sourcePageStart == null || unit.sourcePageEnd == null) {
      this.logger.log(`LAZY_GROUNDING_FALLBACK_LEGACY unitId=${unitId} reason=no-page-range`);
      return { used: false, reason: "no-page-range" };
    }

    // CAS lock claim — deliberately NOT filtering on groundingNotesJson
    // here (Prisma's JSON-column null filters need the Prisma.JsonNull
    // sentinel, not plain `null`, or they silently match nothing — this
    // codebase already hit and documented that exact footgun elsewhere).
    // The re-fetch above already established groundingNotesJson is null;
    // a second concurrent winner between that check and this UPDATE would
    // just re-extract once more, which is wasteful but never corrupts
    // anything — the lock's real job is collapsing the COMMON case (many
    // simultaneous losers) down to one extraction, not achieving perfect
    // exclusion of a microsecond-scale race.
    const staleThreshold = new Date(Date.now() - LOCK_STALE_AFTER_MS);
    const claimed = await this.prisma.client.unit.updateMany({
      where: { id: unitId, groundingNotesJson: { equals: Prisma.JsonNull }, OR: [{ groundingLockedAt: null }, { groundingLockedAt: { lt: staleThreshold } }] },
      data: { groundingLockedAt: new Date(), groundingLockedBy: requestingActorId },
    });

    if (claimed.count === 0) {
      this.logger.log(`LAZY_GROUNDING_WAITING_EXISTING_JOB unitId=${unitId}`);
      const grounded = await pollUntil(async () => {
        const fresh = await this.prisma.client.unit.findUnique({ where: { id: unitId }, select: { groundingNotesJson: true } });
        return !!fresh?.groundingNotesJson;
      }, { intervalMs: GROUNDING_WAIT_POLL_INTERVAL_MS, timeoutMs: GROUNDING_WAIT_TIMEOUT_MS });
      return grounded ? { used: true } : { used: false, reason: "wait-timeout" };
    }

    this.logger.log(`LAZY_GROUNDING_LOCK_ACQUIRED unitId=${unitId}`);
    try {
      await this.extractUnitGrounding(unitId, {}, requestingActorId);
      this.logger.log(`LAZY_GROUNDING_COMPLETED unitId=${unitId}`);
      return { used: true };
    } catch (err) {
      // A budget-reservation refusal surfaces as a plain Error thrown from
      // extractChunk with this exact message prefix — distinguished here
      // so it gets its own, easy-to-alert-on log line rather than being
      // indistinguishable from a genuine extraction/validation failure.
      if (err instanceof Error && err.message.includes("budget reservation refused")) {
        this.logger.warn(`LAZY_GROUNDING_SKIPPED_BUDGET_LIMIT unitId=${unitId}`);
      } else {
        this.logger.warn(`LAZY_GROUNDING_FAILED unitId=${unitId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return { used: false, reason: "extraction-failed" };
    } finally {
      await this.prisma.client.unit.updateMany({ where: { id: unitId }, data: { groundingLockedAt: null, groundingLockedBy: null } });
    }
  }

  /** Sequential token-sized request; financial reservation spans SDK retries. */
  private async extractChunk(
    pages: SizedPage[],
    ctx: { curriculumNameEn: string; gradeNameEn: string; subjectNameEn: string; subjectNameAr?: string | null; unitNameEn: string },
    requestingUserId: string,
    unitId: string,
    detail: ImageDetail,
    active: Awaited<ReturnType<AIProviderFactory["getActiveProvider"]>>,
    textTokens: number,
    pacer: UnitGroundingTpmPacer,
    deferRateLimitWait = false,
  ): Promise<GroundingNotes> {
    const pageStart = pages[0].page, pageEnd = pages[pages.length - 1].page;
    const estimatedInputTokens = textTokens + pages.reduce((sum, p) => sum + p.imageTokens, 0);
    const chunkTag = unitId;
    // Page-provenance hotfix (2026-09-25): each image is preceded by its
    // own "Image N" text label directly in the request — the model must
    // never rely solely on the system prompt's description of ordering.
    // This label, not any page number, is what a valid sourceImageIndex
    // must refer back to (see unit-grounding-validator.ts).
    const imageParts = pages.flatMap((page:any, index) => [
      { type: "text" as const, text: `Image ${index + 1}:` },
      { type: "image_url" as const, image_url: { url: page.imageDataUrl ?? `data:image/png;base64,${fs.readFileSync(page.imagePath).toString("base64")}`, detail } },
    ]);

    const systemPrompt = this.contextBuilder.buildUnitGroundingExtractionPrompt({ ...ctx, pageRangeStart: pageStart, pageRangeEnd: pageEnd });
    let lastErrors: string[] = [];
    const vision = this.sharedVision ?? new GroundingVisionExecutionService(this.prisma, this.providerFactory, this.usageService);
    const accountingContext = await vision.createAccountingContext({ inputText: systemPrompt, estimatedInputTokens, maxOutputTokens: 4000 });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { model } = active;

      let executed: Awaited<ReturnType<GroundingVisionExecutionService["execute"]>>;
      for (let transportAttempt = 1; transportAttempt <= MAX_TPM_TRANSPORT_ATTEMPTS; transportAttempt++) {
        try {
          executed = await vision.execute({ systemPrompt, messages: [{ role: "user", content: [{ type: "text", text: "Extract the curriculum grounding now." }, ...imageParts] }], diagnostics: { operation: "unit_grounding", unitId, pageStart, pageEnd, estimatedInputTokens }, feature: "grounding_extraction", estimatedInputTokens, maxOutputTokens: 4000, accountingContext });
          break;
        } catch (err) {
          if (isQuotaError(err) || (err as { status?: number }).status !== 429 || transportAttempt === MAX_TPM_TRANSPORT_ATTEMPTS) { await vision.finalizeFailure(accountingContext); throw err; }
          const rawHeaders = (err as { headers?: Headers | Record<string, string> }).headers;
          const headers = rawHeaders && typeof (rawHeaders as Headers).get === "function" ? rawHeaders as Headers : new Headers(rawHeaders);
          const metadata = tokenRateLimitMetadata(headers) as TokenRateLimitMetadata;
          if (deferRateLimitWait) { await vision.finalizeFailure(accountingContext); throw new BoundedGroundingRetryError(metadata); }
          await pacer.waitAfterTpm429({ model, unitId, pageStart, pageEnd, estimatedTokens: estimatedInputTokens }, metadata, transportAttempt);
        }
      }
      if (!executed!) throw new Error("Grounding provider returned no result.");
      const result = executed.result;
      pacer.recordSuccessfulResponse(result.rateLimit);
      let parsed: unknown;
      try { parsed = JSON.parse(result.content); } catch { lastErrors=["Response was not valid JSON."]; continue; }
      const validation = validateGroundingNotes(parsed, { unitNameEn: ctx.unitNameEn, subjectNameEn: ctx.subjectNameEn, subjectNameAr: ctx.subjectNameAr, imageCount: pages.length });
      if (validation.valid && validation.notes) { await vision.finalizeSuccess(accountingContext); return remapSourceImageIndexToPages(validation.notes, pages); }
      lastErrors = validation.errors;
      this.logger.warn(`GROUNDING_VALIDATION_FAILED chunkTag=${chunkTag} pages=${pageStart}-${pageEnd} attempt=${attempt}: ${validation.errors.join("; ")}`);
    }
    this.logger.warn(`GROUNDING_EXTRACTION_EXHAUSTED chunkTag=${chunkTag} pages=${pageStart}-${pageEnd} after ${MAX_ATTEMPTS} attempt(s): ${lastErrors.join("; ")}`);
    await vision.finalizeFailure(accountingContext);
    throw new UnitGroundingExtractionError(`Grounding extraction failed validation for pages ${pageStart}-${pageEnd} after ${MAX_ATTEMPTS} attempt(s).`, lastErrors);
  }

  private computeFingerprint(pdfPath: string, pageStart: number, pageEnd: number): string {
    const hash = crypto.createHash("sha256"); hash.update(fs.readFileSync(pdfPath)); hash.update(`|${pageStart}-${pageEnd}|${GROUNDING_PROMPT_VERSION}`); return hash.digest("hex");
  }
}
