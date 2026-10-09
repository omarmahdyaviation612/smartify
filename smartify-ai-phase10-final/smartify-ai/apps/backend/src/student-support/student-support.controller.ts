import { Body, Controller, Get, Header, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";
import type { Response } from "express";
import { UserRole } from "@smartify/shared-types";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { StudentSupportService } from "./student-support.service";

const uploadOptions: MulterOptions & { limits: NonNullable<MulterOptions["limits"]> & { fileSize: number; fieldNestingDepth: number; files: number; fields: number } } = { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3, fieldNestingDepth: 0 } };

@Controller("student-support")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.STUDENT)
export class StudentSupportController {
  constructor(private readonly service: StudentSupportService) {}
  @Get("tickets") @Header("Cache-Control", "private, no-store") list(@CurrentUser() user: any) { return this.service.listMine(user.id); }
  @Post("tickets") @Header("Cache-Control", "private, no-store") @UseInterceptors(FileInterceptor("screenshot", uploadOptions))
  create(@CurrentUser() user: any, @Body() body: { description?: string; route?: string; locale?: string }, @UploadedFile() file?: any) {
    try { return this.service.create(user.id, body ?? {}, file); }
    finally { if (Buffer.isBuffer(file?.buffer)) file.buffer.fill(0); }
  }
  @Get("tickets/:id") @Header("Cache-Control", "private, no-store") get(@CurrentUser() user: any, @Param("id") id: string) { return this.service.getMine(user.id, id); }
  @Post("tickets/:id/messages") @Header("Cache-Control", "private, no-store") reply(@CurrentUser() user: any, @Param("id") id: string, @Body() body: { message?: string }) { return this.service.reply(user.id, id, body ?? {}); }
  @Post("tickets/:id/escalate") escalate(@CurrentUser() user: any, @Param("id") id: string) { return this.service.escalate(user.id, id); }
  @Post("tickets/:id/reopen") reopen(@CurrentUser() user: any, @Param("id") id: string) { return this.service.reopen(user.id, id); }
  @Post("tickets/:id/close") close(@CurrentUser() user: any, @Param("id") id: string) { return this.service.closeMine(user.id, id); }
  @Get("tickets/:id/screenshot") @Header("Cache-Control", "private, no-store") async screenshot(@CurrentUser() user: any, @Param("id") id: string, @Res() response: Response) {
    const file = await this.service.attachmentForStudent(user.id, id);
    response.setHeader("Content-Type", file.mime ?? "application/octet-stream"); response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("Content-Disposition", "inline");
    response.send(file.data);
  }
}

@Controller("admin/support")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.SUPPORT, UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminStudentSupportController {
  constructor(private readonly service: StudentSupportService) {}
  @Get() list() { return this.service.adminList(); }
  @Get(":id") get(@Param("id") id: string) { return this.service.adminGet(id); }
  @Post(":id/status") status(@CurrentUser() user: any, @Param("id") id: string, @Body() body: { status?: string }) { return this.service.adminStatus(id, user.id, body?.status ?? ""); }
  @Post(":id/replies") reply(@CurrentUser() user: any, @Param("id") id: string, @Body() body: { message?: string }) { return this.service.adminReply(id, user.id, body?.message ?? ""); }
  @Get(":id/screenshot") @Header("Cache-Control", "private, no-store") async screenshot(@Param("id") id: string, @Res() response: Response) {
    const file = await this.service.attachmentForAdmin(id);
    response.setHeader("Content-Type", file.mime ?? "application/octet-stream"); response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("Content-Disposition", "inline");
    response.send(file.data);
  }
}
