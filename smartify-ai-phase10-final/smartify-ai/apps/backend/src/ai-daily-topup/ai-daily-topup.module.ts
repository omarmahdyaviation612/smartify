import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AIModule } from "../ai/ai.module";
import { AIDailyTopUpController } from "./ai-daily-topup.controller";
import { AIDailyTopUpService } from "./ai-daily-topup.service";

@Module({
  imports: [AuthModule, AIModule],
  controllers: [AIDailyTopUpController],
  providers: [AIDailyTopUpService],
  exports: [AIDailyTopUpService],
})
export class AIDailyTopUpModule {}
