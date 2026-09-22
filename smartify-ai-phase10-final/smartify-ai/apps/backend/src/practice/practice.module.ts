import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { QuestionBankModule } from "../question-bank/question-bank.module";
import { TrialModule } from "../trial/trial.module";
import { PracticeController } from "./practice.controller";
import { PracticeService } from "./practice.service";

@Module({
  imports: [AuthModule, AnalyticsModule, QuestionBankModule, TrialModule],
  controllers: [PracticeController],
  providers: [PracticeService],
})
export class PracticeModule {}
