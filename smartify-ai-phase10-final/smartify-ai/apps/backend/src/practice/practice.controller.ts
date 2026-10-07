import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PracticeService } from "./practice.service";

@Controller("practice")
@UseGuards(ClerkAuthGuard)
export class PracticeController {
  constructor(private readonly practiceService: PracticeService) {}

  @Get("topics")
  getTopics(@CurrentUser() user: any, @Query("subjectId") subjectId: string) {
    return this.practiceService.getTopicsForSubject(user.id, subjectId);
  }

  @Get("questions")
  getQuestions(
    @CurrentUser() user: any,
    @Query("subjectId") subjectId: string,
    @Query("topicId") topicId?: string,
    @Query("count") count?: string,
  ) {
    return this.practiceService.getAdaptiveQuestions(user.id, subjectId, topicId, count ? Number(count) : undefined);
  }

  @Post("submit")
  submit(@CurrentUser() user: any, @Body() body: { idempotencyKey: string; answers: Array<{ questionId: string; answer: unknown }> }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body?.idempotencyKey ?? "")) {
      throw new BadRequestException("A valid submission key is required.");
    }
    return this.practiceService.submitPractice(user.id, body.answers ?? [], body.idempotencyKey);
  }
}
