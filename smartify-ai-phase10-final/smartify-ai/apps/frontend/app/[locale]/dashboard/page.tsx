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
interface DashboardSummary {
  fullName: string;
  curriculum: { nameEn: string; nameAr: string };
  grade: { nameEn: string; nameAr: string };
  subjects: Array<{ id: string; nameEn: string; nameAr: string }>;
  diagnosticScore: Record<string, SubjectScore> | null;
  recommendedFocus: string[] | null;
  weakTopics: WeakTopic[];
  recentActivity: ActivityItem[];
  streak: number | null;
  weeklyStudyMinutes: number | null;
  achievements: unknown[];
  upcomingExams: unknown[];
  aiTutorAvailable: boolean;
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

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [notOnboarded, setNotOnboarded] = useState(false);

  useEffect(() => {
    apiFetch<DashboardSummary>("/dashboard/summary")
      .then(setSummary)
      .catch(() => setNotOnboarded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <Link href={`/${locale}/practice`}>
              <SmartifyButton variant="secondary">{isAr ? "التدريب" : "Practice"}</SmartifyButton>
            </Link>
            <Link href={`/${locale}/quizzes`}>
              <SmartifyButton variant="secondary">{isAr ? "الاختبارات" : "Quizzes"}</SmartifyButton>
            </Link>
            <Link href={`/${locale}/billing`}>
              <SmartifyButton variant="secondary">{isAr ? "الاشتراك" : "Subscription"}</SmartifyButton>
            </Link>
          </div>
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
              href={`/${locale}/tutor?subjectId=${summary.subjects[0].id}`}
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
        </div>
      </SmartifyContainer>
    </main>
    </>
  );
}
