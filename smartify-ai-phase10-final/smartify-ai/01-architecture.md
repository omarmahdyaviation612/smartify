# Smartify AI — Phase 1: Architecture & Foundation Plan

**LEARN • PRACTICE • ACHIEVE**

---

## 1. Current Project Analysis

There is no existing codebase — this is a greenfield build. The only existing asset is the official logo (robot-mascot mark, graduation cap, open book, navy wordmark with a blue→purple gradient "AI," tagline beneath). That logo drives the design system in Section 8.

Because this is fresh, Phase 1 is a **proposal to approve**, not a report on existing code. Nothing gets built until you sign off on the schema and structure below — per the working rules, foundation decisions (schema, auth model, AI abstraction) are expensive to reverse later, so it's worth getting them right before Phase 2 starts writing code.

---

## 2. Recommended Architecture

You chose a **separate backend service** over a monolithic Next.js API. Concretely:

```
┌─────────────────────┐
│   Next.js Frontend   │  (marketing site + student/parent/admin apps)
│  React, TS, Tailwind │
└──────────┬───────────┘
           │ HTTPS / REST (+ SSE for AI streaming)
┌──────────▼───────────┐
│   NestJS Backend API  │  (all business logic, auth, DB access)
└──────────┬───────────┘
           │
   ┌───────┼────────────┬─────────────┐
   ▼       ▼             ▼             ▼
Postgres  AI Service   Payment      Redis
(Prisma)  Layer        Abstraction  (rate limits,
          (provider     (Stripe/    session cache,
          adapters)     Paymob/     job queues)
                        PayPal)
```

**Why NestJS specifically:** it gives you modules/providers/guards out of the box, which maps directly onto the RBAC, rate-limiting, and provider-abstraction requirements in your spec, without inventing that structure by hand in raw Express.

### 2.1 AI Service Layer (provider-agnostic)

```
AIService (NestJS module)
 ├── AIProvider interface       (generate(), streamGenerate(), embedTokens(), etc.)
 ├── OpenAIProvider              implements AIProvider
 ├── AnthropicProvider           implements AIProvider   (future, stubbed)
 ├── LocalModelProvider          implements AIProvider   (future, stubbed)
 ├── AIProviderFactory            selects provider by config, not by feature code
 ├── AICreditService              credits ↔ token budget ↔ provider usage
 ├── AIUsageLogger                writes AIUsage row on every call
 └── AIContextBuilder             assembles student profile + curriculum context into prompts
```

Feature code (tutor chat, assessment generation, exercise grading) never calls `OpenAIProvider` directly — it calls `AIService.generate(request)`, and the factory resolves the concrete provider from a DB/config value (`ai_provider_config` table). Swapping providers is a config change, not a code change.

### 2.2 Credit abstraction

```
Student-facing:  "AI Credits" (e.g., "You have 340 credits left this month")
Internal:        Credits → estimated token budget → actual OpenAI usage → cost in USD
```

Flow on every AI request:
1. Guard checks subscription tier + remaining credits (Redis-cached counter, DB source of truth).
2. Estimate request cost (rough token estimate from prompt length + expected completion length).
3. Reject with a friendly "you're out of credits" response if the estimate exceeds balance — never let a request go through and fail billing after the fact.
4. Call the provider.
5. Compute actual token usage from the response.
6. Deduct actual usage from `AICredits`, write `AIUsage` row (tokens in/out, model, feature, user, cost, timestamp).
7. If actual usage differs meaningfully from estimate, reconcile — don't let estimation drift accumulate silently.

Limits (daily/monthly/per-feature) live in a `SubscriptionPlan` + `AIUsageLimit` table, not in code, so you can retune them without a deploy.

### 2.3 Payment abstraction

```
PaymentProvider interface (charge(), refund(), createSubscription(), handleWebhook())
 ├── StripeProvider
 ├── PaymobProvider   (relevant given Egyptian market)
 └── PayPalProvider
```

Same factory pattern as AI providers — the subscription/billing module talks to `PaymentService`, never to a specific SDK.

---

## 3. Database Schema (PostgreSQL via Prisma)

Below is the core schema. It's long, so I'm giving you the full Prisma models now — this becomes `schema.prisma` in Phase 2's foundation work.

