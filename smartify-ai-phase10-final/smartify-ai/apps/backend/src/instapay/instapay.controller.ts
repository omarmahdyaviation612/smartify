import { Body, Controller, Get, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { InstapayService, type ReceiptFile } from "./instapay.service";

@Controller("instapay")
@UseGuards(ClerkAuthGuard)
export class InstapayController {
  constructor(private readonly service: InstapayService) {}

  @Get("config")
  getConfig() {
    return { available: this.service.isConfigured() };
  }

  @Get("submissions/mine")
  listMine(@CurrentUser() user: any) {
    return this.service.listMine(user.id);
  }

  @Post("subscription/initiate")
  initiateSubscription(@CurrentUser() user: any, @Body() body: { subjectIds: string[] }) {
    return this.service.initiateSubscription(user.id, body);
  }

  @Post("question-pack/initiate")
  initiateQuestionPack(@CurrentUser() user: any, @Body("subjectId") subjectId: string) {
    return this.service.initiateQuestionPack(user.id, subjectId);
  }

  @Post("submissions")
  @UseInterceptors(FileInterceptor("receipt"))
  submitReceipt(
    @CurrentUser() user: any,
    @UploadedFile() file: ReceiptFile | undefined,
    @Body() body: { referenceId: string; submittedAmountEGP: string; senderName?: string; note?: string },
  ) {
    return this.service.submitReceipt(
      user.id,
      { referenceId: body.referenceId, submittedAmountEGP: Number(body.submittedAmountEGP), senderName: body.senderName, note: body.note },
      file,
    );
  }
}
