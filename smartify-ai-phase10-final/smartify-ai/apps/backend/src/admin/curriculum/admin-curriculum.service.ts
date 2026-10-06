import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AIProviderFactory } from "../../ai/ai-provider.factory";
import { BadRequestException } from "@nestjs/common";
import pdf from "pdf-parse";
import { deriveTopicStatus } from "./curriculum-status.util";
import { CurriculumSourceUploadService, type CurriculumSourceUploadResult, type ExtraBookUploadResult, defaultExtraBookObjectKey } from "../../interactive-lesson/unit-grounding/storage/curriculum-source-upload.service";
import { CurriculumSourceStorageFactory } from "../../interactive-lesson/unit-grounding/storage/curriculum-source-storage.factory";
import { TocExtractionService, type TocExtractionOutcome } from "./subject-ingestion/toc-extraction.service";
import { validateTocExtraction } from "./subject-ingestion/toc-extraction-validator";
import { CONTENT_AUTHORING_ACTOR_ID } from "../../ai/content-authoring-actor.const";
import type { ConfirmExtraBookStructureInput, ConfirmSubjectStructureInput } from "@smartify/validation";
import { UnitGroundingService } from "../../interactive-lesson/unit-grounding/unit-grounding.service";

@Injectable()
export class AdminCurriculumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIProviderFactory,
    private readonly sourceUpload: CurriculumSourceUploadService,
    private readonly tocExtraction: TocExtractionService,
    private readonly storageFactory: CurriculumSourceStorageFactory,
    @Optional()
    private readonly unitGrounding?: UnitGroundingService,
  ) {}

  /**
   * Admin-triggered, resumable subject grounding. One call processes at most
   * one bounded page chunk; callers may poll by calling again. Progress is
   * persisted by UnitGroundingProgressService, so closing the page is safe.
   * This endpoint never publishes a Subject or invokes Topic assignment / AI
   * mapping; those remain separately governed workflows.
   */
  async prepareNextSubjectGroundingChunk(subjectId: string) {
    const subject = await this.prisma.client.subject.findUnique({
      where: { id: subjectId },
      select: {
        id: true,
        units: { select: { id: true, nameEn: true, order: true, groundingNotesJson: true }, orderBy: { order: "asc" } },
      },
    });
    if (!subject) throw new NotFoundException(`Subject ${subjectId} not found.`);

    const groundedUnits = subject.units.filter((unit) => unit.groundingNotesJson != null).length;
    const totalUnits = subject.units.length;
    const common = { subjectId, groundedUnits, totalUnits };
    if (totalUnits === 0) return { ...common, status: "NO_UNITS" as const };
    const nextUnit = subject.units.find((unit) => unit.groundingNotesJson == null);
    if (!nextUnit) return { ...common, status: "READY" as const };

    if (!this.unitGrounding) throw new Error("UnitGroundingService is not configured.");
    const result = await this.unitGrounding.prepareNextGroundingChunk(nextUnit.id, CONTENT_AUTHORING_ACTOR_ID);
    const groundedAfterChunk = groundedUnits + (result.status === "READY" ? 1 : 0);
    const subjectStatus = result.status === "READY" && groundedAfterChunk < totalUnits ? "UNIT_READY" : result.status;
    return {
      ...common,
      ...(result.status === "READY" ? { groundedUnits: groundedAfterChunk } : {}),
      status: subjectStatus,
      unitId: nextUnit.id,
      unitNameEn: nextUnit.nameEn,
      ...(result.status === "PREPARING" || result.status === "RETRYABLE_FAILURE" ? { retryAfterMs: result.retryAfterMs } : {}),
      ...(result.status === "CONFIGURATION_ERROR" || result.status === "PROVIDER_OUTAGE" || result.status === "RETRYABLE_FAILURE" ? { reason: result.reason } : {}),
    };
  }

  /**
   * Admin textbook upload, Step 1 (2026-09-20) — first-time upload only.
   * A thin pass-through to the shared CurriculumSourceUploadService (the
   * exact same logic `pnpm curriculum:upload` uses); this method exists
   * only so the controller doesn't need to know about temp-file handling.
   * Never grounds a Unit, never generates a Topic/Question, never calls
   * an AI provider — storage + Subject.sourceFile only, then stops.
   */
  uploadSubjectTextbook(subjectId: string, file: { originalname: string; buffer: Buffer }): Promise<CurriculumSourceUploadResult> {
    return this.sourceUpload.uploadFromBuffer({ subjectId, buffer: file.buffer, originalFilename: file.originalname });
  }

  /**
   * Admin New Subject + Textbook Ingestion V1, step "Analyze Textbook"
   * (2026-09-20) — a thin pass-through to TocExtractionService, billed to
   * the fixed CONTENT_AUTHORING_ACTOR_ID (never any real student, and
   * never bypassing the platform AI budget system — TocExtractionService
   * reserves/reconciles against it exactly like every other content-
   * authoring AI call). Writes nothing to the database; the returned
   * structure is a PREVIEW only, shown to the admin for editing before
   * confirmSubjectStructure() ever persists anything.
   */
  analyzeSubjectTextbook(subjectId: string): Promise<TocExtractionOutcome> {
    return this.tocExtraction.extract(subjectId, CONTENT_AUTHORING_ACTOR_ID);
  }

  /**
   * Admin New Subject + Textbook Ingestion V1, step "Confirm & Create
   * Curriculum Structure" (2026-09-20) — the ONLY place this workflow ever
   * writes Units/Topics. Never trusts the client's own Curriculum/Grade
   * relationship claim (re-derives the Subject's real grade/curriculum and
   * rejects a mismatch), and never trusts the client's edited units/topics
   * payload without re-running the SAME structural validator extraction
   * used at analyze time — against the real PDF page count re-derived
   * server-side, not whatever the client happens to send back. Refuses if
   * this Subject already has ANY Unit (idempotency: a duplicate
   * confirmation — double-click, browser retry, network retry — can never
   * create a second copy of the structure). Creation itself is one Prisma
   * transaction per Subject: either every Unit/Topic is created, or none
   * are — the existing-structure guard is re-checked as the FIRST
   * statement inside that same transaction, narrowing (not eliminating,
   * which would need row-level locking this low-frequency admin action
   * doesn't warrant) the double-submit race to two truly concurrent
   * requests landing in the same commit window.
   *
   * Never touches Subject.isActive — the Subject stays exactly as
   * inactive/active as it already was; publishing is a separate,
   * deliberate admin action via the existing updateSubject() toggle.
   * Never touches Unit.groundingNotesJson or Topic.teachingStepsJson —
   * those stay null, so the existing lazy grounding/generation chain picks
   * up this Subject exactly the same way it would any other.
   */
  async confirmSubjectStructure(subjectId: string, input: ConfirmSubjectStructureInput): Promise<{ subjectId: string; unitsCreated: number; topicsCreated: number }> {
    const subject = await this.prisma.client.subject.findUnique({
      where: { id: subjectId },
      select: { id: true, gradeId: true, grade: { select: { curriculumId: true } } },
    });
    if (!subject) throw new NotFoundException(`Subject ${subjectId} not found.`);
    if (subject.gradeId !== input.gradeId || subject.grade.curriculumId !== input.curriculumId) {
      throw new BadRequestException("The submitted Curriculum/Grade does not match this Subject's actual Curriculum/Grade.");
    }

    const pdfPageCount = await this.tocExtraction.getPageCount(subjectId);
    const validation = validateTocExtraction({ units: input.units }, { pageBounds: { min: 1, max: pdfPageCount } });
    if (!validation.valid || !validation.result) {
      throw new BadRequestException({ message: "The submitted curriculum structure is invalid.", errors: validation.errors });
    }
    const validated = validation.result;
    if (validated.units.length === 0) {
      throw new BadRequestException("At least one Unit is required.");
    }

    const existingUnitCount = await this.prisma.client.unit.count({ where: { subjectId } });
    if (existingUnitCount > 0) {
      throw new BadRequestException("This subject already has curriculum structure — confirmation can only run once.");
    }

    return this.prisma.client.$transaction(async (tx) => {
      const raceCheck = await tx.unit.count({ where: { subjectId } });
      if (raceCheck > 0) {
        throw new BadRequestException("This subject already has curriculum structure — confirmation can only run once.");
      }

      let unitsCreated = 0;
      let topicsCreated = 0;
      for (let uIndex = 0; uIndex < validated.units.length; uIndex++) {
        const unit = validated.units[uIndex];
        const createdUnit = await tx.unit.create({
          data: { subjectId, nameEn: unit.nameEn, nameAr: unit.nameAr, order: uIndex + 1, sourcePageStart: unit.sourcePageStart, sourcePageEnd: unit.sourcePageEnd },
        });
        unitsCreated++;
        await tx.topic.createMany({
          data: unit.topics.map((topic, tIndex) => ({ unitId: createdUnit.id, nameEn: topic.nameEn, nameAr: topic.nameAr, order: tIndex + 1 })),
        });
        topicsCreated += unit.topics.length;
      }

      return { subjectId, unitsCreated, topicsCreated };
    });
  }

  // ==========================================================
  // English Extra Book / Story support V1 (2026-09-20)
  // ==========================================================
  // Appends NEW Units/Topics to an EXISTING Subject, sourced from a
  // SEPARATE PDF (e.g. an English "Story" book distinct from the English
  // course book) — never creates a Subject, never touches
  // Subject.sourceFile, never touches this Subject's existing Units/
  // Topics. See Unit.sourceFileOverride / resolveEffectiveSourceFile for
  // how the lazy grounding chain picks this up afterward.

  private async getSubjectSourceContext(subjectId: string) {
    const subject = await this.prisma.client.subject.findUnique({
      where: { id: subjectId },
      select: { id: true, nameEn: true, grade: { select: { level: true, curriculum: { select: { code: true } } } } },
    });
    if (!subject) throw new NotFoundException(`Subject ${subjectId} not found.`);
    return subject;
  }

  /** Analyze/confirm both need "the deterministic key for THIS subject+bookLabel, verified to actually exist in storage" — centralized here so neither ever trusts a client-supplied key directly. */
  private async resolveVerifiedExtraBookKey(subjectId: string, bookLabel: string): Promise<string> {
    const subject = await this.getSubjectSourceContext(subjectId);
    const expectedKey = defaultExtraBookObjectKey(subject.grade.curriculum.code, subject.grade.level, subject.nameEn, bookLabel);
    const exists = await this.storageFactory.get().exists(expectedKey, { curriculumCode: subject.grade.curriculum.code, gradeLevel: subject.grade.level });
    if (!exists) throw new BadRequestException("Upload this extra book's PDF before analyzing or confirming it.");
    return expectedKey;
  }

  /**
   * "Add Extra Book", upload step — a thin pass-through to
   * CurriculumSourceUploadService.uploadExtraBook(); never touches
   * Subject.sourceFile or any Unit/Topic. See that method's own doc
   * comment for the deterministic-key mechanism.
   */
  uploadExtraBook(subjectId: string, file: { buffer: Buffer }, bookLabel: string): Promise<ExtraBookUploadResult> {
    return this.sourceUpload.uploadExtraBook({ subjectId, buffer: file.buffer, bookLabel });
  }

  /**
   * "Add Extra Book", "Analyze Textbook" step — reuses TocExtractionService
   * exactly like the New-Subject flow, but pointed at the already-verified
   * extra-book object key instead of the Subject's main textbook, and
   * billed to the same CONTENT_AUTHORING_ACTOR_ID. Writes nothing to the
   * database.
   *
   * `fullScanFallback: true` (2026-09-20) — the ONE place this flag is
   * ever passed: story books routinely have no formal table of contents,
   * so unlike the New-Subject flow (analyzeSubjectTextbook, which never
   * sets this), a fast-TOC miss here automatically falls back to
   * TocExtractionService's bounded full-book structure scan before
   * giving up. If even that finds nothing, this still throws the same
   * safe BadRequestException as before — the frontend responds by
   * offering "Enter Structure Manually" rather than treating this as a
   * dead end (see spec section 9/22).
   */
  async analyzeExtraBook(subjectId: string, bookLabel: string): Promise<TocExtractionOutcome> {
    const sourceOverride = await this.resolveVerifiedExtraBookKey(subjectId, bookLabel);
    return this.tocExtraction.extract(subjectId, CONTENT_AUTHORING_ACTOR_ID, { sourceOverride, fullScanFallback: true });
  }

  /**
   * "Add Extra Book", "Confirm & Add to Subject" step. Trust chain for the
   * extra-book source (spec section 8): `bookLabel` is the only client-
   * supplied identifier — the actual R2 object key is ALWAYS re-derived
   * server-side from (this Subject's real curriculum/grade/name, bookLabel)
   * via the same deterministic function upload used, and is only trusted
   * once independently confirmed to exist in storage
   * (resolveVerifiedExtraBookKey). A client can never supply an arbitrary
   * R2 key directly — there is no field for one anywhere in this request.
   *
   * Idempotency (spec section 16): rather than a new persistence model,
   * this reuses the very field being added — a duplicate confirmation is
   * detected by checking whether any Unit under this Subject already
   * carries this exact sourceFileOverride key, re-checked as the first
   * statement inside the same transaction that creates the new Units, to
   * narrow (not just check-then-act outside it) the double-submit race.
   *
   * Never touches Subject.sourceFile, Subject.isActive, or any existing
   * Unit/Topic — only appends new rows, each new Unit stamped with the
   * verified sourceFileOverride key. Ordering continues after this
   * Subject's current highest Unit.order so the new Units sort after the
   * existing ones.
   */
  async confirmExtraBookStructure(subjectId: string, input: ConfirmExtraBookStructureInput): Promise<{ subjectId: string; unitsCreated: number; topicsCreated: number; sourceFileOverride: string }> {
    const sourceFileOverride = await this.resolveVerifiedExtraBookKey(subjectId, input.bookLabel);

    const pdfPageCount = await this.tocExtraction.getPageCount(subjectId, { sourceOverride: sourceFileOverride });
    const validation = validateTocExtraction({ units: input.units }, { pageBounds: { min: 1, max: pdfPageCount } });
    if (!validation.valid || !validation.result) {
      throw new BadRequestException({ message: "The submitted curriculum structure is invalid.", errors: validation.errors });
    }
    const validated = validation.result;
    if (validated.units.length === 0) {
      throw new BadRequestException("At least one Unit is required.");
    }

    const existingOverrideCount = await this.prisma.client.unit.count({ where: { subjectId, sourceFileOverride } });
    if (existingOverrideCount > 0) {
      throw new BadRequestException("This extra book has already been added to this subject.");
    }

    return this.prisma.client.$transaction(async (tx) => {
      const raceCheck = await tx.unit.count({ where: { subjectId, sourceFileOverride } });
      if (raceCheck > 0) {
        throw new BadRequestException("This extra book has already been added to this subject.");
      }

      const maxOrder = await tx.unit.aggregate({ where: { subjectId }, _max: { order: true } });
      let nextOrder = (maxOrder._max.order ?? 0) + 1;

      let unitsCreated = 0;
      let topicsCreated = 0;
      for (const unit of validated.units) {
        const createdUnit = await tx.unit.create({
          data: { subjectId, nameEn: unit.nameEn, nameAr: unit.nameAr, order: nextOrder++, sourcePageStart: unit.sourcePageStart, sourcePageEnd: unit.sourcePageEnd, sourceFileOverride },
        });
        unitsCreated++;
        await tx.topic.createMany({
          data: unit.topics.map((topic, tIndex) => ({ unitId: createdUnit.id, nameEn: topic.nameEn, nameAr: topic.nameAr, order: tIndex + 1 })),
        });
        topicsCreated += unit.topics.length;
      }

      return { subjectId, unitsCreated, topicsCreated, sourceFileOverride };
    });
  }

  /**
   * Read-only curriculum/content status dashboard (2026-09-20) — the
   * smallest step identified by the curriculum/admin audit: surface what
   * already exists (textbook mapping, Unit grounding, Topic generation
   * state) without touching the production lazy-generation architecture at
   * all. One Prisma call walks the whole Curriculum->Grade->Subject->Unit->
   * Topic tree; groundingNotesJson/teachingStepsJson are selected only to
   * derive a boolean/status locally and are never included in the
   * response — this endpoint returns metadata only, never content blobs.
   */
  async getCurriculumStatus() {
    const curricula = await this.prisma.client.curriculum.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true,
        nameEn: true,
        nameAr: true,
        code: true,
        isActive: true,
        grades: {
          orderBy: { level: "asc" },
          select: {
            id: true,
            nameEn: true,
            nameAr: true,
            level: true,
            isActive: true,
            subjects: {
              orderBy: { nameEn: "asc" },
              select: {
                id: true,
                nameEn: true,
                nameAr: true,
                isActive: true,
                sourceFile: true,
                priceEGP: true,
                units: {
                  orderBy: { order: "asc" },
                  select: {
                    id: true,
                    nameEn: true,
                    nameAr: true,
                    order: true,
                    sourcePageStart: true,
                    sourcePageEnd: true,
                    sourceFileOverride: true,
                    groundingNotesJson: true,
                    groundingGeneratedAt: true,
                    groundingVersion: true,
                    groundingModel: true,
                    groundingPromptVersion: true,
                    topics: {
                      orderBy: { order: "asc" },
                      select: {
                        id: true,
                        nameEn: true,
                        nameAr: true,
                        order: true,
                        teachingStepsJson: true,
                        generationSource: true,
                        groundingVersionUsed: true,
                        generationPromptVersion: true,
                        contentGeneratedAt: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    let subjectCount = 0;
    let unitCount = 0;
    let groundedUnitCount = 0;
    let topicCount = 0;
    let generatedTopicCount = 0;
    let textbookGroundedTopicCount = 0;

    const mappedCurricula = curricula.map((curriculum) => ({
      id: curriculum.id,
      nameEn: curriculum.nameEn,
      nameAr: curriculum.nameAr,
      code: curriculum.code,
      isActive: curriculum.isActive,
      grades: curriculum.grades.map((grade) => ({
        id: grade.id,
        nameEn: grade.nameEn,
        nameAr: grade.nameAr,
        level: grade.level,
        isActive: grade.isActive,
        subjects: grade.subjects.map((subject) => {
          subjectCount++;
          return {
            id: subject.id,
            nameEn: subject.nameEn,
            nameAr: subject.nameAr,
            isActive: subject.isActive,
            sourceFile: subject.sourceFile,
            textbookMapped: subject.sourceFile != null,
            // Subject-based pricing (2026-09-20) — null means "not yet priced by an admin", never a fabricated default.
            priceEGP: subject.priceEGP != null ? Number(subject.priceEGP) : null,
            units: subject.units.map((unit) => {
              unitCount++;
              const grounded = unit.groundingNotesJson != null;
              if (grounded) groundedUnitCount++;
              return {
                id: unit.id,
                nameEn: unit.nameEn,
                nameAr: unit.nameAr,
                order: unit.order,
                sourcePageStart: unit.sourcePageStart,
                sourcePageEnd: unit.sourcePageEnd,
                // English Extra Book / Story support V1 (2026-09-20): a
                // subtle, non-mandatory indicator only — true when this
                // Unit's real content comes from a different PDF than its
                // Subject's main textbook (see resolveEffectiveSourceFile).
                // Never exposes the actual object key/reference.
                usesExtraSource: unit.sourceFileOverride != null,
                grounded,
                groundingGeneratedAt: unit.groundingGeneratedAt,
                groundingVersion: unit.groundingVersion,
                groundingModel: unit.groundingModel,
                groundingPromptVersion: unit.groundingPromptVersion,
                topics: unit.topics.map((topic) => {
                  topicCount++;
                  const hasTeachingSteps = topic.teachingStepsJson != null;
                  const status = deriveTopicStatus(hasTeachingSteps, topic.generationSource);
                  if (hasTeachingSteps) generatedTopicCount++;
                  if (status === "TEXTBOOK_GROUNDED") textbookGroundedTopicCount++;
                  return {
                    id: topic.id,
                    nameEn: topic.nameEn,
                    nameAr: topic.nameAr,
                    order: topic.order,
                    hasTeachingSteps,
                    generationSource: topic.generationSource,
                    groundingVersionUsed: topic.groundingVersionUsed,
                    generationPromptVersion: topic.generationPromptVersion,
                    contentGeneratedAt: topic.contentGeneratedAt,
                    status,
                  };
                }),
              };
            }),
          };
        }),
      })),
    }));

    return {
      summary: {
        subjects: subjectCount,
        units: unitCount,
        groundedUnits: groundedUnitCount,
        topics: topicCount,
        generatedTopics: generatedTopicCount,
        textbookGroundedTopics: textbookGroundedTopicCount,
      },
      curricula: mappedCurricula,
    };
  }

  // ---- Curricula ----
  listCurricula() {
    return this.prisma.client.curriculum.findMany({ orderBy: { code: "asc" } });
  }

  updateCurriculum(id: string, data: { nameEn?: string; nameAr?: string; isActive?: boolean }) {
    return this.prisma.client.curriculum.update({ where: { id }, data });
  }

  // ---- Grades ----
  listGrades(curriculumId: string) {
    return this.prisma.client.grade.findMany({ where: { curriculumId }, orderBy: { level: "asc" } });
  }

  createGrade(curriculumId: string, data: { nameEn: string; nameAr: string; level: number }) {
    return this.prisma.client.grade.create({ data: { curriculumId, ...data } });
  }

  updateGrade(id: string, data: { nameEn?: string; nameAr?: string; level?: number; isActive?: boolean }) {
    return this.prisma.client.grade.update({ where: { id }, data });
  }

  // ---- Subjects ----
  listSubjects(gradeId: string) {
    return this.prisma.client.subject.findMany({ where: { gradeId } });
  }

  // `isActive` is optional and, when omitted, keeps Prisma's own schema
  // default (true) — every pre-existing caller of this generic endpoint
  // omits it and is unaffected. The New Subject + Textbook Ingestion V1
  // flow (2026-09-20) is the one caller that explicitly passes
  // `isActive: false` so a Subject created via that flow stays invisible
  // to students until its curriculum structure is confirmed AND an admin
  // deliberately publishes it via the existing updateSubject() toggle.
  createSubject(gradeId: string, data: { nameEn: string; nameAr: string; icon?: string; isActive?: boolean }) {
    return this.prisma.client.subject.create({ data: { gradeId, ...data } });
  }

  updateSubject(id: string, data: { nameEn?: string; nameAr?: string; icon?: string; isActive?: boolean; priceEGP?: number | null }) {
    return this.prisma.client.subject.update({ where: { id }, data });
  }

  listTopics(subjectId: string) {
    return this.prisma.client.topic.findMany({ where: { unit: { subjectId } }, include: { unit: true }, orderBy: [{ unit: { order: "asc" } }, { order: "asc" }] });
  }

  listMaterials(topicId: string) {
    return this.prisma.client.learningMaterial.findMany({ where: { topicId }, orderBy: { createdAt: "desc" }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } });
  }

  async createMaterial(topicId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    const topic = await this.prisma.client.topic.findUnique({ where: { id: topicId }, include: { unit: true } });
    if (!topic) throw new BadRequestException("Topic not found.");
    return this.prisma.client.learningMaterial.create({
      data: { topicId, subjectId: topic.unit.subjectId, originalName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, contentText: file.buffer.toString("utf8") },
    });
  }

  async importSubjectMaterial(subjectId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    const subject = await this.prisma.client.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new BadRequestException("Subject not found.");
    const extracted = file.mimetype === "application/pdf" ? (await pdf(file.buffer)).text : file.buffer.toString("utf8");
    if (!extracted.trim()) throw new BadRequestException("The material contains no readable text.");
    const { provider } = await this.ai.getActiveProvider();
    const result = await provider.generate({
      systemPrompt: "Divide the provided subject material into 3-12 educational topics. Return JSON only: {\"topics\":[{\"nameEn\":\"...\",\"nameAr\":\"...\",\"summaryEn\":\"...\",\"summaryAr\":\"...\"}]}",
      messages: [{ role: "user", content: extracted.slice(0, 50000) }],
      maxOutputTokens: 1800,
    });
    let topics: Array<{ nameEn: string; nameAr: string; summaryEn: string; summaryAr: string }>;
    try { topics = JSON.parse(result.content).topics; } catch { throw new BadRequestException("AI returned an invalid topic structure."); }
    if (!Array.isArray(topics) || topics.length === 0) throw new BadRequestException("AI did not detect any topics.");
    const unit = await this.prisma.client.unit.create({ data: { subjectId, nameEn: "Imported material", nameAr: "مادة مستوردة", order: 999 } });
    const created = await Promise.all(topics.map((t, i) => this.prisma.client.topic.create({ data: { unitId: unit.id, nameEn: t.nameEn, nameAr: t.nameAr, order: i + 1 } })));
    await this.prisma.client.learningMaterial.create({ data: { subjectId, originalName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, contentText: extracted } });
    return { unitId: unit.id, topics: created };
  }

  deleteMaterial(id: string) {
    return this.prisma.client.learningMaterial.delete({ where: { id } });
  }

  // ---- Pricing plans (SUPER_ADMIN/ADMIN only — enforced at the controller level, not here) ----
  listPricingPlans(curriculumId?: string) {
    return this.prisma.client.pricingPlan.findMany({
      where: curriculumId ? { curriculumId } : undefined,
      orderBy: { monthlyPriceEGP: "asc" },
      include: { curriculum: true },
    });
  }

  async updatePricingPlan(
    id: string,
    data: { monthlyPriceEGP?: number; includedSubjects?: number; additionalSubjectPriceEGP?: number; isActive?: boolean },
  ) {
    const existing = await this.prisma.client.pricingPlan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Pricing plan not found.");
    return this.prisma.client.pricingPlan.update({ where: { id }, data });
  }
}