```prisma
// ============ IDENTITY & ROLES ============

enum UserRole {
  STUDENT
  PARENT
  TEACHER
  ADMIN
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  role          UserRole
  isActive      Boolean   @default(true)
  emailVerified DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime?

  studentProfile StudentProfile?
  parentProfile  ParentProfile?
  teacherProfile TeacherProfile?
  auditLogs      AuditLog[]

  @@index([role])
  @@index([email])
}

model StudentProfile {
  id             String   @id @default(cuid())
  userId         String   @unique
  user           User     @relation(fields: [userId], references: [id])
  fullName       String
  age            Int
  country        String
  preferredLang  String   // "ar" | "en"
  curriculumId   String
  curriculum     Curriculum @relation(fields: [curriculumId], references: [id])
  gradeId        String
  grade          Grade      @relation(fields: [gradeId], references: [id])
  weeklyStudyHours Int?
  goals          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  subjects           StudentSubject[]
  progress           StudentProgress[]
  learningPlans      LearningPlan[]
  quizResults        QuizResult[]
  questionAttempts   QuestionAttempt[]
  achievements       StudentAchievement[]
  aiConversations    AIConversation[]
  aiCredits          AICredits?
  subscription       Subscription?
  parentLinks        ParentStudentRelation[]
}

model ParentProfile {
  id       String @id @default(cuid())
  userId   String @unique
  user     User   @relation(fields: [userId], references: [id])
  fullName String
  children ParentStudentRelation[]
}

model TeacherProfile {
  id       String @id @default(cuid())
  userId   String @unique
  user     User   @relation(fields: [userId], references: [id])
  fullName String
  // classes, assignments — future-ready, minimal now
}

model ParentStudentRelation {
  id        String   @id @default(cuid())
  parentId  String
  parent    ParentProfile   @relation(fields: [parentId], references: [id])
  studentId String
  student   StudentProfile  @relation(fields: [studentId], references: [id])
  canViewConversations Boolean @default(false)
  createdAt DateTime @default(now())

  @@unique([parentId, studentId])
}

// ============ CURRICULUM HIERARCHY ============

model Curriculum {
  id           String  @id @default(cuid())
  nameEn       String
  nameAr       String
  code         String  @unique // "EG_NATIONAL" | "BRITISH" | "AMERICAN" | "CUSTOM"
  country      String?
  isActive     Boolean @default(true)

  grades       Grade[]
  studentProfiles StudentProfile[]
}

model Grade {
  id           String  @id @default(cuid())
  curriculumId String
  curriculum   Curriculum @relation(fields: [curriculumId], references: [id])
  nameEn       String
  nameAr       String
  level        Int      // sort order / numeric grade
  isActive     Boolean  @default(true)

  subjects     Subject[]
  studentProfiles StudentProfile[]

  @@index([curriculumId])
}

model Subject {
  id       String  @id @default(cuid())
  gradeId  String
  grade    Grade   @relation(fields: [gradeId], references: [id])
  nameEn   String
  nameAr   String
  icon     String?
  isActive Boolean @default(true)

  units    Unit[]
  studentSubjects StudentSubject[]

  @@index([gradeId])
}

model StudentSubject {
  id        String @id @default(cuid())
  studentId String
  student   StudentProfile @relation(fields: [studentId], references: [id])
  subjectId String
  subject   Subject @relation(fields: [subjectId], references: [id])
  createdAt DateTime @default(now())

  @@unique([studentId, subjectId])
}

model Unit {
  id        String  @id @default(cuid())
  subjectId String
  subject   Subject @relation(fields: [subjectId], references: [id])
  nameEn    String
  nameAr    String
  order     Int

  topics    Topic[]

  @@index([subjectId])
}

model Topic {
  id     String @id @default(cuid())
  unitId String
  unit   Unit   @relation(fields: [unitId], references: [id])
  nameEn String
  nameAr String
  order  Int

  lessons Lesson[]
  questions Question[]

  @@index([unitId])
}

model Lesson {
  id      String @id @default(cuid())
  topicId String
  topic   Topic  @relation(fields: [topicId], references: [id])
  nameEn  String
  nameAr  String
  order   Int
  contentEn String? @db.Text
  contentAr String? @db.Text
  isAiGenerated Boolean @default(false) // distinguishes AI vs verified content

  objectives LearningObjective[]
  progress   StudentProgress[]

  @@index([topicId])
}

model LearningObjective {
  id       String @id @default(cuid())
  lessonId String
  lesson   Lesson @relation(fields: [lessonId], references: [id])
  descriptionEn String
  descriptionAr String
}

// ============ PROGRESS & LEARNING PLANS ============

model StudentProgress {
  id        String   @id @default(cuid())
  studentId String
  student   StudentProfile @relation(fields: [studentId], references: [id])
  lessonId  String
  lesson    Lesson   @relation(fields: [lessonId], references: [id])
  status    String   // "not_started" | "in_progress" | "completed"
  masteryScore Float? // 0-100
  timeSpentSec Int    @default(0)
  updatedAt DateTime @updatedAt

  @@unique([studentId, lessonId])
  @@index([studentId])
}

model LearningPlan {
  id        String   @id @default(cuid())
  studentId String
  student   StudentProfile @relation(fields: [studentId], references: [id])
  title     String
  planJson  Json     // structured plan: daily/weekly tasks, AI-generated
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())

  @@index([studentId])
}

// ============ ASSESSMENTS, QUESTIONS, QUIZZES ============

enum QuestionType {
  MULTIPLE_CHOICE
  TRUE_FALSE
  SHORT_ANSWER
  FILL_BLANK
  MATCHING
  STEP_PROBLEM
}

enum Difficulty {
  EASY
  MEDIUM
  HARD
}

model Question {
  id           String       @id @default(cuid())
  topicId      String
  topic        Topic        @relation(fields: [topicId], references: [id])
  type         QuestionType
  difficulty   Difficulty
  promptEn     String       @db.Text
  promptAr     String?      @db.Text
  optionsJson  Json?        // choices for MCQ/matching
  correctAnswerJson Json
  explanationEn String?     @db.Text
  explanationAr String?     @db.Text
  isAiGenerated Boolean     @default(false)
  createdAt    DateTime     @default(now())

  attempts     QuestionAttempt[]

  @@index([topicId, difficulty])
}

model QuestionAttempt {
  id         String   @id @default(cuid())
  studentId  String
  student    StudentProfile @relation(fields: [studentId], references: [id])
  questionId String
  question   Question @relation(fields: [questionId], references: [id])
  answerJson Json
  isCorrect  Boolean
  attemptedAt DateTime @default(now())

  @@index([studentId, questionId])
}

model Assessment {
  id        String   @id @default(cuid())
  studentId String
  type      String   // "diagnostic" | "topic" | "mock_exam"
  subjectId String?
  scoreJson Json     // per-subject / per-topic breakdown
  createdAt DateTime @default(now())

  @@index([studentId])
}

model QuizResult {
  id          String   @id @default(cuid())
  studentId   String
  student     StudentProfile @relation(fields: [studentId], references: [id])
  quizType    String   // "quiz" | "topic_assessment" | "mock_exam"
  score       Float
  totalQuestions Int
  correctCount   Int
  resultJson  Json     // detailed breakdown, weak topics, recommendations
  createdAt   DateTime @default(now())

  @@index([studentId])
}

// ============ SUBSCRIPTIONS & AI CREDITS ============

model SubscriptionPlan {
  id             String  @id @default(cuid())
  code           String  @unique // "FREE" | "BASIC" | "PLUS" | "PREMIUM"
  nameEn         String
  nameAr         String
  priceMonthly   Decimal
  aiCreditsMonthly Int
  dailyAiMessageLimit Int?
  features       Json    // feature flags
  isActive       Boolean @default(true)

  subscriptions  Subscription[]
}

model Subscription {
  id         String   @id @default(cuid())
  studentId  String   @unique
  student    StudentProfile @relation(fields: [studentId], references: [id])
  planId     String
  plan       SubscriptionPlan @relation(fields: [planId], references: [id])
  status     String   // "active" | "canceled" | "past_due" | "trialing"
  currentPeriodStart DateTime
  currentPeriodEnd   DateTime
  paymentProvider String? // "stripe" | "paymob" | "paypal"
  externalSubscriptionId String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model AICredits {
  id             String   @id @default(cuid())
  studentId      String   @unique
  student        StudentProfile @relation(fields: [studentId], references: [id])
  balance        Int      // remaining credits this period
  periodStart    DateTime
  periodEnd      DateTime
  updatedAt      DateTime @updatedAt
}

model AIUsage {
  id           String   @id @default(cuid())
  userId       String
  feature      String   // "tutor_chat" | "assessment" | "exercise_gen" | "grading"
  provider     String   // "openai" | "anthropic" | "local"
  model        String
  inputTokens  Int
  outputTokens Int
  creditsUsed  Int
  costUsd      Decimal
  createdAt    DateTime @default(now())

  @@index([userId, createdAt])
  @@index([feature])
}

// ============ AI TUTOR CONVERSATIONS ============

model AIConversation {
  id        String   @id @default(cuid())
  studentId String
  student   StudentProfile @relation(fields: [studentId], references: [id])
  subjectId String?
  topicId   String?
  title     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  messages  AIMessage[]

  @@index([studentId])
}

model AIMessage {
  id             String   @id @default(cuid())
  conversationId String
  conversation   AIConversation @relation(fields: [conversationId], references: [id])
  role           String   // "user" | "assistant" | "system"
  content        String   @db.Text
  createdAt      DateTime @default(now())

  @@index([conversationId])
}

// ============ GAMIFICATION ============

model Achievement {
  id          String  @id @default(cuid())
  code        String  @unique
  nameEn      String
  nameAr      String
  descriptionEn String
  descriptionAr String
  icon        String?

  studentAchievements StudentAchievement[]
}

model StudentAchievement {
  id            String   @id @default(cuid())
  studentId     String
  student       StudentProfile @relation(fields: [studentId], references: [id])
  achievementId String
  achievement   Achievement @relation(fields: [achievementId], references: [id])
  earnedAt      DateTime @default(now())

  @@unique([studentId, achievementId])
}

// ============ AUDIT / ADMIN ============

model AuditLog {
  id        String   @id @default(cuid())
  userId    String?
  user      User?    @relation(fields: [userId], references: [id])
  action    String
  entityType String?
  entityId   String?
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([userId, createdAt])
}

model AIProviderConfig {
  id           String  @id @default(cuid())
  providerKey  String  @unique // "openai" | "anthropic" | "local"
  model        String
  isActive     Boolean @default(false)
  costPerInputToken  Decimal
  costPerOutputToken Decimal
  updatedAt    DateTime @updatedAt
}
```

