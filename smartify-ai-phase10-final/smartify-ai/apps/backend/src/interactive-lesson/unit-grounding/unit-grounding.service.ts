import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../../ai/ai-provider.factory";
import { AIContextBuilderService } from "../../ai/context/ai-context-builder.service";
import { AIUsageService } from "../../ai/usage/ai-usage.service";
import { validateGroundingNotes } from "./unit-grounding-validator";
import type { GroundingNotes } from "./unit-grounding.types";
import { CurriculumSourceStorageFactory } from "./storage/curriculum-source-storage.factory";
import { resolveEffectiveSourceFile } from "./unit-effective-source.util";

const execFileAsync = promisify(execFile);

const MAX_ATTEMPTS = 2; // one initial attempt + one corrective retry — same bound as every other AI-generation loop in this codebase
const MAX_PAGES_PER_CALL = 10; // caps vision-token cost per call; a larger Unit range runs multiple sequential calls, merged into one GroundingNotes
const MAX_UNIT_PAGE_COUNT = 40; // a sane ceiling on a single Unit's total page range — protects against an accidentally huge manifest range being silently rendered/processed in full
const IMAGE_TOKEN_ESTIMATE = 1500; // conservative per-page-image token estimate for the pre-call budget check (estimateMaxChatCostUsd is text-length-based and has no native image-cost model)
const CHARS_PER_TOKEN_CONSERVATIVE = 3; // mirrors AIUsageService's own constant, so the image padding is expressed in the same unit
const PYTHON_RENDER_SCRIPT = path.join(__dirname, "..", "..", "..", "..", "..", "packages", "database", "prisma", "tools", "render_pdf_pages.py");
const CURRENT_GROUNDING_VERSION = 1; // bump only when the extraction schema/methodology changes in a way that makes old groundingNotesJson stale
const GROUNDING_PROMPT_VERSION = "grounding-extraction-v1";

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
  ) {}

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
      const chunkRanges = chunkPageRange(pageStart, pageEnd, MAX_PAGES_PER_CALL);
      const chunkNotes: GroundingNotes[] = [];

      for (const [chunkStart, chunkEnd] of chunkRanges) {
        const notes = await this.extractChunk(pdfPath, chunkStart, chunkEnd, ctx, requestingUserId, tmpDir, unit.subjectId + ":" + unit.id);
        chunkNotes.push(notes);
      }

      const merged = mergeGroundingNotes(chunkNotes);
      const fingerprint = this.computeFingerprint(pdfPath, pageStart, pageEnd);
      const { model } = await this.providerFactory.getActiveProvider();

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
      this.logger.log(`GROUNDING_EXTRACTION_COMPLETED unitId=${unitId} conceptCount=${merged.concepts.length} chunks=${chunkRanges.length}`);
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

  /** One page-range chunk (<= MAX_PAGES_PER_CALL pages): render -> AI call -> validate, with its own MAX_ATTEMPTS retry. Never writes anything — the caller merges and persists once ALL chunks succeed. */
  private async extractChunk(
    pdfPath: string,
    pageStart: number,
    pageEnd: number,
    ctx: { curriculumNameEn: string; gradeNameEn: string; subjectNameEn: string; unitNameEn: string },
    requestingUserId: string,
    tmpDir: string,
    chunkTag: string,
  ): Promise<GroundingNotes> {
    const chunkDir = fs.mkdtempSync(path.join(tmpDir, `chunk-${pageStart}-${pageEnd}-`));
    let imagePaths: string[];
    try {
      const { stdout } = await execFileAsync("python", [PYTHON_RENDER_SCRIPT, pdfPath, String(pageStart), String(pageEnd), chunkDir]);
      imagePaths = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (imagePaths.length === 0) throw new Error("Page renderer produced no images.");
    } catch (err) {
      throw new Error(`Rendering pages ${pageStart}-${pageEnd} failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const imageParts = imagePaths.map((p) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/png;base64,${fs.readFileSync(p).toString("base64")}` },
    }));

    const systemPrompt = this.contextBuilder.buildUnitGroundingExtractionPrompt({ ...ctx, pageRangeStart: pageStart, pageRangeEnd: pageEnd });
    let lastErrors: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();

      const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({
        providerKey,
        inputText: systemPrompt + "x".repeat(imageParts.length * IMAGE_TOKEN_ESTIMATE * CHARS_PER_TOKEN_CONSERVATIVE),
        maxOutputTokens: 4000,
      });
      const reserveResult = await this.usageService.reserveBudget(requestingUserId, estimatedUsd);
      if (!reserveResult.ok) {
        throw new Error(`Grounding extraction budget reservation refused (${reserveResult.reason}) for pages ${pageStart}-${pageEnd}.`);
      }
      const budgetReservationId = reserveResult.reservationId;

      let result: Awaited<ReturnType<typeof provider.generate>>;
      try {
        result = await provider.generate({
          systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: "Extract the curriculum grounding now." }, ...imageParts] }],
          responseFormat: "json_object",
          maxOutputTokens: 4000,
        });
      } catch (err) {
        await this.usageService.releaseBudget(budgetReservationId).catch(() => undefined);
        throw err;
      }

      const rates = await this.providerFactory.getCostRates(providerKey);
      const actualCostUsd = result.inputTokens * rates.costPerInputToken + result.outputTokens * rates.costPerOutputToken;
      await this.prisma.client.aIUsage
        .create({
          data: {
            userId: requestingUserId,
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
        requestedPageRange: { start: pageStart, end: pageEnd },
      });
      if (validation.valid && validation.notes) return validation.notes;

      lastErrors = validation.errors;
      this.logger.warn(`GROUNDING_VALIDATION_FAILED chunkTag=${chunkTag} pages=${pageStart}-${pageEnd} attempt=${attempt}: ${validation.errors.join("; ")}`);
    }

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
