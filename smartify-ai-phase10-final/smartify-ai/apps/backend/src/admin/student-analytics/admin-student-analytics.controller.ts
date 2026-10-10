import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../../auth/clerk-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "@smartify/shared-types";
import { AdminStudentAnalyticsService } from "./admin-student-analytics.service";

const STATUSES = ["paid", "trial", "registered", "all"] as const;

/** Student data + analytics: personal data (names, schools, locations), so Super Admin / Admin only. */
@Controller("admin/student-analytics")
@UseGuards(ClerkAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class AdminStudentAnalyticsController {
  constructor(private readonly service: AdminStudentAnalyticsService) {}

  @Get("overview")
  overview(@Query("days") days?: string, @Query("includeTest") includeTest?: string) {
    return this.service.overview(days ? Number(days) : 30, includeTest === "true");
  }

  @Get("students")
  listStudents(
    @Query("q") q?: string,
    @Query("curriculumId") curriculumId?: string,
    @Query("gradeId") gradeId?: string,
    @Query("governorate") governorate?: string,
    @Query("status") status?: string,
    @Query("includeTest") includeTest?: string,
  ) {
    return this.service.listStudents({
      q,
      curriculumId: curriculumId || undefined,
      gradeId: gradeId || undefined,
      governorate: governorate || undefined,
      status: (STATUSES as readonly string[]).includes(status ?? "") ? (status as (typeof STATUSES)[number]) : "all",
      includeTest: includeTest === "true",
    });
  }

  @Get("students/:studentId")
  studentDetail(@Param("studentId") studentId: string) {
    return this.service.studentDetail(studentId);
  }
}
