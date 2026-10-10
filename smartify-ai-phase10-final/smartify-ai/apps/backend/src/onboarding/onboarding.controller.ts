import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { onboardingProgressSchema, studentOnboardingSchema } from "@smartify/validation";
import { OnboardingService } from "./onboarding.service";

// All onboarding endpoints require a signed-in user, but no specific
// role — any freshly-created STUDENT-default account can onboard itself.
@Controller("onboarding")
@UseGuards(ClerkAuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post("profile")
  saveProfile(@CurrentUser() user: any, @Body() body: unknown) {
    const input = studentOnboardingSchema.parse(body);
    return this.onboardingService.saveProfile(user.id, input);
  }

  /** Records that this account opened an onboarding step (drop-off analytics). */
  @Post("progress")
  trackProgress(@CurrentUser() user: any, @Body() body: unknown) {
    const { step } = onboardingProgressSchema.parse(body);
    return this.onboardingService.trackProgress(user.id, step);
  }

  @Get("diagnostic")
  getDiagnostic(@CurrentUser() user: any) {
    return this.onboardingService.getDiagnosticQuestions(user.id);
  }

  @Post("diagnostic/submit")
  submitDiagnostic(@CurrentUser() user: any, @Body() body: { answers: Array<{ questionId: string; answer: unknown }> }) {
    return this.onboardingService.submitDiagnostic(user.id, body.answers ?? []);
  }

  @Get("summary")
  getSummary(@CurrentUser() user: any) {
    return this.onboardingService.getSummary(user.id);
  }
}
