import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AIModule } from "../ai/ai.module";
import { TutorModule } from "../tutor/tutor.module";
import { TutorQuestionPacksModule } from "../tutor-question-packs/tutor-question-packs.module";
import { InteractiveLessonController } from "./interactive-lesson.controller";
import { InteractiveLessonService } from "./interactive-lesson.service";
import { LessonDraftGeneratorService } from "./lesson-draft-generator/lesson-draft-generator.service";
import { LessonPublishService } from "./lesson-draft-generator/lesson-publish.service";

@Module({
  imports: [AuthModule, AIModule, TutorModule, TutorQuestionPacksModule],
  controllers: [InteractiveLessonController],
  providers: [InteractiveLessonService, LessonDraftGeneratorService, LessonPublishService],
  // Exported so one-off scripts can resolve them via
  // NestFactory.createApplicationContext(AppModule).get(...) without
  // manually re-wiring AIProviderFactory/AIContextBuilderService/etc.
  exports: [LessonDraftGeneratorService, LessonPublishService],
})
export class InteractiveLessonModule {}
