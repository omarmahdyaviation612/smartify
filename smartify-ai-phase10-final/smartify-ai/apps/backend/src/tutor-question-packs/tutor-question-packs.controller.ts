import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { TutorQuestionPacksService } from "./tutor-question-packs.service";

@Controller("tutor/question-pack")
@UseGuards(ClerkAuthGuard)
export class TutorQuestionPacksController {
  constructor(private readonly service: TutorQuestionPacksService) {}

  @Get("remaining")
  remaining(@CurrentUser() user: any, @Query("subjectId") subjectId: string) {
    return this.service.getRemaining(user.id, subjectId);
  }

  @Post("purchase")
  purchase(@CurrentUser() user: any, @Body() body: { subjectId: string }) {
    return this.service.startPurchase(user.id, body?.subjectId);
  }
}
