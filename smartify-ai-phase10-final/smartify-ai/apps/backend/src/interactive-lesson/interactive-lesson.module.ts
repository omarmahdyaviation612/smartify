import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AIModule } from "../ai/ai.module";
import { TutorModule } from "../tutor/tutor.module";
import { TutorQuestionPacksModule } from "../tutor-question-packs/tutor-question-packs.module";
import { InteractiveLessonController } from "./interactive-lesson.controller";
import { InteractiveLessonService } from "./interactive-lesson.service";
import { LessonDraftGeneratorService } from "./lesson-draft-generator/lesson-draft-generator.service";

@Module({
  imports: [AuthModule, AIModule, TutorModule, TutorQuestionPacksModule],
  controllers: [InteractiveLessonController],
  providers: [InteractiveLessonService, LessonDraftGeneratorService],
  // Exported so the Phase 5 one-off generation script can resolve it via
  // NestFactory.createApplicationContext(AppModule).get(...) without
  // manually re-wiring AIProviderFactory/AIContextBuilderService/etc.
  exports: [LessonDraftGeneratorService],
})
export class InteractiveLessonModule {}
