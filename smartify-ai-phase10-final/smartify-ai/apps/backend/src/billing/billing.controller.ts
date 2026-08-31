import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { BillingService } from "./billing.service";

@Controller("billing")
@UseGuards(ClerkAuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get("plans")
  getPlans(@CurrentUser() user: any) {
    return this.billingService.getAvailablePlans(user.id);
  }

  @Get("subscription")
  getSubscription(@CurrentUser() user: any) {
    return this.billingService.getCurrentSubscription(user.id);
  }

  @Post("checkout")
  startCheckout(
    @CurrentUser() user: any,
    @Body() body: { pricingPlanId: string; additionalSubjectsCount?: number; subjectIds?: string[] },
  ) {
    return this.billingService.startCheckout(user.id, body);
  }

  @Post("cancel")
  cancel(@CurrentUser() user: any) {
    return this.billingService.cancelSubscription(user.id);
  }
}
