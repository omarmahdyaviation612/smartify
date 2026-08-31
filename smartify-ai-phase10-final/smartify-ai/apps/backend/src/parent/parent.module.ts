import { Module } from "@nestjs/common";
import { ParentController, StudentLinksController } from "./parent.controller";
import { ParentService } from "./parent.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [ParentController, StudentLinksController],
  providers: [ParentService],
})
export class ParentModule {}
