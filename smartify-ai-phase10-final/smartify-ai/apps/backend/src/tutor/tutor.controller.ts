import { Body, Controller, Get, Header, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { TutorService } from "./tutor.service";
import { TutorSpeechService } from "./tutor-speech.service";

@Controller("tutor")
@UseGuards(ClerkAuthGuard)
export class TutorController {
  constructor(
    private readonly tutorService: TutorService,
    private readonly speechService: TutorSpeechService,
  ) {}

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

  /**
   * Reads an already-generated Tutor reply aloud. Deliberately NOT
   * quota-gated — the question this text answers was already paid for by
   * /tutor/message; replaying or re-requesting the same text here never
   * touches Free Trial/subscription state. `conversationId` is required so
   * the service can verify `text` actually matches a reply from a
   * conversation the caller owns — see TutorSpeechService.synthesize for
   * why this is not a raw text-to-speech proxy.
   */
  @Post("speech")
  @Header("Cache-Control", "private, no-store")
  async synthesizeSpeech(
    @CurrentUser() user: any,
    @Body() body: { text: string; conversationId: string },
    @Res() response: Response,
  ) {
    const audio = await this.speechService.synthesize({ userId: user.id, conversationId: body?.conversationId, text: body?.text });
    response.set("Content-Type", "audio/mpeg");
    response.send(audio);
  }
}
