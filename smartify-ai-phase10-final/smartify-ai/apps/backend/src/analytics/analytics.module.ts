import { Module } from "@nestjs/common";
import { TopicAccuracyService } from "./topic-accuracy.service";

@Module({
  providers: [TopicAccuracyService],
  exports: [TopicAccuracyService],
})
export class AnalyticsModule {}
