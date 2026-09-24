import { invokePdfRenderer } from "../../../interactive-lesson/unit-grounding/pdf-renderer-runtime";
import { isQuotaError } from "../../../ai/providers/openai-request-diagnostics";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import pdfParse from "pdf-parse";
import { PrismaService } from "../../../prisma/prisma.service";
import { AIProviderFactory } from "../../../ai/ai-provider.factory";
import { AIContextBuilderService } from "../../../ai/context/ai-context-builder.service";
import { AIUsageService } from "../../../ai/usage/ai-usage.service";
import { CurriculumSourceStorageFactory } from "../../../interactive-lesson/unit-grounding/storage/curriculum-source-storage.factory";
import { validateTocExtraction } from "./toc-extraction-validator";
import { validateFullBookScanChunk, type HeadingDetection } from "./full-book-scan-validator";
import { mergeHeadingsIntoUnits } from "./full-book-scan-merge";
import type { TocExtractionResult } from "./toc-extraction.types";


const MAX_ATTEMPTS = 2; // one initial attempt + one corrective retry — same bound as UnitGroundingService's own extraction loop
// Conservative, documented V1 bound (spec section 8): a textbook's table of
// contents is almost always within its first ~10-20 pages. Rather than
// chunk a wide window across multiple AI calls (which would force merging
// a hierarchical Unit/Topic listing split across calls — much harder to
// get right than merging grounding notes), each window is small enough to
// fit in ONE vision call. If window 1 finds nothing, exactly one more
// window is tried; there is no window 3 — a PDF whose TOC isn't within its
// first 20 pages is out of scope for V1 (structure must then be entered
// manually, or the tool extended deliberately later).
const TOC_WINDOW_PAGES = 10;
const MAX_TOC_WINDOWS = 2;
const IMAGE_TOKEN_ESTIMATE = 1500; // mirrors UnitGroundingService's own per-page-image token estimate
const CHARS_PER_TOKEN_CONSERVATIVE = 3;


// Extra Book full-book structure-scan fallback (2026-09-20) — only used
// when the fast TOC-listing search above finds nothing (spec: "story books
// often have no TOC"). Non-overlapping sequential chunks cover the WHOLE
// book exactly once each (never re-analyzing a page), 12 pages per chunk
// (within the spec's suggested 10-15 range) — one AI call per chunk, no
// confidence-based early-stop (that would risk silently truncating a
// book's later chapters; a hard page ceiling is the safer, predictable
// cost bound instead). MAX_FULL_SCAN_CHUNKS=20 * 12 pages = a 240-page
// ceiling, comfortably above the spec's own 200-page cost-estimate
// example; a book longer than that is scanned only up to the ceiling
// (surfaced to the admin via the returned pagesInspected range, exactly
// like the fast-TOC path's own bound).
const FULL_SCAN_CHUNK_PAGES = 12;
const MAX_FULL_SCAN_CHUNKS = 20;

export class TocExtractionError extends Error {
  constructor(
    message: string,
    readonly lastErrors: string[],
  ) {
    super(message);
    this.name = "TocExtractionError";
  }
}

export interface TocExtractionOutcome extends TocExtractionResult {
  pdfPageCount: number;
  pagesInspected: { start: number; end: number };
}

/**
 * Admin New Subject + Textbook Ingestion V1 (2026-09-20) — reads a
 * textbook's own front pages to propose a Unit/Topic structure for a human
 * admin to review and edit before anything is created. Deliberately
 * separate from UnitGroundingService (which reads a Unit's real teaching
 * content, once grounding/page ranges already exist) — this runs BEFORE
 * any Unit exists at all, to help establish those page ranges in the
 * first place. Shares the same PDF-page-renderer script, the same
 * AIProviderFactory/AIUsageService infrastructure, and the same
 * CONTENT_AUTHORING_ACTOR_ID billing actor (passed in by the caller) as
 * every other content-authoring AI call in this codebase — never billed
 * to a real student, and never bypasses the platform budget system.
 *
 * Writes nothing to the database — pure extraction. AdminCurriculumService
 * is the only place a resulting structure is ever persisted, and only
 * after a second, independent server-side validation pass at confirmation
 * time (see confirmSubjectStructure).
 */
