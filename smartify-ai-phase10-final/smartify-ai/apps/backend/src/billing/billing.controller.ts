import { Body, Controller, Get, Header, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { BillingService } from "./billing.service";

@Controller("billing")
@UseGuards(ClerkAuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get("subjects")
  getSubjects(@CurrentUser() user: any) {
    return this.billingService.getAvailableSubjects(user.id);
  }

  @Get("subscription")
  async getSubscription(@CurrentUser() user: any, @Res() response: Response) {
    // Nest sends an empty body for a returned null; clients expect JSON.
    return response.json(await this.billingService.getCurrentSubscription(user.id));
  }

  @Get("homework-addon")
  getHomeworkAddonPricing() { return this.billingService.getHomeworkAddonPricing(); }

  @Get("payment-status")
  @Header("Cache-Control", "no-store")
  getPaymentStatus(@CurrentUser() user: any) {
    return this.billingService.getPaymentStatus(user.id);
  }

  @Post("checkout")
  startCheckout(@CurrentUser() user: any, @Body() body: { subjectIds: string[]; homeworkAddon?: boolean; homeworkAddonAllowance?: number }) {
    return this.billingService.startCheckout(user.id, body);
  }

  @Post("cancel")
  cancel(@CurrentUser() user: any) {
    return this.billingService.cancelSubscription(user.id);
  }
}
