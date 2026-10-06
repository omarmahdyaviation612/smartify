import { BadRequestException, Body, Controller, Get, Header, Param, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { HomeworkService } from "./homework.service";

const uploadOptions: MulterOptions & { limits: NonNullable<MulterOptions["limits"]> & { fileSize: number; fieldNestingDepth: number; files: number; fields: number } } = {
  limits: { fileSize: 8 * 1024 * 1024, fieldNestingDepth: 0, files: 1, fields: 1 },
};

@Controller("homework")
@UseGuards(ClerkAuthGuard)
export class HomeworkController {
  constructor(private readonly service: HomeworkService) {}
  @Get("status") @Header("Cache-Control", "private, no-store") status(@CurrentUser() user: any) { return this.service.status(user.id); }
  @Get("sessions") @Header("Cache-Control", "private, no-store") list(@CurrentUser() user: any) { return this.service.listSessions(user.id); }
  @Get("sessions/:id") @Header("Cache-Control", "private, no-store") get(@CurrentUser() user: any, @Param("id") id: string) { return this.service.getSession(user.id, id); }
  @Post("sessions") @Header("Cache-Control", "private, no-store") @UseInterceptors(FileInterceptor("photo", uploadOptions))
  upload(@CurrentUser() user: any, @UploadedFile() photo: any, @Body() body: { subjectId?: string }) {
    if (!photo?.buffer) throw new BadRequestException("Choose one exercise photo.");
    if (!body?.subjectId || typeof body.subjectId !== "string") { photo.buffer.fill(0); throw new BadRequestException("Select a subject first."); }
    return this.service.upload(user.id, body.subjectId, photo);
  }
  @Post("sessions/:id/topic") @Header("Cache-Control", "private, no-store") confirmTopic(@CurrentUser() user: any, @Param("id") id: string, @Body() body: { topicId?: string }) {
    return this.service.confirmTopic(user.id, id, body?.topicId ?? "");
  }
  @Post("sessions/:id/turn") @Header("Cache-Control", "private, no-store") turn(@CurrentUser() user: any, @Param("id") id: string, @Body() body: { message?: string; kind?: "ANSWER" | "HELP" | "REVEAL_SOLUTION" }) {
    if (!["ANSWER", "HELP", "REVEAL_SOLUTION"].includes(body?.kind ?? "")) throw new BadRequestException("Choose an answer, hint, or solution request.");
    return this.service.turn(user.id, id, body as { message?: string; kind: "ANSWER" | "HELP" | "REVEAL_SOLUTION" });
  }
}