@Injectable()
export class TocExtractionService {
  private readonly logger = new Logger(TocExtractionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: AIProviderFactory,
    private readonly contextBuilder: AIContextBuilderService,
    private readonly usageService: AIUsageService,
    private readonly storageFactory: CurriculumSourceStorageFactory,
  ) {}

  /**
   * Confirmation-time re-validation helper (2026-09-20) — fetches a
   * Subject's own stored PDF and returns just its page count, no AI call.
   * Used by AdminCurriculumService.confirmSubjectStructure() (and its
   * extra-book counterpart) to re-derive the real page-count bound and
   * re-run validateTocExtraction() against the admin-edited payload,
   * rather than trusting whatever bound the client happens to send back.
   * `opts.sourceOverride` (English Extra Book / Story support V1,
   * 2026-09-20), when given, reads THAT object key instead of
   * Subject.sourceFile — the extra-book confirm flow uses this to derive
   * the page count of the extra PDF, never the Subject's main textbook.
   * Deliberately separate from extract() — that method keeps the fetched
   * file around for the whole multi-window extraction; this one fetches,
   * reads, and cleans up immediately.
   */
  async getPageCount(subjectId: string, opts: { sourceOverride?: string } = {}): Promise<number> {
    const subject = await this.prisma.client.subject.findUnique({
      where: { id: subjectId },
      include: { grade: { include: { curriculum: true } } },
    });
    if (!subject) throw new NotFoundException(`Subject ${subjectId} not found.`);
    const sourceFile = opts.sourceOverride ?? subject.sourceFile;
    if (!sourceFile) throw new BadRequestException("This subject has no textbook uploaded.");

    const fetched = await this.storageFactory.get().fetchToTempFile(sourceFile, {
      curriculumCode: subject.grade.curriculum.code,
      gradeLevel: subject.grade.level,
    });
    try {
      const buffer = fs.readFileSync(fetched.localPath);
      const { numpages } = await pdfParse(buffer);
      if (!numpages || numpages < 1) throw new BadRequestException("This PDF appears to have no pages.");
      return numpages;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Could not read this PDF to determine its page count: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (fetched.isTemporary) fs.rmSync(path.dirname(fetched.localPath), { recursive: true, force: true });
    }
  }

