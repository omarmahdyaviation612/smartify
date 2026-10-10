"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getDashboardCopy } from "@/content/dashboard";
import { getMarketingCopy } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { useApiClient } from "@/lib/api-client";
import { ComingSoonCard } from "@/components/ComingSoonCard";
import type { Locale } from "@/content/marketing";
import { StudentLinkCodeCard } from "@/components/StudentLinkCodeCard";
import { FreeTrialCard } from "@/components/FreeTrialCard";
import { ReferralCard } from "@/components/ReferralCard";
import { useCurrentUser } from "@/lib/use-current-user";

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN"];

interface SubjectScore {
  nameEn: string;
  nameAr: string;
  correct: number;
  total: number;
  percent: number;
}
interface WeakTopic {
  nameEn: string;
  nameAr: string;
  subjectNameEn: string;
  subjectNameAr: string;
  percent: number;
}
interface ActivityItem {
  questionPromptEn: string;
  questionPromptAr: string | null;
  subjectNameEn: string;
  subjectNameAr: string;
  isCorrect: boolean;
  attemptedAt: string;
}
interface PilotLesson {
  topicId: string;
  subjectId: string;
  nameEn: string;
  nameAr: string;
  unitNameEn: string;
  unitNameAr: string;
  term: "TERM_1" | "TERM_2" | null;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
}
interface DashboardSummary {
  fullName: string;
  curriculum: { nameEn: string; nameAr: string };
  grade: { nameEn: string; nameAr: string };
  subjects: Array<{ id: string; nameEn: string; nameAr: string; entitlement: "ACTIVE" | "LOCKED" }>;
  diagnosticScore: Record<string, SubjectScore> | null;
  recommendedFocus: string[] | null;
  weakTopics: WeakTopic[];
  recentActivity: ActivityItem[];
  streak: number | null;
  weeklyStudyMinutes: number | null;
  achievements: unknown[];
  upcomingExams: unknown[];
  aiTutorAvailable: boolean;
  pilotLessons: PilotLesson[];
}

function getGreetingKey(): "greetingMorning" | "greetingAfternoon" | "greetingEvening" {
  const hour = new Date().getHours();
  if (hour < 12) return "greetingMorning";
  if (hour < 18) return "greetingAfternoon";
  return "greetingEvening";
}

