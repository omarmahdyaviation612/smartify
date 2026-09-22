import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { QuestionBankModule } from "../question-bank/question-bank.module";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";

@Module({
  imports: [AuthModule, QuestionBankModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