  /**
   * `opts.sourceOverride` (English Extra Book / Story support V1,
   * 2026-09-20): when given, analyzes THAT object key (an already-
   * verified extra-book PDF, never a client-supplied raw key — see
   * AdminCurriculumService.analyzeExtraBook) instead of the Subject's
   * main textbook, and skips the "Subject must have zero Units yet"
   * guard below (an extra book is, by definition, added to a Subject
   * that already has its own main-textbook Units — that guard exists
   * only for the brand-new-Subject case).
   *
   * `opts.fullScanFallback` (Extra Book full-book structure-scan fallback,
   * 2026-09-20): when true AND the fast TOC-listing search above finds
   * nothing, automatically falls back to fullBookStructureScan() instead
   * of failing outright — see that method's own doc comment. Only the
   * Extra Book Analyze flow passes this; the New Subject flow's own
   * analyzeSubjectTextbook() never does, so its behavior is byte-for-byte
   * unchanged.
   */
  async extract(subjectId: string, requestingActorId: string, opts: { sourceOverride?: string; fullScanFallback?: boolean } = {}): Promise<TocExtractionOutcome> {
    const subject = await this.prisma.client.subject.findUnique({
      where: { id: subjectId },
      include: { grade: { include: { curriculum: true } } },
    });
    if (!subject) throw new NotFoundException(`Subject ${subjectId} not found.`);
    const sourceFile = opts.sourceOverride ?? subject.sourceFile;
    if (!sourceFile) throw new BadRequestException("Upload a textbook before analyzing it.");

    if (!opts.sourceOverride) {
      const existingUnitCount = await this.prisma.client.unit.count({ where: { subjectId } });
      if (existingUnitCount > 0) {
        throw new BadRequestException("This subject already has curriculum structure — table-of-contents analysis is only available before confirmation.");
      }
    }

    this.logger.log(`TOC_EXTRACTION_STARTED subjectId=${subjectId}`);

    let fetched: { localPath: string; isTemporary: boolean };
    try {
      fetched = await this.storageFactory.get().fetchToTempFile(sourceFile, {
        curriculumCode: subject.grade.curriculum.code,
        gradeLevel: subject.grade.level,
      });
    } catch (err) {
      this.logger.warn(`TOC_EXTRACTION_SOURCE_FETCH_FAILED subjectId=${subjectId}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    const ctx = {
      curriculumNameEn: subject.grade.curriculum.nameEn,
      gradeNameEn: subject.grade.nameEn,
      subjectNameEn: subject.nameEn,
    };

    const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "smartify-toc-extraction-"));
    try {
      let numpages: number;
      try {
        const buffer = fs.readFileSync(fetched.localPath);
        numpages = (await pdfParse(buffer)).numpages;
      } catch (err) {
        throw new BadRequestException(`Could not read this PDF to determine its page count: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!numpages || numpages < 1) throw new BadRequestException("This PDF appears to have no pages.");

      let extraction: TocExtractionResult = { units: [] };
      let pagesInspected = { start: 1, end: Math.min(TOC_WINDOW_PAGES, numpages) };

      for (let windowIndex = 0; windowIndex < MAX_TOC_WINDOWS; windowIndex++) {
        const start = windowIndex * TOC_WINDOW_PAGES + 1;
        if (start > numpages) break;
        const end = Math.min(start + TOC_WINDOW_PAGES - 1, numpages);
        pagesInspected = { start, end };

        try {
          extraction = await this.extractWindowWithRetry(fetched.localPath, start, end, ctx, requestingActorId, tmpDir, numpages);
        } catch (err) {
          if (err instanceof TocExtractionError) {
            this.logger.log(`TOC_EXTRACTION_WINDOW_EMPTY subjectId=${subjectId} pages=${start}-${end}: ${err.message}`);
            extraction = { units: [] };
          } else {
            throw err; // rendering / budget / provider failures propagate immediately — never silently retried as "just try the next window"
          }
        }

        if (extraction.units.length > 0) break;
      }

      if (extraction.units.length === 0 && opts.fullScanFallback) {
        this.logger.log(`TOC_EXTRACTION_FALLBACK_TO_FULL_SCAN subjectId=${subjectId}`);
        const scan = await this.fullBookStructureScan(fetched.localPath, numpages, ctx, requestingActorId, tmpDir);
        extraction = scan.result;
        pagesInspected = scan.pagesScanned;
      }

      if (extraction.units.length === 0) {
        throw new BadRequestException(
          opts.fullScanFallback
            ? `Could not detect any chapter/section structure in this PDF (checked pages ${pagesInspected.start}-${pagesInspected.end} of ${numpages}). Use "Enter Structure Manually" instead.`
            : `Could not find a usable table of contents in pages ${1}-${pagesInspected.end} of this PDF. TOC extraction only inspects the beginning of the textbook in V1 — add Units/Topics manually if this book's contents listing is elsewhere.`,
        );
      }

      this.logger.log(`TOC_EXTRACTION_COMPLETED subjectId=${subjectId} units=${extraction.units.length} pages=${pagesInspected.start}-${pagesInspected.end}`);
      return { ...extraction, pdfPageCount: numpages, pagesInspected };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (fetched.isTemporary) fs.rmSync(path.dirname(fetched.localPath), { recursive: true, force: true });
    }
  }

