import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AIModule } from "../ai/ai.module";
import { LessonDraftModule } from "../interactive-lesson/lesson-draft-generator/lesson-draft.module";
import { QuestionDraftGeneratorService } from "./question-draft-generator/question-draft-generator.service";
import { QuestionPublishService } from "./question-draft-generator/question-publish.service";

@Module({
  imports: [AuthModule, AIModule, LessonDraftModule],
  providers: [QuestionDraftGeneratorService, QuestionPublishService],
  // Exported so one-off review/publish scripts can resolve them via
  // NestFactory.createApplicationContext(AppModule).get(...), mirroring
  // InteractiveLessonModule's exact export rationale — no admin
  // controller exists yet (see Phase 10E report, "review mechanism").
  exports: [QuestionDraftGeneratorService, QuestionPublishService],
})
export class QuestionBankModule {}
