import { estimateImageTokens, estimateTextTokens, groundingSizingConfig, planGroundingChunks, pngDimensions, type ImageDetail, type SizedPage } from "../../ai/vision-request-sizing";
import { invokePdfRenderer } from "./pdf-renderer-runtime";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
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
const MAX_UNIT_PAGE_COUNT = 40; // a sane ceiling on a single Unit's total page range — protects against an accidentally huge manifest range being silently rendered/processed in full

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
  | { status: "CONFIGURATION_ERROR"; reason: string };

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
        const { stdout } = await invokePdfRenderer([fetched.localPath, String(chunk.pageStart), String(chunk.pageEnd), tmpDir]);
        const imagePaths = stdout.split("\n").map(p => p.trim()).filter(Boolean);
        const pages: SizedPage[] = imagePaths.map((imagePath, index) => { const d = pngDimensions(fs.readFileSync(imagePath)); return { page: chunk.pageStart + index, imagePath, imageTokens: estimateImageTokens(active.model, d.width, d.height, groundingSizingConfig().detail) }; });
        const textTokens = estimateTextTokens(this.contextBuilder.buildUnitGroundingExtractionPrompt({ curriculumNameEn: unit.subject.grade.curriculum.nameEn, gradeNameEn: unit.subject.grade.nameEn, subjectNameEn: unit.subject.nameEn, unitNameEn: unit.nameEn, pageRangeStart: chunk.pageStart, pageRangeEnd: chunk.pageEnd }) + "Extract the curriculum grounding now.");
        const notes = await this.extractChunk(pages, { curriculumNameEn: unit.subject.grade.curriculum.nameEn, gradeNameEn: unit.subject.grade.nameEn, subjectNameEn: unit.subject.nameEn, unitNameEn: unit.nameEn }, requestingActorId, unitId, groundingSizingConfig().detail, active, textTokens, this.createTpmPacer(), true);
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
      unitNameEn: unit.nameEn,
    };

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
        const { stdout } = await invokePdfRenderer([pdfPath, String(start), String(end), tmpDir]);
        const paths = stdout.split("\n").map(p => p.trim()).filter(Boolean);
        if (paths.length !== end - start + 1) throw new Error("Renderer page count does not match requested range");
        for (let index = 0; index < paths.length; index++) {
          const dimensions = pngDimensions(fs.readFileSync(paths[index]));
          pages.push({ page: start + index, imagePath: paths[index], imageTokens: estimateImageTokens(active.model, dimensions.width, dimensions.height, detail) });
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
      const fingerprint = this.computeFingerprint(pdfPath, pageStart, pageEnd);
      const { model } = active;

      await this.prisma.client.unit.update({
        where: { id: unitId },
        data: {
          groundingNotesJson: merged as any,
          groundingGeneratedAt: new Date(),
          groundingVersion: CURRENT_GROUNDING_VERSION,
          groundingModel: model,
          groundingPromptVersion: GROUNDING_PROMPT_VERSION,
          groundingSourceFingerprint: fingerprint,
        },
      });
      this.logger.log(`GROUNDING_EXTRACTION_COMPLETED unitId=${unitId} conceptCount=${merged.concepts.length} chunks=${chunks.length}`);
      return { unitId, groundingVersion: CURRENT_GROUNDING_VERSION, conceptCount: merged.concepts.length };
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
      where: { id: unitId, OR: [{ groundingLockedAt: null }, { groundingLockedAt: { lt: staleThreshold } }] },
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
    ctx: { curriculumNameEn: string; gradeNameEn: string; subjectNameEn: string; unitNameEn: string },
    requestingUserId: string,
    unitId: string,
    detail: ImageDetail,
    active: Awaited<ReturnType<AIProviderFactory["getActiveProvider"]>>,
    textTokens: number,
    pacer: UnitGroundingTpmPacer,
    deferRateLimitWait = false,
  ): Promise<GroundingNotes> {
    const pageStart = pages[0].page, pageEnd = pages[pages.length - 1].page;
    const imagePaths = pages.map(p => p.imagePath);
    const estimatedInputTokens = textTokens + pages.reduce((sum, p) => sum + p.imageTokens, 0);
    const chunkTag = unitId;
    // Page-provenance hotfix (2026-09-25): each image is preceded by its
    // own "Image N" text label directly in the request — the model must
    // never rely solely on the system prompt's description of ordering.
    // This label, not any page number, is what a valid sourceImageIndex
    // must refer back to (see unit-grounding-validator.ts).
    const imageParts = imagePaths.flatMap((p, index) => [
      { type: "text" as const, text: `Image ${index + 1}:` },
      { type: "image_url" as const, image_url: { url: `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`, detail } },
    ]);

    const systemPrompt = this.contextBuilder.buildUnitGroundingExtractionPrompt({ ...ctx, pageRangeStart: pageStart, pageRangeEnd: pageEnd });
    let lastErrors: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { provider, providerKey, model } = active;

      const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({
        providerKey,
        inputText: systemPrompt,
        estimatedInputTokens,
        maxOutputTokens: 4000,
      });
      // Grounding is platform-funded infrastructure. The triggering actor is
      // retained for locking/diagnostics, but must never consume a student's
      // per-user budget or be able to block extraction via that budget.
      const reserveResult = await this.usageService.reserveBudget(CONTENT_AUTHORING_ACTOR_ID, estimatedUsd);
      if (!reserveResult.ok) {
        throw new Error(`Grounding extraction budget reservation refused (${reserveResult.reason}) for pages ${pageStart}-${pageEnd}.`);
      }
      const budgetReservationId = reserveResult.reservationId;

      let result: Awaited<ReturnType<typeof provider.generate>> | undefined;
      try {
        for (let transportAttempt = 1; transportAttempt <= MAX_TPM_TRANSPORT_ATTEMPTS; transportAttempt++) {
          try {
            result = await provider.generate({
              systemPrompt,
              messages: [{ role: "user", content: [{ type: "text", text: "Extract the curriculum grounding now." }, ...imageParts] }],
              diagnostics: { operation: "unit_grounding", unitId, pageStart, pageEnd, estimatedInputTokens },
              responseFormat: "json_object",
              maxOutputTokens: 4000,
              transportRetryMode: "none",
            });
            break;
          } catch (err) {
            if (isQuotaError(err) || (err as { status?: number }).status !== 429 || transportAttempt === MAX_TPM_TRANSPORT_ATTEMPTS) throw err;
            const rawHeaders = (err as { headers?: Headers | Record<string, string> }).headers;
            const headers = rawHeaders && typeof (rawHeaders as Headers).get === "function" ? rawHeaders as Headers : new Headers(rawHeaders);
            const metadata = tokenRateLimitMetadata(headers) as TokenRateLimitMetadata;
            if (deferRateLimitWait) throw new BoundedGroundingRetryError(metadata);
            await pacer.waitAfterTpm429({ model, unitId, pageStart, pageEnd, estimatedTokens: estimatedInputTokens }, metadata, transportAttempt);
          }
        }
        if (!result) throw new Error("Grounding provider returned no result.");
      } catch (err) {
        // Observability hotfix (2026-09-25): previously this raw provider
        // failure was completely unlogged — only the generic, error-
        // agnostic "budget released (provider call did not complete)"
        // line existed (AIUsageService.releaseBudget). err.name/message/
        // status come from the OpenAI SDK's own error object, derived
        // from the API's response — never an echo of the request payload
        // — so this is safe: no prompt text, no image/base64 data, no
        // textbook or student content.
        const status = (err as { status?: number }).status;
        this.logger.warn(
          `GROUNDING_PROVIDER_CALL_FAILED chunkTag=${chunkTag} pages=${pageStart}-${pageEnd} attempt=${attempt}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}${status ? ` status=${status}` : ""}`,
        );
        await this.usageService.releaseBudget(budgetReservationId).catch(() => undefined);
        throw err;
      }
      pacer.recordSuccessfulResponse(result.rateLimit);

      const rates = await this.providerFactory.getCostRates(providerKey);
      const actualCostUsd = result.inputTokens * rates.costPerInputToken + result.outputTokens * rates.costPerOutputToken;
      await this.prisma.client.aIUsage
        .create({
          data: {
            userId: CONTENT_AUTHORING_ACTOR_ID,
            studentId: null,
            subjectId: null,
            feature: "grounding_extraction",
            provider: providerKey,
            model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            creditsUsed: 0,
            costUsd: actualCostUsd,
          },
        })
        .catch((err) => this.logger.warn(`Usage log failed (extraction still completed): ${err instanceof Error ? err.message : String(err)}`));
      await this.usageService.reconcileBudget(budgetReservationId, actualCostUsd).catch(() => undefined);

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.content);
      } catch {
        lastErrors = ["Response was not valid JSON."];
        this.logger.warn(`Grounding extraction attempt ${attempt} for ${chunkTag} pages ${pageStart}-${pageEnd} produced invalid JSON.`);
        continue;
      }

      const validation = validateGroundingNotes(parsed, {
        unitNameEn: ctx.unitNameEn,
        subjectNameEn: ctx.subjectNameEn,
        imageCount: pages.length,
      });
      // Page-provenance hotfix (2026-09-25): the model's sourceImageIndex
      // ordinals are deterministically translated to REAL PDF page
      // numbers here — never trusted from the model directly. See
      // unit-grounding-page-remap.util.ts's doc comment.
      if (validation.valid && validation.notes) return remapSourceImageIndexToPages(validation.notes, pages);

      lastErrors = validation.errors;
      this.logger.warn(`GROUNDING_VALIDATION_FAILED chunkTag=${chunkTag} pages=${pageStart}-${pageEnd} attempt=${attempt}: ${validation.errors.join("; ")}`);
    }

    // Observability hotfix (2026-09-25): each attempt's validation errors
    // were already logged individually above as they happened; this final
    // summary line (with the SAME lastErrors the thrown error itself
    // carries) is what a Railway-logs search for this chunkTag actually
    // finds first, without needing to reconstruct the attempt sequence.
    this.logger.warn(`GROUNDING_EXTRACTION_EXHAUSTED chunkTag=${chunkTag} pages=${pageStart}-${pageEnd} after ${MAX_ATTEMPTS} attempt(s): ${lastErrors.join("; ")}`);
    throw new UnitGroundingExtractionError(`Grounding extraction failed validation for pages ${pageStart}-${pageEnd} after ${MAX_ATTEMPTS} attempt(s).`, lastErrors);
  }

  /** sha256 of (PDF bytes + page range + extraction-prompt version) — detects a changed source without storing any textbook content. */
  private computeFingerprint(pdfPath: string, pageStart: number, pageEnd: number): string {
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(pdfPath));
    hash.update(`|${pageStart}-${pageEnd}|${GROUNDING_PROMPT_VERSION}`);
    return hash.digest("hex");
  }
}
