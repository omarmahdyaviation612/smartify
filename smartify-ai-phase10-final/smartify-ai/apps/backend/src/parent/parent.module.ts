import { Module } from "@nestjs/common";
import { ParentController, StudentLinksController } from "./parent.controller";
import { ParentService } from "./parent.service";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { AIModule } from "../ai/ai.module";
import { InstapayModule } from "../instapay/instapay.module";
import { ParentInstapayService } from "./parent-instapay.service";

@Module({
  imports: [AuthModule, AnalyticsModule, AIModule, InstapayModule],
  controllers: [ParentController, StudentLinksController],
  providers: [ParentService, ParentInstapayService],
})
export class ParentModule {}
