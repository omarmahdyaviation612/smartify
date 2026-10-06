import { Module } from "@nestjs/common";
import { AIProviderFactory } from "./ai-provider.factory";
import { AIContextBuilderService } from "./context/ai-context-builder.service";
import { AIUsageService } from "./usage/ai-usage.service";
import { TopicGroundingAssignmentService } from "./context/topic-grounding-assignment.service";

@Module({
  // TopicGroundingMapperService (the bounded AI mapper) is DELIBERATELY absent
// here: it is never provided by any module that a request-handling controller
// can reach. The preparation/backfill script constructs it explicitly. See
// topic-grounding-mapper.service.ts.
  providers: [AIProviderFactory, AIContextBuilderService, AIUsageService, TopicGroundingAssignmentService],
  exports: [AIProviderFactory, AIContextBuilderService, AIUsageService, TopicGroundingAssignmentService],
})
export class AIModule {}
