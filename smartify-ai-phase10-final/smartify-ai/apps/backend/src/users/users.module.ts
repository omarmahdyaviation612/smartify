import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [AuthModule], // needs ClerkAuthGuard
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
