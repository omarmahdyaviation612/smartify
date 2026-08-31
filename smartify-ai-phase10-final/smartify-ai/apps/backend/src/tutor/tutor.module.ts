import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AIModule } from "../ai/ai.module";
import { TutorController } from "./tutor.controller";
import { TutorService } from "./tutor.service";
import { TutorQuestionPacksModule } from "../tutor-question-packs/tutor-question-packs.module";
import { TutorAnswerCacheService } from "./tutor-answer-cache.service";

@Module({
  imports: [AuthModule, AIModule, TutorQuestionPacksModule],
  controllers: [TutorController],
  providers: [TutorService, TutorAnswerCacheService],
})
export class TutorModule {}
