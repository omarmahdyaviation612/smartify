import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../../auth/clerk-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "@smartify/shared-types";
import { AdminRevenueService } from "./admin-revenue.service";

@Controller("admin/revenue")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminRevenueController {
  constructor(private readonly service: AdminRevenueService) {}

  @Get("summary")
  getSummary(@Query("days") days?: string) {
    return this.service.getRevenueVsCostSummary(days ? Number(days) : undefined);
  }

  @Get("growth-summary")
  getGrowthSummary() {
    return this.service.getGrowthSummary();
  }

  @Get("referrals")
  listReferrals() {
    return this.service.listReferrals();
  }
}
