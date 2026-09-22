import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AIModule } from "../ai/ai.module";
import { TutorModule } from "../tutor/tutor.module";
import { TutorQuestionPacksModule } from "../tutor-question-packs/tutor-question-packs.module";
import { QuestionBankModule } from "../question-bank/question-bank.module";
import { InteractiveLessonController } from "./interactive-lesson.controller";
import { InteractiveLessonService } from "./interactive-lesson.service";
import { LessonDraftModule } from "./lesson-draft-generator/lesson-draft.module";
import { TrialModule } from "../trial/trial.module";

@Module({
  imports: [AuthModule, AIModule, TutorModule, TutorQuestionPacksModule, QuestionBankModule, LessonDraftModule, TrialModule],
  controllers: [InteractiveLessonController],
  providers: [InteractiveLessonService],
  // Re-exports the whole module (not individual providers — Nest requires
  // that) so one-off scripts can still resolve LessonDraftGeneratorService/
  // LessonPublishService via
  // app.select(InteractiveLessonModule).get(LessonDraftGeneratorService),
  // unchanged everywhere that's already used, even though they now live in
  // LessonDraftModule (shared with QuestionBankModule — see that module's
  // own doc comment for why).
  exports: [LessonDraftModule],
})
export class InteractiveLessonModule {}
