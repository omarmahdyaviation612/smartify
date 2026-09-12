import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AIModule } from "../ai/ai.module";
import { TutorController } from "./tutor.controller";
import { TutorService } from "./tutor.service";
import { TutorQuestionPacksModule } from "../tutor-question-packs/tutor-question-packs.module";
import { TutorAnswerCacheService } from "./tutor-answer-cache.service";
import { TutorSpeechService } from "./tutor-speech.service";
import { TtsProviderFactory } from "./tts/tts-provider.factory";

@Module({
  imports: [AuthModule, AIModule, TutorQuestionPacksModule],
  controllers: [TutorController],
  providers: [TutorService, TutorAnswerCacheService, TutorSpeechService, TtsProviderFactory],
  // TutorService is exported so the Interactive Lesson engine can reuse
  // its exact reserveFreeTrial/releaseFreeTrial entitlement path — never a
  // second/parallel Free Trial mechanism.
  exports: [TutorService],
})
export class TutorModule {}
