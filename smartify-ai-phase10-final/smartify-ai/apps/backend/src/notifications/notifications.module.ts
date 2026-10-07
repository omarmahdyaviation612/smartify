import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { ResultNotificationService } from "./result-notification.service";

@Module({
  imports: [EmailModule],
  providers: [ResultNotificationService],
  exports: [ResultNotificationService],
})
export class NotificationsModule {}
