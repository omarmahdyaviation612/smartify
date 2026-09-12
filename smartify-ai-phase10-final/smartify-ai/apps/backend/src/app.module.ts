import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { PricingModule } from "./pricing/pricing.module";
import { CurriculaModule } from "./curricula/curricula.module";
import { OnboardingModule } from "./onboarding/onboarding.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { AIModule } from "./ai/ai.module";
import { TutorModule } from "./tutor/tutor.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { PracticeModule } from "./practice/practice.module";
import { QuizzesModule } from "./quizzes/quizzes.module";
import { PaymentsModule } from "./payments/payments.module";
import { BillingModule } from "./billing/billing.module";
import { AdminCurriculumModule } from "./admin/curriculum/admin-curriculum.module";
import { AdminAIConfigModule } from "./admin/ai-config/admin-ai-config.module";
import { AdminPaymentsModule } from "./admin/payments/admin-payments.module";
import { AdminRevenueModule } from "./admin/revenue/admin-revenue.module";
import { ParentModule } from "./parent/parent.module";
import { TutorQuestionPacksModule } from "./tutor-question-packs/tutor-question-packs.module";
import { HealthModule } from "./health/health.module";
import { InstapayModule } from "./instapay/instapay.module";
import { AdminInstapayModule } from "./admin/instapay/admin-instapay.module";
import { InteractiveLessonModule } from "./interactive-lesson/interactive-lesson.module";

@Module({
  imports: [
    // Baseline rate limiting (production hardening, Phase 10): 100
    // requests/60s per IP by default, using Nest's in-memory store — good
    // enough for a single-instance MVP deploy. A multi-instance production
    // deploy should swap this for a Redis-backed throttler storage
    // (@nestjs/throttler supports this) so limits are shared across
    // instances; that swap doesn't change any application code.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    PricingModule,
    CurriculaModule,
    OnboardingModule,
    DashboardModule,
    AIModule,
    TutorModule,
    AnalyticsModule,
    PracticeModule,
    QuizzesModule,
    PaymentsModule,
    BillingModule,
    AdminCurriculumModule,
    AdminAIConfigModule,
    AdminPaymentsModule,
    AdminRevenueModule,
    ParentModule,
    TutorQuestionPacksModule,
    InstapayModule,
    AdminInstapayModule,
    InteractiveLessonModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