**Notes on this schema:**
- Soft deletion via `deletedAt` is on `User`; extend to other entities as needed once you see which ones actually need it in practice — adding it speculatively everywhere just adds noise.
- `isAiGenerated` flags on `Lesson` and `Question` are how you enforce the "AI content vs. verified curriculum content" separation from your spec — the frontend renders these with a visibly different badge.
- `AICredits` and `AIUsage` are deliberately separate: `AICredits` is the live balance (mutated frequently, cached in Redis), `AIUsage` is an append-only ledger (never mutated, used for analytics/audit).

---

## 4. Folder Structure

### 4.1 Backend (NestJS)

```
smartify-backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   ├── env.validation.ts
│   │   └── configuration.ts
│   ├── common/
│   │   ├── guards/              (JwtAuthGuard, RolesGuard)
│   │   ├── decorators/          (@Roles, @CurrentUser)
│   │   ├── interceptors/        (logging, transform)
│   │   ├── filters/             (global exception filter)
│   │   └── pipes/
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.service.ts
│   │   ├── auth.controller.ts
│   │   └── strategies/
│   ├── users/
│   ├── students/
│   ├── parents/
│   ├── teachers/
│   ├── curriculum/
│   │   ├── curriculum.module.ts
│   │   ├── grades/
│   │   ├── subjects/
│   │   ├── units/
│   │   ├── topics/
│   │   └── lessons/
│   ├── onboarding/
│   ├── progress/
│   ├── learning-plans/
│   ├── practice/
│   │   ├── questions/
│   │   └── attempts/
│   ├── quizzes/
│   ├── assessments/
│   ├── ai/
│   │   ├── ai.module.ts
│   │   ├── ai.service.ts
│   │   ├── providers/
│   │   │   ├── ai-provider.interface.ts
│   │   │   ├── openai.provider.ts
│   │   │   ├── anthropic.provider.ts   (stub)
│   │   │   └── local-model.provider.ts (stub)
│   │   ├── ai-provider.factory.ts
│   │   ├── credits/
│   │   │   ├── ai-credits.service.ts
│   │   │   └── ai-usage-logger.service.ts
│   │   ├── context/
│   │   │   └── ai-context-builder.service.ts
│   │   └── tutor/
│   │       ├── tutor.controller.ts
│   │       └── tutor.service.ts
│   ├── subscriptions/
│   │   ├── plans/
│   │   └── billing/
│   ├── payments/
│   │   ├── payments.module.ts
│   │   ├── providers/
│   │   │   ├── payment-provider.interface.ts
│   │   │   ├── stripe.provider.ts
│   │   │   ├── paymob.provider.ts
│   │   │   └── paypal.provider.ts
│   │   └── payment-provider.factory.ts
│   ├── gamification/
│   │   ├── achievements/
│   │   └── streaks/
│   ├── analytics/
│   ├── admin/
│   │   ├── users/
│   │   ├── curriculum-management/
│   │   ├── ai-config/
│   │   └── revenue/
│   └── audit/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── test/
├── .env.example
├── nest-cli.json
├── package.json
└── tsconfig.json
```

