import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { AdminStudentAnalyticsController } from "./admin-student-analytics.controller";
import { AdminStudentAnalyticsService } from "./admin-student-analytics.service";

@Module({
  imports: [AuthModule],
  controllers: [AdminStudentAnalyticsController],
  providers: [AdminStudentAnalyticsService],
})
export class AdminStudentAnalyticsModule {}
