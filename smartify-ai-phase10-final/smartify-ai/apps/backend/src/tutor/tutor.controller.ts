import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { TutorService } from "./tutor.service";

@Controller("tutor")
@UseGuards(ClerkAuthGuard)
export class TutorController {
  constructor(private readonly tutorService: TutorService) {}

  @Get("remaining")
  getRemaining(@CurrentUser() user: any, @Query("subjectId") subjectId: string) {
    return this.tutorService.getRemainingToday(user.id, subjectId);
  }

  @Get("conversations")
  listConversations(@CurrentUser() user: any) {
    return this.tutorService.listConversations(user.id);
  }

  @Get("conversations/:id")
  getConversation(@CurrentUser() user: any, @Param("id") id: string) {
    return this.tutorService.getConversation(user.id, id);
  }

  @Post("message")
  sendMessage(
    @CurrentUser() user: any,
    @Body() body: { subjectId: string; topicId?: string; conversationId?: string; message: string },
  ) {
    return this.tutorService.sendMessage(user.id, body);
  }
}