### 4.2 Frontend (Next.js)

```
smartify-frontend/
├── app/
│   ├── (marketing)/
│   │   ├── page.tsx                 # homepage
│   │   ├── pricing/
│   │   ├── curricula/
│   │   └── for-parents/
│   ├── (auth)/
│   │   ├── login/
│   │   ├── signup/
│   │   └── verify/
│   ├── (onboarding)/
│   │   └── onboarding/
│   │       ├── profile/
│   │       ├── curriculum/
│   │       ├── grade-subjects/
│   │       ├── diagnostic/
│   │       └── plan-ready/
│   ├── (student)/
│   │   ├── dashboard/
│   │   ├── tutor/
│   │   ├── practice/
│   │   ├── quizzes/
│   │   ├── progress/
│   │   ├── achievements/
│   │   └── subscription/
│   ├── (parent)/
│   │   └── parent-dashboard/
│   ├── (admin)/
│   │   └── admin/
│   │       ├── users/
│   │       ├── curriculum/
│   │       ├── ai-config/
│   │       ├── usage-monitoring/
│   │       └── revenue/
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/              (shadcn primitives)
│   ├── brand/            (logo, mascot components)
│   ├── dashboard/
│   ├── tutor/
│   ├── practice/
│   └── charts/
├── lib/
│   ├── api-client.ts    (typed fetch wrapper to NestJS backend)
│   ├── auth.ts
│   └── i18n/             (ar/en)
├── hooks/
├── types/                (shared DTO types — consider a shared package instead, see below)
├── public/
│   └── brand/
│       └── smartify-logo.png
├── middleware.ts         (locale + auth routing)
├── next.config.js
├── tailwind.config.ts
└── package.json
```

