import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BillingModule } from "../billing/billing.module";
import { TutorQuestionPacksModule } from "../tutor-question-packs/tutor-question-packs.module";
import { InstapayController } from "./instapay.controller";
import { InstapayService } from "./instapay.service";

@Module({
  imports: [AuthModule, BillingModule, TutorQuestionPacksModule],
  controllers: [InstapayController],
  providers: [InstapayService],
  exports: [InstapayService],
})
export class InstapayModule {}
