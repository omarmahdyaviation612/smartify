import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { AIModule } from "../../ai/ai.module";
import { UnitGroundingModule } from "../../interactive-lesson/unit-grounding/unit-grounding.module";
import { AdminCurriculumController } from "./admin-curriculum.controller";
import { AdminCurriculumService } from "./admin-curriculum.service";
import { TocExtractionService } from "./subject-ingestion/toc-extraction.service";

// UnitGroundingModule import (2026-09-20, Admin textbook upload Step 1):
// its exported CurriculumSourceUploadService and CurriculumSourceStorageFactory
// resolve the SAME storage-factory instance the lazy grounding path already
// uses, never a second one — the latter now also backs TocExtractionService
// (Admin New Subject + Textbook Ingestion V1). Nothing else from that
// module is used here.
@Module({
  imports: [AuthModule, AIModule, UnitGroundingModule],
  controllers: [AdminCurriculumController],
  providers: [AdminCurriculumService, TocExtractionService],
})
export class AdminCurriculumModule {}
