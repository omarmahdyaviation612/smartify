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
  bootstrap(@CurrentUser() user: any, @Body() body: { fullName: string }) {
    return this.service.bootstrapProfile(user.id, body?.fullName);
  }

  @Post("links/accept")
  accept(@CurrentUser() user: any, @Body() body: { code: string }) {
    return this.service.acceptCode(user.id, body?.code);
  }

  @Get("students")
  students(@CurrentUser() user: any) { return this.service.listStudents(user.id); }

  @Get("dashboard/summary")
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
