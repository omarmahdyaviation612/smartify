import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { AdminCurriculumController } from "./admin-curriculum.controller";
import { AdminCurriculumService } from "./admin-curriculum.service";

@Module({
  imports: [AuthModule],
  controllers: [AdminCurriculumController],
  providers: [AdminCurriculumService],
})
export class AdminCurriculumModule {}
