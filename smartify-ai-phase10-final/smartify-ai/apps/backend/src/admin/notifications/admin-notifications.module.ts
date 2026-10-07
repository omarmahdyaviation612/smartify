import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { NotificationsModule } from "../../notifications/notifications.module";
import { AdminNotificationsController } from "./admin-notifications.controller";

@Module({ imports: [AuthModule, NotificationsModule], controllers: [AdminNotificationsController] })
export class AdminNotificationsModule {}
