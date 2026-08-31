import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AIModule } from "../ai/ai.module";
import { PaymentsModule } from "../payments/payments.module";
import { TutorQuestionPacksController } from "./tutor-question-packs.controller";
import { TutorQuestionPacksService } from "./tutor-question-packs.service";

@Module({
  imports: [AuthModule, AIModule, PaymentsModule],
  controllers: [TutorQuestionPacksController],
  providers: [TutorQuestionPacksService],
  exports: [TutorQuestionPacksService],
})
export class TutorQuestionPacksModule {}
