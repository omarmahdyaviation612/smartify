import { Module } from "@nestjs/common";
import { AIModule } from "../ai/ai.module";
import { AuthModule } from "../auth/auth.module";
import { EmailModule } from "../email/email.module";
import { AdminStudentSupportController, StudentSupportController } from "./student-support.controller";
import { StudentSupportService } from "./student-support.service";
import { StudentSupportStorageService } from "./student-support-storage.service";

@Module({ imports: [AuthModule, AIModule, EmailModule], controllers: [StudentSupportController, AdminStudentSupportController], providers: [StudentSupportService, StudentSupportStorageService] })
export class StudentSupportModule {}
