import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AIModule } from "../ai/ai.module";
import { TutorModule } from "../tutor/tutor.module";
import { TutorQuestionPacksModule } from "../tutor-question-packs/tutor-question-packs.module";
import { InteractiveLessonController } from "./interactive-lesson.controller";
import { InteractiveLessonService } from "./interactive-lesson.service";

@Module({
  imports: [AuthModule, AIModule, TutorModule, TutorQuestionPacksModule],
  controllers: [InteractiveLessonController],
  providers: [InteractiveLessonService],
})
export class InteractiveLessonModule {}
