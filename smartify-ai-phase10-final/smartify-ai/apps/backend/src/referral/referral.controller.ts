import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ReferralService } from "./referral.service";

@Controller("referral")
@UseGuards(ClerkAuthGuard)
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Get("me")
  getMe(@CurrentUser() user: any) {
    return this.referralService.getMe(user.id);
  }

  @Get("eligible-subjects")
  getEligibleSubjects(@CurrentUser() user: any) {
    return this.referralService.getEligibleRewardSubjects(user.id);
  }

  @Post("attach")
  attach(@CurrentUser() user: any, @Body() body: { code: string }) {
    return this.referralService.attach(user.id, body?.code);
  }

  @Post("rewards/:referralId/apply")
  applyReward(@CurrentUser() user: any, @Param("referralId") referralId: string, @Body() body: { subjectId: string }) {
    return this.referralService.applyReward(user.id, referralId, body?.subjectId);
  }
}
