import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { QuizzesService } from "./quizzes.service";

@Controller("quizzes")
@UseGuards(ClerkAuthGuard)
export class QuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @Get("questions")
  getQuestions(
    @CurrentUser() user: any,
    @Query("subjectId") subjectId: string,
    @Query("type") type: "topic_assessment" | "mock_exam",
    @Query("topicId") topicId?: string,
  ) {
    return this.quizzesService.getQuizQuestions(user.id, subjectId, type, topicId);
  }

  @Post("submit")
  submit(
    @CurrentUser() user: any,
    @Body()
    body: {
      subjectId: string;
      type: "topic_assessment" | "mock_exam";
      topicId?: string;
      answers: Array<{ questionId: string; answer: unknown }>;
    },
  ) {
    return this.quizzesService.submitQuiz(user.id, body);
  }

  @Get("results")
  listResults(@CurrentUser() user: any) {
    return this.quizzesService.listResults(user.id);
  }

  @Get("results/:id")
  getResult(@CurrentUser() user: any, @Param("id") id: string) {
    return this.quizzesService.getResult(user.id, id);
  }
}
