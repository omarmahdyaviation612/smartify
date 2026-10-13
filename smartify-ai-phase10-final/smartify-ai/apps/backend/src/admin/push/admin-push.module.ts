import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { AdminPushController } from "./admin-push.controller";
import { AdminPushService } from "./admin-push.service";

@Module({
  imports: [AuthModule],
  controllers: [AdminPushController],
  providers: [AdminPushService],
  exports: [AdminPushService],
})
export class AdminPushModule {}
