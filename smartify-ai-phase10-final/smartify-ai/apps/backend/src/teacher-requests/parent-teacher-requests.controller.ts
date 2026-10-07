import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@smartify/shared-types";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { TeacherRequestsService } from "./teacher-requests.service";

@Controller("parent/teacher-requests")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.PARENT)
export class ParentTeacherRequestsController {
  constructor(private readonly service: TeacherRequestsService) {}
  @Get() list(@CurrentUser() user: any) { return this.service.listMine(user.id); }
  @Post() create(@CurrentUser() user: any, @Body() body: any) { return this.service.create(user.id, body); }
}