**One recommendation:** put shared TypeScript types (DTOs, enums like `QuestionType`) in a small shared package (`packages/shared-types`) consumed by both frontend and backend, rather than hand-duplicating interfaces. Worth setting up as a monorepo (pnpm workspaces or Turborepo) from day one — retrofitting this later is annoying.

```
smartify-ai/                 (monorepo root)
├── apps/
│   ├── backend/
│   └── frontend/
├── packages/
│   └── shared-types/
├── pnpm-workspace.yaml
└── turbo.json
```

---

## 5. Implementation Roadmap

Matches your Phase 2–10 breakdown, sequenced with dependencies made explicit:

| Phase | Deliverable | Depends on |
|---|---|---|
| 2 | Monorepo setup, Prisma schema + migrations, auth (JWT + refresh), RBAC guards, design system tokens/logo integration | Phase 1 sign-off |
| 3 | Marketing site: homepage, navbar/footer, pricing, auth pages | Phase 2 design system |
| 4 | Onboarding flow: profile → curriculum → grade/subjects → diagnostic assessment → generated profile | Phase 2 auth + curriculum tables |
| 5 | Student dashboard: progress bars, streaks, today's plan | Phase 4 (needs a learning plan to display) |
| 6 | AI Tutor: chat UI, `AIService`, context builder, credit deduction, streaming responses | Phase 2 AI provider scaffolding, Phase 4 student context |
| 7 | Practice engine + quizzes/exams | Phase 2 curriculum schema, Phase 6 for AI-generated exercises |
| 8 | Subscriptions + payment abstraction (start with Stripe, stub Paymob/PayPal) | Phase 2 SubscriptionPlan schema |
| 9 | Admin dashboard: user mgmt, curriculum CMS, AI usage/cost monitoring, revenue analytics | All prior phases feed data here |
| 10 | Testing, load-testing AI endpoints, cost-alerting, production hardening | Everything |

I'd suggest starting Phase 2 with **auth + RBAC + the Prisma schema migration**, since literally everything else depends on having real users and real curriculum rows to attach data to.

---

## Open questions before Phase 2

1. **Monorepo tooling** — pnpm workspaces + Turborepo, or keep frontend/backend as two separate repos? Monorepo is easier for shared types but adds tooling overhead.
2. **Auth approach** — roll your own JWT + refresh-token flow in NestJS, or use a library like `@nestjs/passport` + a hosted auth provider (Clerk/Auth0)? Rolling your own is more control and no vendor cost, but more to build/secure yourself.
3. **Seed data** — do you have real Egyptian/British/American curriculum content to seed, or should Phase 2 include a small placeholder seed script (a few grades/subjects/topics) so the app is testable before real content exists?
