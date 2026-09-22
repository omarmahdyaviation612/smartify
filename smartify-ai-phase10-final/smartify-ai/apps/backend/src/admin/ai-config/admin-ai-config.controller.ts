import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../../auth/clerk-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "@smartify/shared-types";
import { AdminAIConfigService } from "./admin-ai-config.service";
import { updateAIProviderSchema, updateAISpendingControlsSchema } from "@smartify/validation";
import { parseBody } from "../../common/validation/parse-body";

// SUPER_ADMIN only — provider cost rates and aggregate spend are exactly
// the "raw provider-cost config" the Phase 2 role design excludes ADMIN from.
@Controller("admin/ai-config")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminAIConfigController {
  constructor(private readonly service: AdminAIConfigService) {}

  @Get("providers")
  listProviders() {
    return this.service.listProviders();
  }

  @Patch("providers/:providerKey")
  updateProvider(@Param("providerKey") providerKey: string, @Body() body: unknown) {
    return this.service.updateProvider(providerKey, parseBody(updateAIProviderSchema, body));
  }

  @Get("system-config/:key")
  getSystemConfig(@Param("key") key: string) {
    return this.service.getSystemConfig(key);
  }

  @Patch("system-config/:key")
  updateSystemConfig(@Param("key") key: string, @Body() body: { value: unknown; description?: string }) {
    return this.service.updateSystemConfig(key, body.value, body.description);
  }

  @Get("usage-summary")
  getUsageSummary(@Query("days") days?: string) {
    return this.service.getUsageSummary(days ? Number(days) : undefined);
  }

  @Get("budget-status")
  getBudgetStatus() {
    return this.service.getBudgetStatus();
  }

  @Patch("spending-controls")
  updateSpendingControls(@Body() body: unknown) {
    return this.service.updateSpendingControls(parseBody(updateAISpendingControlsSchema, body));
  }

  // Admin AI Cost / Budget Dashboard (2026-09-20) — read-only, reuses the
  // existing AIUsage ledger and budget config above; same SUPER_ADMIN-only
  // boundary as the rest of this controller.
  @Get("cost-overview")
  getCostOverview() {
    return this.service.getCostOverview();
  }

  @Get("students-spend")
  listStudentSpend(@Query("days") days?: string) {
    return this.service.listStudentSpend(days ? Number(days) : undefined);
  }

  @Get("students/:studentId/spend")
  getStudentSpendDetail(@Param("studentId") studentId: string, @Query("days") days?: string) {
    return this.service.getStudentSpendDetail(studentId, days ? Number(days) : undefined);
  }
}
