import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@smartify/shared-types";
import { ClerkAuthGuard } from "../../auth/clerk-auth.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RolesGuard } from "../../common/guards/roles.guard";
import { TeacherRequestsService } from "../../teacher-requests/teacher-requests.service";

@Controller("admin/teacher-requests")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class AdminTeacherRequestsController {
  constructor(private readonly service: TeacherRequestsService) {}
  @Get() list() { return this.service.listForAdmin(); }
  @Post(":id/status") update(@Param("id") id: string, @Body() body: { status: string; adminNote?: string }) { return this.service.updateStatus(id, body?.status, body?.adminNote); }
}
