import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AIModule } from "../ai/ai.module";
import { HomeworkController } from "./homework.controller";
import { HomeworkService } from "./homework.service";
import { HomeworkImageService } from "./homework-image.service";
import { HomeworkQuotaService } from "./homework-quota.service";
import { HomeworkTopicMatcher } from "./homework-topic-matcher";

@Module({ imports: [AuthModule, AIModule], controllers: [HomeworkController], providers: [HomeworkService, HomeworkImageService, HomeworkQuotaService, HomeworkTopicMatcher] })
export class HomeworkModule {}
