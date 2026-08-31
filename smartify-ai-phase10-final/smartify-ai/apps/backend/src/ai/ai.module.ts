import { Module } from "@nestjs/common";
import { AIProviderFactory } from "./ai-provider.factory";
import { AIContextBuilderService } from "./context/ai-context-builder.service";
import { AIUsageService } from "./usage/ai-usage.service";

@Module({
  providers: [AIProviderFactory, AIContextBuilderService, AIUsageService],
  exports: [AIProviderFactory, AIContextBuilderService, AIUsageService],
})
export class AIModule {}
