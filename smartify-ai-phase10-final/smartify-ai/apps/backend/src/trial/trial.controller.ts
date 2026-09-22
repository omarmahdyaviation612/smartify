import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { TrialService } from "./trial.service";

@Controller("trial")
@UseGuards(ClerkAuthGuard)
export class TrialController {
  constructor(private readonly trialService: TrialService) {}

  @Get("state")
  getState(@CurrentUser() user: any) {
    return this.trialService.getState(user.id);
  }

  @Post("select-subjects")
  selectSubjects(@CurrentUser() user: any, @Body() body: { subjectIds: string[] }) {
    return this.trialService.selectSubjects(user.id, body?.subjectIds ?? []);
  }
}
