import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TrialController } from "./trial.controller";
import { TrialService } from "./trial.service";

@Module({
  imports: [AuthModule],
  controllers: [TrialController],
  providers: [TrialService],
  exports: [TrialService],
})
export class TrialModule {}
