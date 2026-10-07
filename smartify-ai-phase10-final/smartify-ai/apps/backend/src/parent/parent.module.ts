import { Module } from "@nestjs/common";
import { ParentController, StudentLinksController } from "./parent.controller";
import { ParentService } from "./parent.service";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { AIModule } from "../ai/ai.module";

@Module({
  imports: [AuthModule, AnalyticsModule, AIModule],
  controllers: [ParentController, StudentLinksController],
  providers: [ParentService],
})
export class ParentModule {}