export default function DashboardPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const copy = getDashboardCopy(locale);
  const navCopy = getMarketingCopy(locale);
  const router = useRouter();
  const { apiFetch } = useApiClient();
  const { user, loading: userLoading } = useCurrentUser();
  const isAdminRole = !!user && ADMIN_ROLES.includes(user.role);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [notOnboarded, setNotOnboarded] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);

  // Admin home dashboard (2026-09-20) — ADMIN/SUPER_ADMIN never see the
  // Student dashboard; this is a UX convenience only, the real security
  // boundary is the backend RolesGuard on every /admin/* route.
  useEffect(() => {
    if (isAdminRole) {
      router.replace(`/${locale}/admin`);
    }
  }, [isAdminRole, locale, router]);

  useEffect(() => {
    if (userLoading || isAdminRole) return;
    apiFetch<DashboardSummary>("/dashboard/summary")
      .then((data) => {
        setSummary(data);
        setSelectedSubjectId(data.subjects.find(s => s.entitlement === "ACTIVE")?.id ?? null);
      })
      .catch(() => setNotOnboarded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoading, isAdminRole]);

  if (userLoading || isAdminRole) {
    return (
      <>
        <Navbar locale={locale} copy={navCopy} />
        <main className="flex min-h-[60vh] items-center justify-center">
          <p className="text-neutral-500">{copy.loading}</p>
        </main>
      </>
    );
  }

  if (notOnboarded) {
    return (
      <>
        <Navbar locale={locale} copy={navCopy} />
        <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
          <p className="text-neutral-600">{copy.noProfile}</p>
          <Link href={`/${locale}/onboarding/profile`}>
            <SmartifyButton variant="ai">{copy.goToOnboarding}</SmartifyButton>
          </Link>
        </main>
      </>
    );
  }

  if (!summary) {
    return (
      <>
        <Navbar locale={locale} copy={navCopy} />
        <main className="flex min-h-[60vh] items-center justify-center">
          <p className="text-neutral-500">{copy.loading}</p>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar locale={locale} copy={navCopy} />
      <main className="py-12">
      <SmartifyContainer>
        <header className="mb-10">
          <p className="text-sm text-neutral-500">
            {isAr ? summary.curriculum.nameAr : summary.curriculum.nameEn} · {isAr ? summary.grade.nameAr : summary.grade.nameEn}
          </p>
          <h1 className="mt-1 text-3xl font-bold text-navy-900">
            {copy[getGreetingKey()]}, {summary.fullName} 👋
          </h1>
          <p className="mt-2 text-neutral-600">{copy.subtitle}</p>

          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={`/${locale}/practice${selectedSubjectId ? `?subjectId=${selectedSubjectId}` : ""}`}>
              <SmartifyButton variant="secondary">{isAr ? "التدريب" : "Practice"}</SmartifyButton>
            </Link>
            <Link href={`/${locale}/quizzes${selectedSubjectId ? `?subjectId=${selectedSubjectId}` : ""}`}>
              <SmartifyButton variant="secondary">{isAr ? "الاختبارات" : "Quizzes"}</SmartifyButton>
            </Link>
            <Link href={`/${locale}/billing`}>
              <SmartifyButton variant="secondary">{isAr ? "الاشتراك" : "Subscription"}</SmartifyButton>
            </Link>
          </div>

          {/* Subject switcher — controls every section below (lessons, AI
              Tutor, and the Practice/Quizzes quick links above), so moving
              from e.g. Math to Science is one click from the top of the
              page rather than buried inside a single card. */}
          {summary.subjects.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-6" role="tablist" aria-label={isAr ? "اختر مادة" : "Choose a subject"}>
              <span className="text-sm font-medium text-neutral-500">{isAr ? "المادة:" : "Subject:"}</span>
              {summary.subjects.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedSubjectId === s.id}
                  onClick={() => s.entitlement === "LOCKED" ? router.push(`/${locale}/billing?subjectId=${encodeURIComponent(s.id)}`) : setSelectedSubjectId(s.id)}
                  aria-label={`${isAr ? s.nameAr : s.nameEn}${s.entitlement === "LOCKED" ? (isAr ? " — إضافة مادة" : " — Add subject") : ""}`}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    s.entitlement === "LOCKED" ? "border border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-400" : selectedSubjectId === s.id ? "bg-ai-gradient text-white" : "border border-neutral-200 text-neutral-600 hover:border-neutral-300"
                  }`}
                >
                  {s.entitlement === "LOCKED" && <span aria-hidden="true">🔒 </span>}{isAr ? s.nameAr : s.nameEn}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Recommended focus — real, from the rule-based learning plan */}
          <div className="rounded-sf-lg border border-neutral-200 bg-white p-6 lg:col-span-2">
            <h2 className="mb-4 font-semibold text-navy-900">{copy.sections.focus.title}</h2>
            {summary.recommendedFocus && summary.recommendedFocus.length > 0 ? (
              <ul className="list-inside list-disc space-y-1 text-neutral-700">
                {summary.recommendedFocus.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">{copy.sections.focus.empty}</p>
            )}
          </div>

          {summary.aiTutorAvailable && summary.subjects.length > 0 ? (
            <Link
              href={selectedSubjectId ? `/${locale}/tutor?subjectId=${selectedSubjectId}` : `/${locale}/billing`}
              className="rounded-sf-lg border border-neutral-200 bg-ai-gradient p-6 text-white transition-opacity hover:opacity-95"
            >
              <h2 className="font-semibold">{copy.sections.aiTutor.title}</h2>
              <p className="mt-1 text-sm text-white/90">
                {isAr ? "ابدأ محادثة مع المعلم الذكي" : "Start a conversation with your AI Tutor"}
              </p>
            </Link>
          ) : (
            <ComingSoonCard title={copy.sections.aiTutor.title} body={copy.sections.aiTutor.body} badgeLabel={copy.comingSoon} />
          )}
          <Link href={`/${locale}/homework`} className="rounded-sf-lg border border-ai-200 bg-white p-6 transition-colors hover:border-ai-500">
            <h2 className="font-semibold text-navy-900">{isAr ? "مساعد حل الواجب" : "Homework Helper"}</h2>
            <p className="mt-1 text-sm text-neutral-600">{isAr ? "حلّ واجبك خطوة بخطوة من منهجك" : "Work through homework step by step from your curriculum"}</p>
          </Link>
          {/* Lessons — real, every Topic for the student's selected subjects (title-only ones generate on first open) + this student's own LessonSession status */}
          <div className="rounded-sf-lg border border-neutral-200 bg-white p-6 lg:col-span-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-navy-900">{copy.sections.pilotLessons.title}</h2>
              {selectedSubjectId && summary.subjects.length > 1 && (
                <span className="text-xs text-neutral-400">
                  {isAr
                    ? summary.subjects.find((s) => s.id === selectedSubjectId)?.nameAr
                    : summary.subjects.find((s) => s.id === selectedSubjectId)?.nameEn}
                </span>
              )}
            </div>
            {(() => {
              const lessonsForSubject = summary.pilotLessons.filter((l) => l.subjectId === selectedSubjectId);
              return lessonsForSubject.length > 0 ? (
                <div className="max-h-96 space-y-5 overflow-y-auto">
                  {(["TERM_1", "TERM_2", null] as const).map((term) => {
                    const lessons = lessonsForSubject.filter((lesson) => lesson.term === term);
                    if (lessons.length === 0) return null;
                    const heading = term === "TERM_1"
                      ? (isAr ? "الترم الأول" : "Term 1")
                      : term === "TERM_2"
                        ? (isAr ? "الترم الثاني" : "Term 2")
                        : (isAr ? "غير محدد الترم" : "Term not set");
                    return (
                      <section key={term ?? "unassigned-term"} aria-label={heading}>
                        <h3 className="mb-2 border-b border-neutral-100 pb-2 text-sm font-semibold text-navy-900">{heading}</h3>
                        <ul className="space-y-3">
                          {lessons.map((lesson) => (
                            <li key={lesson.topicId} className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm text-neutral-700">{isAr ? lesson.nameAr : lesson.nameEn}</p>
                                <p className="text-xs text-neutral-400">{isAr ? lesson.unitNameAr : lesson.unitNameEn}</p>
                              </div>
                              {lesson.status === "COMPLETED" ? (
                                // A finished lesson stays open for review (2026-10-10).
                                <div className="flex shrink-0 items-center gap-2">
                                  <span className="rounded-full bg-success-100 px-3 py-1 text-xs font-medium text-success-500">
                                    {copy.sections.pilotLessons.completed}
                                  </span>
                                  <Link
                                    href={`/${locale}/lesson/${lesson.topicId}`}
                                    className="rounded-full border border-sf-purple-600 px-3 py-1 text-xs font-medium text-sf-purple-600 hover:bg-sf-purple-50"
                                  >
                                    {copy.sections.pilotLessons.review}
                                  </Link>
                                </div>
                              ) : (
                                <Link href={`/${locale}/lesson/${lesson.topicId}`}>
                                  <SmartifyButton variant="ai">
                                    {lesson.status === "IN_PROGRESS" ? copy.sections.pilotLessons.continueLabel : copy.sections.pilotLessons.start}
                                  </SmartifyButton>
                                </Link>
                              )}
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-neutral-500">{copy.sections.pilotLessons.empty}</p>
              );
            })()}
          </div>

          <ComingSoonCard title={copy.sections.streak.title} body={copy.sections.streak.body} badgeLabel={copy.comingSoon} />
          <ComingSoonCard title={copy.sections.weeklyTime.title} body={copy.sections.weeklyTime.body} badgeLabel={copy.comingSoon} />

          {/* Subject progress — real, derived from diagnostic score */}
          <div className="rounded-sf-lg border border-neutral-200 bg-white p-6 lg:col-span-2">
            <h2 className="font-semibold text-navy-900">{copy.sections.subjectProgress.title}</h2>
            <p className="mb-4 mt-1 text-xs text-neutral-500">{copy.sections.subjectProgress.note}</p>
            {summary.diagnosticScore ? (
              <div className="space-y-4">
                {Object.values(summary.diagnosticScore).map((s) => (
                  <div key={s.nameEn}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-neutral-700">{isAr ? s.nameAr : s.nameEn}</span>
                      <span className="text-neutral-500">{s.percent}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                      <div className="h-full rounded-full bg-ai-gradient" style={{ width: `${s.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">{copy.sections.subjectProgress.empty}</p>
            )}
          </div>

          {/* Weak topics — real, derived from QuestionAttempt accuracy */}
          <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
            <h2 className="mb-4 font-semibold text-navy-900">{copy.sections.weakTopics.title}</h2>
            {summary.weakTopics.length > 0 ? (
              <ul className="space-y-3 text-sm">
                {summary.weakTopics.map((t) => (
                  <li key={t.nameEn} className="flex items-center justify-between">
                    <span className="text-neutral-700">{isAr ? t.nameAr : t.nameEn}</span>
                    <span className="rounded-full bg-error-100 px-2 py-0.5 text-xs font-medium text-error-500">{t.percent}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">{copy.sections.weakTopics.empty}</p>
            )}
          </div>

          {/* Recent activity — real, from QuestionAttempt rows */}
          <div className="rounded-sf-lg border border-neutral-200 bg-white p-6 lg:col-span-2">
            <h2 className="mb-4 font-semibold text-navy-900">{copy.sections.recentActivity.title}</h2>
            {summary.recentActivity.length > 0 ? (
              <ul className="divide-y divide-neutral-100">
                {summary.recentActivity.map((a, i) => (
                  <li key={i} className="flex items-center justify-between py-3 text-sm">
                    <div>
                      <p className="text-neutral-700">{isAr && a.questionPromptAr ? a.questionPromptAr : a.questionPromptEn}</p>
                      <p className="text-xs text-neutral-400">{isAr ? a.subjectNameAr : a.subjectNameEn}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        a.isCorrect ? "bg-success-100 text-success-500" : "bg-error-100 text-error-500"
                      }`}
                    >
                      {a.isCorrect ? copy.sections.recentActivity.correct : copy.sections.recentActivity.incorrect}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">{copy.sections.recentActivity.empty}</p>
            )}
          </div>

          <ComingSoonCard title={copy.sections.achievements.title} body={copy.sections.achievements.body} badgeLabel={copy.comingSoon} />
          <ComingSoonCard title={copy.sections.upcomingExams.title} body={copy.sections.upcomingExams.body} badgeLabel={copy.comingSoon} />
          <StudentLinkCodeCard isAr={isAr} />
          <FreeTrialCard isAr={isAr} locale={locale} />
          <ReferralCard isAr={isAr} locale={locale} />
        </div>
      </SmartifyContainer>
    </main>
    </>
  );
}
