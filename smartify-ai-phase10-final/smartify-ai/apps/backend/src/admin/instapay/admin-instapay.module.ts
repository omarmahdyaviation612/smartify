import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { BillingModule } from "../../billing/billing.module";
import { TutorQuestionPacksModule } from "../../tutor-question-packs/tutor-question-packs.module";
import { AdminInstapayController } from "./admin-instapay.controller";
import { AdminInstapayService } from "./admin-instapay.service";

@Module({
  imports: [AuthModule, BillingModule, TutorQuestionPacksModule],
  controllers: [AdminInstapayController],
  providers: [AdminInstapayService],
})
export class AdminInstapayModule {}
