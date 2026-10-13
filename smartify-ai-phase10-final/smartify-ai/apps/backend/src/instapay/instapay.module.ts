import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BillingModule } from "../billing/billing.module";
import { TutorQuestionPacksModule } from "../tutor-question-packs/tutor-question-packs.module";
import { AIDailyTopUpModule } from "../ai-daily-topup/ai-daily-topup.module";
import { InstapayController } from "./instapay.controller";
import { InstapayService } from "./instapay.service";
import { InstapayAdminAlertService } from "./instapay-admin-alert.service";
import { EmailModule } from "../email/email.module";
import { AdminPushModule } from "../admin/push/admin-push.module";

@Module({
  imports: [AuthModule, BillingModule, TutorQuestionPacksModule, AIDailyTopUpModule, EmailModule, AdminPushModule],
  controllers: [InstapayController],
  providers: [InstapayService, InstapayAdminAlertService],
  exports: [InstapayService],
})
export class InstapayModule {}
