import { Controller, Get, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AIDailyTopUpService } from "./ai-daily-topup.service";

@Controller("ai-topup")
@UseGuards(ClerkAuthGuard)
export class AIDailyTopUpController {
  constructor(private readonly service: AIDailyTopUpService) {}

  @Get("status")
  status(@CurrentUser() user: any) {
    return this.service.getStatus(user.id);
  }
}
