import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminTeacherRequestsController } from "../admin/teacher-requests/admin-teacher-requests.controller";
import { ParentTeacherRequestsController } from "./parent-teacher-requests.controller";
import { TeacherRequestsService } from "./teacher-requests.service";

@Module({ imports: [AuthModule], controllers: [ParentTeacherRequestsController, AdminTeacherRequestsController], providers: [TeacherRequestsService] })
export class TeacherRequestsModule {}