  /** Shared by extractWindowWithRetry and scanChunkWithRetry — renders one non-overlapping page range to images. Each page is rendered by exactly one chunk, never twice. */
  private async renderPageChunkImages(pdfPath: string, start: number, end: number, tmpDir: string, tag: string): Promise<Array<{ type: "image_url"; image_url: { url: string } }>> {
    const chunkDir = fs.mkdtempSync(path.join(tmpDir, `${tag}-${start}-${end}-`));
    let imagePaths: string[];
    try {
      const { stdout } = await invokePdfRenderer([pdfPath, String(start), String(end), chunkDir]);
      imagePaths = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
      if (imagePaths.length === 0) throw new Error("Page renderer produced no images.");
    } catch (err) {
      throw new Error(`Rendering pages ${start}-${end} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return imagePaths.map((p) => ({ type: "image_url" as const, image_url: { url: `data:image/png;base64,${fs.readFileSync(p).toString("base64")}` } }));
  }

  /**
   * Extra Book full-book structure-scan fallback (2026-09-20) — only
   * called from extract() when the fast TOC-listing search finds nothing
   * AND the caller opted in via opts.fullScanFallback. Scans the WHOLE
   * document in non-overlapping FULL_SCAN_CHUNK_PAGES-page chunks (never
   * re-reading a page), one AI vision call per chunk (with its own
   * MAX_ATTEMPTS corrective retry), collecting every detected chapter/
   * section-start heading, then merges them into a Unit/Topic tree via
   * mergeHeadingsIntoUnits and re-validates the ASSEMBLED result through
   * the exact same validateTocExtraction used everywhere else (spec
   * section 8) — never trusting the merge's own output blindly. Bounded
   * to MAX_FULL_SCAN_CHUNKS chunks; a longer PDF is only scanned up to
   * that ceiling (reflected in the returned pagesScanned range).
   */
  private async fullBookStructureScan(
    pdfPath: string,
    pdfPageCount: number,
    ctx: { curriculumNameEn: string; gradeNameEn: string; subjectNameEn: string },
    requestingActorId: string,
    tmpDir: string,
  ): Promise<{ result: TocExtractionResult; pagesScanned: { start: number; end: number } }> {
    const allHeadings: HeadingDetection[] = [];
    let lastEnd = 0;
    const totalChunks = Math.min(MAX_FULL_SCAN_CHUNKS, Math.ceil(pdfPageCount / FULL_SCAN_CHUNK_PAGES));

    for (let chunkIndex = 0; chunkIndex < MAX_FULL_SCAN_CHUNKS; chunkIndex++) {
      const start = chunkIndex * FULL_SCAN_CHUNK_PAGES + 1;
      if (start > pdfPageCount) break;
      const end = Math.min(start + FULL_SCAN_CHUNK_PAGES - 1, pdfPageCount);
      lastEnd = end;

      // Logged before the call so a hung/slow chunk (e.g. a rate-limited
      // provider retrying internally, or a genuinely long request) is
      // immediately identifiable in logs by exact chunk/page range while
      // still in progress, not only after it finishes or fails.
      this.logger.log(`FULL_BOOK_SCAN_CHUNK_STARTED chunk=${chunkIndex + 1}/${totalChunks} pages=${start}-${end}`);
      const headings = await this.scanChunkWithRetry(pdfPath, start, end, ctx, requestingActorId, tmpDir);
      this.logger.log(`FULL_BOOK_SCAN_CHUNK_FINISHED chunk=${chunkIndex + 1}/${totalChunks} pages=${start}-${end} headingsFound=${headings.length}`);
      allHeadings.push(...headings);
    }

    const pagesScanned = { start: 1, end: lastEnd };
    const merged = mergeHeadingsIntoUnits(allHeadings, pdfPageCount);
    if (merged.units.length === 0) {
      this.logger.log(`FULL_BOOK_SCAN_NO_STRUCTURE_DETECTED pages=${pagesScanned.start}-${pagesScanned.end}`);
      return { result: { units: [] }, pagesScanned };
    }

    const validation = validateTocExtraction(merged, { pageBounds: { min: 1, max: pdfPageCount } });
    if (!validation.valid || !validation.result) {
      // e.g. the same non-adjacent title reused far apart in the book,
      // surviving dedup as two distinct Units with an identical name —
      // prefer "failed" over silently showing/creating an inconsistent structure.
      this.logger.warn(`FULL_BOOK_SCAN_MERGED_RESULT_INVALID pages=${pagesScanned.start}-${pagesScanned.end}: ${validation.errors.join("; ")}`);
      return { result: { units: [] }, pagesScanned };
    }

    this.logger.log(`FULL_BOOK_SCAN_COMPLETED units=${validation.result.units.length} pages=${pagesScanned.start}-${pagesScanned.end}`);
    return { result: validation.result, pagesScanned };
  }

  /** One full-scan chunk (<= FULL_SCAN_CHUNK_PAGES pages): render -> AI vision call -> validate, with its own MAX_ATTEMPTS corrective retry. Mirrors extractWindowWithRetry's shape with the heading-detection prompt/validator instead of the TOC-listing ones. */
  private async scanChunkWithRetry(
    pdfPath: string,
    start: number,
    end: number,
    ctx: { curriculumNameEn: string; gradeNameEn: string; subjectNameEn: string },
    requestingActorId: string,
    tmpDir: string,
  ): Promise<HeadingDetection[]> {
    const imageParts = await this.renderPageChunkImages(pdfPath, start, end, tmpDir, "scan");

    let retryFeedback: string[] | undefined;
    let lastErrors: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const systemPrompt = this.contextBuilder.buildFullBookStructureScanPrompt({ ...ctx, pageRangeStart: start, pageRangeEnd: end }, retryFeedback);
      const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();

      const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({
        providerKey,
        inputText: systemPrompt + "x".repeat(imageParts.length * IMAGE_TOKEN_ESTIMATE * CHARS_PER_TOKEN_CONSERVATIVE),
        maxOutputTokens: 2000,
      });
      const reserveResult = await this.usageService.reserveBudget(requestingActorId, estimatedUsd);
      if (!reserveResult.ok) {
        throw new ServiceUnavailableException("Book structure scanning is temporarily unavailable due to daily AI usage limits. Please try again later.");
      }
      const budgetReservationId = reserveResult.reservationId;

      let result: Awaited<ReturnType<typeof provider.generate>>;
      try {
        result = await provider.generate({
          systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: "Detect chapter/section starts now." }, ...imageParts] }],
          diagnostics: { operation: "toc_full_book_scan", pageStart: start, pageEnd: end },
          responseFormat: "json_object",
          maxOutputTokens: 2000,
        });
      } catch (err) {
        await this.usageService.releaseBudget(budgetReservationId).catch(() => undefined);
        if (isQuotaError(err)) throw err;
        // BUG FIX (2026-09-20): a transient provider-call failure (rate
        // limit, timeout, network blip) on ANY one chunk used to be
        // rethrown here, which aborted the ENTIRE multi-chunk full-book
        // scan — a real book easily issues 10-20+ vision calls in quick
        // succession and can plausibly hit a per-minute token limit
        // partway through (confirmed via a real 429 from OpenAI during
        // Extra Book Analyze on a real book). This chunk is now treated
        // exactly like a validation failure — recorded, retried if
        // attempts remain, and if still failing after MAX_ATTEMPTS the
        // chunk contributes zero headings while the REST of the scan
        // continues (see the graceful give-up path below), instead of the
        // whole Analyze request crashing and losing every other chunk's
        // already-completed work.
        const message = err instanceof Error ? err.message : String(err);
        lastErrors = [`Provider call failed: ${message}`];
        retryFeedback = lastErrors;
        this.logger.warn(`FULL_BOOK_SCAN_PROVIDER_ERROR pages=${start}-${end} attempt=${attempt}: ${message}`);
        continue;
      }

      const rates = await this.providerFactory.getCostRates(providerKey);
      const actualCostUsd = result.inputTokens * rates.costPerInputToken + result.outputTokens * rates.costPerOutputToken;
      await this.prisma.client.aIUsage
        .create({
          data: {
            userId: requestingActorId,
            studentId: null,
            subjectId: null,
            feature: "curriculum_toc_extraction",
            provider: providerKey,
            model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            creditsUsed: 0,
            costUsd: actualCostUsd,
          },
        })
        .catch((err) => this.logger.warn(`Usage log failed (scan still completed): ${err instanceof Error ? err.message : String(err)}`));
      await this.usageService.reconcileBudget(budgetReservationId, actualCostUsd).catch(() => undefined);

      let parsed: unknown;
      try {
        parsed = JSON.parse(result.content);
      } catch {
        lastErrors = ["Response was not valid JSON."];
        retryFeedback = lastErrors;
        this.logger.warn(`FULL_BOOK_SCAN_INVALID_JSON pages=${start}-${end} attempt=${attempt}`);
        continue;
      }

      const validation = validateFullBookScanChunk(parsed, { pageBounds: { min: start, max: end } });
      if (validation.valid && validation.headings) return validation.headings;

      lastErrors = validation.errors;
      retryFeedback = lastErrors;
      this.logger.warn(`FULL_BOOK_SCAN_VALIDATION_FAILED pages=${start}-${end} attempt=${attempt}: ${validation.errors.join("; ")}`);
    }

    // Unlike TOC-window extraction, a chunk that fails validation on every attempt is NOT fatal to the
    // whole scan — it simply contributes no headings (the rest of the book is still scanned); this keeps
    // one malformed-response chunk from aborting an otherwise-successful full-book scan.
    this.logger.warn(`FULL_BOOK_SCAN_CHUNK_GAVE_UP pages=${start}-${end} after ${MAX_ATTEMPTS} attempt(s): ${lastErrors.join("; ")}`);
    return [];
  }

  /** One page window (<= TOC_WINDOW_PAGES pages): render -> AI vision call -> validate, with its own MAX_ATTEMPTS corrective retry for malformed/invalid JSON. */
  private async extractWindowWithRetry(
    pdfPath: string,
    start: number,
    end: number,
    ctx: { curriculumNameEn: string; gradeNameEn: string; subjectNameEn: string },
    requestingActorId: string,
    tmpDir: string,
    pdfPageCount: number,
  ): Promise<TocExtractionResult> {
    const imageParts = await this.renderPageChunkImages(pdfPath, start, end, tmpDir, "window");

    let retryFeedback: string[] | undefined;
    let lastErrors: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const systemPrompt = this.contextBuilder.buildTocExtractionPrompt({ ...ctx, pageRangeStart: start, pageRangeEnd: end }, retryFeedback);
      const { provider, providerKey, model } = await this.providerFactory.getActiveProvider();

      const estimatedUsd = await this.usageService.estimateMaxChatCostUsd({
        providerKey,
        inputText: systemPrompt + "x".repeat(imageParts.length * IMAGE_TOKEN_ESTIMATE * CHARS_PER_TOKEN_CONSERVATIVE),
        maxOutputTokens: 3000,
      });
      const reserveResult = await this.usageService.reserveBudget(requestingActorId, estimatedUsd);
      if (!reserveResult.ok) {
        throw new ServiceUnavailableException("TOC extraction is temporarily unavailable due to daily AI usage limits. Please try again later.");
      }
      const budgetReservationId = reserveResult.reservationId;

      let result: Awaited<ReturnType<typeof provider.generate>>;
      try {
        result = await provider.generate({
          systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: "Extract the table of contents now." }, ...imageParts] }],
          responseFormat: "json_object",
          maxOutputTokens: 3000,
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
            userId: requestingActorId,
            studentId: null,
            subjectId: null,
            feature: "curriculum_toc_extraction",
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
        retryFeedback = lastErrors;
        this.logger.warn(`TOC_EXTRACTION_INVALID_JSON pages=${start}-${end} attempt=${attempt}`);
        continue;
      }

      const validation = validateTocExtraction(parsed, { pageBounds: { min: 1, max: pdfPageCount } });
      if (validation.valid && validation.result) return validation.result;

      lastErrors = validation.errors;
      retryFeedback = lastErrors;
      this.logger.warn(`TOC_EXTRACTION_VALIDATION_FAILED pages=${start}-${end} attempt=${attempt}: ${validation.errors.join("; ")}`);
    }

    throw new TocExtractionError(`TOC extraction failed validation for pages ${start}-${end} after ${MAX_ATTEMPTS} attempt(s).`, lastErrors);
  }
}
