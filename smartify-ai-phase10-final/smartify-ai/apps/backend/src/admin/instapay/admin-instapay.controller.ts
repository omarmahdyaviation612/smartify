import { Body, Controller, Get, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ClerkAuthGuard } from "../../auth/clerk-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UserRole } from "@smartify/shared-types";
import { AdminInstapayService } from "./admin-instapay.service";

// Manual-payment confirmation is a financial action — SUPER_ADMIN/ADMIN
// only, same bar as admin-payments.controller.ts's provider switch.
@Controller("admin/instapay")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class AdminInstapayController {
  constructor(private readonly service: AdminInstapayService) {}

  @Get("pending")
  listPending() {
    return this.service.listPending();
  }

  @Get("pending-count")
  getPendingCount() {
    return this.service.getPendingCount();
  }

  @Get("history")
  listHistory() {
    return this.service.listHistory();
  }

  @Get("submissions/:id/receipt")
  async getReceipt(@Param("id") id: string, @Res() response: Response) {
    const { receiptImage, receiptMimeType } = await this.service.getReceipt(id);
    response.set("Content-Type", receiptMimeType);
    response.set("Cache-Control", "private, no-store");
    response.send(receiptImage);
  }

  @Post("submissions/:id/confirm")
  confirm(@Param("id") id: string, @CurrentUser() user: any) {
    return this.service.confirm(id, user.id);
  }

  @Post("submissions/:id/reject")
  reject(@Param("id") id: string, @CurrentUser() user: any, @Body("reason") reason?: string) {
    return this.service.reject(id, user.id, reason);
  }
}
