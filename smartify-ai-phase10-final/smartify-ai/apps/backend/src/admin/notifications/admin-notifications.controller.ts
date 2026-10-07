import { BadRequestException, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@smartify/shared-types";
import { ClerkAuthGuard } from "../../auth/clerk-auth.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ResultNotificationService } from "../../notifications/result-notification.service";

@Controller("admin/parent-notifications")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class AdminNotificationsController {
  constructor(private readonly notifications: ResultNotificationService) {}

  @Get("failed")
  listFailed() { return this.notifications.listFailed(); }

  @Post(":id/retry/:channel")
  retry(@Param("id") id: string, @Param("channel") channel: string) {
    if (channel !== "email") throw new BadRequestException("Unsupported notification channel.");
    return this.notifications.retry(id);
  }
}
