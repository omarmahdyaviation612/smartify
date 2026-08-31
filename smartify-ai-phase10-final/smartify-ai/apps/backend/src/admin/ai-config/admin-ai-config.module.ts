import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { AdminAIConfigController } from "./admin-ai-config.controller";
import { AdminAIConfigService } from "./admin-ai-config.service";

@Module({
  imports: [AuthModule],
  controllers: [AdminAIConfigController],
  providers: [AdminAIConfigService],
})
export class AdminAIConfigModule {}
