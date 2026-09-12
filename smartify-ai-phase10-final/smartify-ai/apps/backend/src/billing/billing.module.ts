import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PaymentsModule } from "../payments/payments.module";
import { BillingController } from "./billing.controller";
import { BillingWebhookController } from "./billing-webhook.controller";
import { BillingService } from "./billing.service";
import { TutorQuestionPacksModule } from "../tutor-question-packs/tutor-question-packs.module";

@Module({
  imports: [AuthModule, PaymentsModule, TutorQuestionPacksModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
