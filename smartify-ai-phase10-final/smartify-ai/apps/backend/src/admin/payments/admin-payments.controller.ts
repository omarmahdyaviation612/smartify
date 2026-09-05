import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../../auth/clerk-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "@smartify/shared-types";
import { AdminPaymentsService } from "./admin-payments.service";
import { updatePaymentProviderSchema } from "@smartify/validation";
import { parseBody } from "../../common/validation/parse-body";

// SUPER_ADMIN only — activating a real payment provider is a financial/
// operational decision, not a content-management one.
@Controller("admin/payments")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminPaymentsController {
  constructor(private readonly service: AdminPaymentsService) {}

  @Get("providers")
  listProviders() {
    return this.service.listProviders();
  }

  @Patch("providers/:providerKey")
  updateProvider(@Param("providerKey") providerKey: string, @Body() body: unknown) {
    return this.service.updateProvider(providerKey, parseBody(updatePaymentProviderSchema, body));
  }
}
