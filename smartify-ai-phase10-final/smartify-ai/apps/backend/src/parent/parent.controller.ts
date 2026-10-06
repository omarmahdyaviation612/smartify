import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@smartify/shared-types";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { ParentService } from "./parent.service";

@Controller("parent")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.PARENT)
export class ParentController {
  constructor(private readonly service: ParentService) {}

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
}

@Controller("student")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.STUDENT)
export class StudentLinksController {
  constructor(private readonly service: ParentService) {}

  @Post("link-code")
  createCode(@CurrentUser() user: any) { return this.service.createStudentCode(user.id); }
}
