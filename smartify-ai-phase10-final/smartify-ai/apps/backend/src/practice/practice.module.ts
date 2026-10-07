import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { QuestionBankModule } from "../question-bank/question-bank.module";
import { TrialModule } from "../trial/trial.module";
import { PracticeController } from "./practice.controller";
import { PracticeService } from "./practice.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [AuthModule, AnalyticsModule, QuestionBankModule, TrialModule, NotificationsModule],
  controllers: [PracticeController],
  providers: [PracticeService],
})
export class PracticeModule {}
