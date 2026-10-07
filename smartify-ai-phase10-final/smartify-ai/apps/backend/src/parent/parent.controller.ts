import { Body, Controller, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { UserRole } from "@smartify/shared-types";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ParentService } from "./parent.service";
import { ParentInstapayService } from "./parent-instapay.service";
import type { ReceiptFile } from "../instapay/instapay.service";

@Controller("parent")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.PARENT)
export class ParentController {
  constructor(private readonly service: ParentService, private readonly instapay: ParentInstapayService) {}

  @Post("profile")
  @Roles(UserRole.PARENT)
  bootstrap(@CurrentUser() user: any, @Body() body: { fullName: string }) {
    return this.service.bootstrapProfile(user.id, body?.fullName);
  }

  @Post("links/accept")
  // A valid student-issued, single-use invitation is the credential that
  // allows an incomplete default STUDENT account to become a parent.
  @Roles(UserRole.PARENT, UserRole.STUDENT)
  accept(@CurrentUser() user: any, @Body() body: { code: string }) {
    return this.service.acceptCode(user.id, body?.code);
  }

  @Get("students")
  @Roles(UserRole.PARENT)
  students(@CurrentUser() user: any) { return this.service.listStudents(user.id); }

  @Get("dashboard/summary")
  @Roles(UserRole.PARENT)
  summary(@CurrentUser() user: any) { return this.service.dashboardSummary(user.id); }

  @Post("children/:studentId/instapay/subscription/initiate")
  initiateChildSubscription(@CurrentUser() user: any, @Param("studentId") studentId: string, @Body() body: { subjectIds: string[]; homeworkAddon?: boolean; homeworkAddonAllowance?: number }) {
    return this.instapay.initiateSubscription(user.id, studentId, body);
  }
  @Post("children/:studentId/instapay/question-pack/initiate")
  initiateChildPack(@CurrentUser() user: any, @Param("studentId") studentId: string, @Body("subjectId") subjectId: string) {
    return this.instapay.initiateQuestionPack(user.id, studentId, subjectId);
  }
  @Get("children/:studentId/instapay/submissions")
  childSubmissions(@CurrentUser() user: any, @Param("studentId") studentId: string) { return this.instapay.listSubmissions(user.id, studentId); }
  @Post("children/:studentId/instapay/receipt")
  @UseInterceptors(FileInterceptor("receipt", { limits: { fileSize: 5 * 1024 * 1024 } }))
  childReceipt(@CurrentUser() user: any, @Param("studentId") studentId: string, @UploadedFile() file: ReceiptFile | undefined, @Body() body: { referenceId: string; submittedAmountEGP: string; senderName?: string; note?: string }) {
    return this.instapay.submitReceipt(user.id, studentId, { referenceId: body.referenceId, submittedAmountEGP: Number(body.submittedAmountEGP), senderName: body.senderName, note: body.note }, file);
  }
}

@Controller("student")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.STUDENT)
export class StudentLinksController {
  constructor(private readonly service: ParentService) {}

  @Post("link-code")
  createCode(@CurrentUser() user: any) { return this.service.createStudentCode(user.id); }
}
