import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { AdminRevenueController } from "./admin-revenue.controller";
import { AdminRevenueService } from "./admin-revenue.service";

@Module({
  imports: [AuthModule],
  controllers: [AdminRevenueController],
  providers: [AdminRevenueService],
})
export class AdminRevenueModule {}
