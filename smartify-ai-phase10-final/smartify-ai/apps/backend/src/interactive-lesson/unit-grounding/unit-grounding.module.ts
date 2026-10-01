import { Module } from "@nestjs/common";
import { AIModule } from "../../ai/ai.module";
import { UnitGroundingService } from "./unit-grounding.service";
import { CurriculumSourceStorageFactory } from "./storage/curriculum-source-storage.factory";
import { CurriculumSourceUploadService } from "./storage/curriculum-source-upload.service";
import { UnitGroundingProgressService } from "./unit-grounding-progress.service";
import { GroundingSourceExtractionService } from "./grounding-source-extraction.service";
import { GroundingVisionExecutionService } from "./grounding-vision-execution.service";
import { TopicSourceEvidenceService } from "../../ai/context/topic-source-evidence.service";

/**
 * UnitGroundingService is resolved both by the offline
 * apps/backend/src/scripts/extract-unit-grounding.ts script AND, since
 * 2026-09-19, by LessonDraftGeneratorService.ensureTopicHasLesson() on a
 * real student's live request path (UnitGroundingService.
 * ensureUnitGrounded()) — it is no longer offline-only. Still never wired
 * into an HTTP controller directly, so no AuthModule/guards are needed
 * here regardless; the auth boundary is whatever controller ultimately
 * calls ensureTopicHasLesson.
 *
 * Only CurriculumSourceStorageFactory is a real Nest provider —
 * LocalCurriculumSourceStorage/S3CurriculumSourceStorage are constructed
 * manually inside it via `new`, exactly like AIProviderFactory constructs
 * its own provider implementations, so an unconfigured S3 bucket can
 * never crash the whole app at boot (S3CurriculumSourceStorage's
 * constructor throws if misconfigured — that must only happen lazily,
 * the first time it's actually needed, never at DI-container startup).
 *
 * CurriculumSourceUploadService (2026-09-20, Admin textbook upload Step 1)
 * is exported too — AdminCurriculumModule imports this module to inject it,
 * resolving the SAME CurriculumSourceStorageFactory instance the lazy
 * grounding path uses, never a second one.
 *
 * CurriculumSourceStorageFactory itself is also exported (2026-09-20,
 * Admin New Subject + Textbook Ingestion V1) so AdminCurriculumModule's new
 * TocExtractionService can fetch a Subject's uploaded PDF the same way
 * UnitGroundingService does — same singleton instance, never a second one.
 */
@Module({
  imports: [AIModule],
  providers: [UnitGroundingService, GroundingSourceExtractionService, GroundingVisionExecutionService, TopicSourceEvidenceService, UnitGroundingProgressService, CurriculumSourceStorageFactory, CurriculumSourceUploadService],
  exports: [UnitGroundingService, GroundingSourceExtractionService, GroundingVisionExecutionService, TopicSourceEvidenceService, UnitGroundingProgressService, CurriculumSourceUploadService, CurriculumSourceStorageFactory],
})
export class UnitGroundingModule {}
