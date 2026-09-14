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
}
