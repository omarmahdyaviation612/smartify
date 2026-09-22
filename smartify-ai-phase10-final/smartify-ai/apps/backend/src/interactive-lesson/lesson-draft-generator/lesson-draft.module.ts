import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { AIModule } from "../../ai/ai.module";
import { UnitGroundingModule } from "../unit-grounding/unit-grounding.module";
import { LessonDraftGeneratorService } from "./lesson-draft-generator.service";
import { LessonPublishService } from "./lesson-publish.service";

/**
 * Extracted out of InteractiveLessonModule (2026-09-19) so QuestionBankModule
 * can also depend on LessonDraftGeneratorService/LessonPublishService —
 * QuestionDraftGeneratorService.ensurePoolForTopic() needs to be able to
 * lazily generate a Topic's LESSON too, not just its questions, since most
 * title-only topics reach Practice/Quiz before they ever reach the Lesson
 * page. InteractiveLessonModule already imports QuestionBankModule, so
 * QuestionBankModule importing InteractiveLessonModule back would be
 * circular — both now import this shared leaf module instead.
 *
 * UnitGroundingModule import (2026-09-19): ensureTopicHasLesson() now
 * triggers lazy Unit grounding before generating a Topic — see
 * UnitGroundingService.ensureUnitGrounded(). No circularity:
 * UnitGroundingModule only imports AIModule.
 */
@Module({
  imports: [AuthModule, AIModule, UnitGroundingModule],
  providers: [LessonDraftGeneratorService, LessonPublishService],
  exports: [LessonDraftGeneratorService, LessonPublishService],
})
export class LessonDraftModule {}
