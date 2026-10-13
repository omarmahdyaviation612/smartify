import { BadRequestException, Body, Controller, Get, Headers, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@smartify/shared-types";
import { adminPushSubscriptionSchema } from "@smartify/validation";
import { loadBackendEnv } from "@smartify/config";
import { ClerkAuthGuard } from "../../auth/clerk-auth.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RolesGuard } from "../../common/guards/roles.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { parseBody } from "../../common/validation/parse-body";
import { AdminPushService } from "./admin-push.service";

/** Pop-up notifications on admin devices (new InstaPay receipts). */
@Controller("admin/push")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class AdminPushController {
  constructor(private readonly push: AdminPushService) {}

  @Get("config")
  config(@CurrentUser() user: any) {
    return this.push.config(user.id);
  }

  @Post("subscribe")
  subscribe(@CurrentUser() user: any, @Body() body: unknown, @Headers("user-agent") userAgent?: string) {
    return this.push.subscribe(user.id, parseBody(adminPushSubscriptionSchema, body), userAgent);
  }

  @Post("unsubscribe")
  unsubscribe(@CurrentUser() user: any, @Body() body: { endpoint?: unknown }) {
    if (typeof body?.endpoint !== "string" || !body.endpoint) throw new BadRequestException("endpoint is required.");
    return this.push.unsubscribe(user.id, body.endpoint);
  }

  @Post("test")
  test(@CurrentUser() user: any) {
    const url = `${loadBackendEnv().FRONTEND_URL.replace(/\/$/, "")}/ar/admin/instapay`;
    return this.push.sendTest(user.id, {
      title: "✅ إشعارات Smartify شغالة",
      body: "هيوصلك إشعار زي ده أول ما عميل يبعت إيصال InstaPay.",
      url,
      tag: "smartify-test",
    });
  }
}
