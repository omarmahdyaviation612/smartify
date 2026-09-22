import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { QuestionBankModule } from "../question-bank/question-bank.module";
import { EmailModule } from "../email/email.module";
import { TrialModule } from "../trial/trial.module";
import { QuizzesController } from "./quizzes.controller";
import { QuizzesService } from "./quizzes.service";

@Module({
  imports: [AuthModule, AnalyticsModule, QuestionBankModule, EmailModule, TrialModule],
  controllers: [QuizzesController],
  providers: [QuizzesService],
})
export class QuizzesModule {}
