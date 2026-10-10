"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";
import { BarList, DailyColumns, Funnel, Kpi, Panel, compact, egp, pct, usd } from "@/components/admin/AnalyticsCharts";

// Admin analytics dashboard (2026-10-11): who the students are, what they do,
// where they drop off, and what AI costs — from /admin/student-analytics/overview.

interface Bucket { key: string; count: number }
interface Overview {
  windowDays: number;
  totals: { registeredAccounts: number; onboardedStudents: number; activeStudentsInWindow: number; payingStudents: number; mrrEGP: number; verifiedPaymentsEGPInWindow: number };
  funnel: Array<{ stage: string; count: number }>;
  onboardingFunnel?: { trackedSince: string; steps: Array<{ stage: string; count: number }> };
  activity: { lessonsStarted: number; lessonsCompleted: number; quizzes: number; practiceAttempts: number; practiceAccuracy: number | null; homeworkSessions: number; supportTickets: number };
  ai: { totalUsd: number; studentUsd: number; platformContentUsd: number; tokens: number; calls: number; avgUsdPerActiveStudent: number; byFeature: Array<{ feature: string; calls: number; costUsd: number }>; topStudents: Array<{ studentId: string; fullName: string; aiCostUsd: number; aiCalls: number }> };
  daily: Array<{ day: string; signups: number; activeStudents: number; lessons: number; aiCostUsd: number }>;
  breakdowns: { curriculum: Bucket[]; grade: Bucket[]; governorate: Bucket[]; school: Bucket[]; subject: Bucket[]; age: Bucket[]; language: Bucket[]; stage: Bucket[] };
}

const WINDOWS = [7, 30, 90, 365];
const toRows = (b: Bucket[]) => b.map((x) => ({ key: x.key, value: x.count }));

function Dashboard() {
  const { locale } = useParams<{ locale: Locale }>();
  const { apiFetch } = useApiClient();
  const [days, setDays] = useState(30);
  const [includeTest, setIncludeTest] = useState(false);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    apiFetch<Overview>(`/admin/student-analytics/overview?days=${days}&includeTest=${includeTest}`)
      .then(setData)
      .catch(() => setError("Couldn't load analytics."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, includeTest]);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-sf border border-neutral-300 bg-white text-sm">
          {WINDOWS.map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} className={`px-3 py-1.5 ${days === d ? "bg-navy-900 text-white" : "text-neutral-700"}`}>
              {d === 365 ? "1 year" : `${d} days`}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> Include test students
        </label>
        <Link href={`/${locale}/admin/students`} className="ms-auto rounded-sf bg-sf-blue-500 px-4 py-2 text-sm text-white">Open student list →</Link>
      </div>

      {error && <p className="mt-6 text-sm text-error-500">{error}</p>}
      {!data && !error && <p className="mt-6 text-neutral-500">Loading…</p>}
      {data && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Registered" value={data.totals.registeredAccounts} hint="student accounts" />
            <Kpi label="Onboarded" value={data.totals.onboardedStudents} hint={pct(data.totals.onboardedStudents / (data.totals.registeredAccounts || 1)) + " of registered"} />
            <Kpi label={`Active (${data.windowDays}d)`} value={data.totals.activeStudentsInWindow} />
            <Kpi label="Paying" value={data.totals.payingStudents} />
            <Kpi label="MRR" value={egp(data.totals.mrrEGP)} hint="active subscriptions" />
            <Kpi label={`AI cost (${data.windowDays}d)`} value={usd(data.ai.totalUsd)} hint={`${usd(data.ai.avgUsdPerActiveStudent)} / active student`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Funnel (all time)"><Funnel steps={data.funnel} /></Panel>
            {data.onboardingFunnel && (
              <Panel title="Where new sign-ups stop (onboarding steps)">
                <Funnel steps={data.onboardingFunnel.steps} />
                <p className="mt-3 text-xs text-neutral-500">Accounts created since {new Date(data.onboardingFunnel.trackedSince).toLocaleDateString()}, when step tracking started.</p>
              </Panel>
            )}
            <Panel title={`Activity (last ${data.windowDays} days)`}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Kpi label="Lessons started" value={data.activity.lessonsStarted} />
                <Kpi label="Lessons completed" value={data.activity.lessonsCompleted} />
                <Kpi label="Quizzes" value={data.activity.quizzes} />
                <Kpi label="Practice answers" value={data.activity.practiceAttempts} hint={`${pct(data.activity.practiceAccuracy)} correct`} />
                <Kpi label="Homework help" value={data.activity.homeworkSessions} />
                <Kpi label="Support tickets" value={data.activity.supportTickets} />
              </div>
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="New sign-ups per day"><DailyColumns points={data.daily.map((d) => ({ day: d.day, value: d.signups }))} /></Panel>
            <Panel title="Active students per day"><DailyColumns points={data.daily.map((d) => ({ day: d.day, value: d.activeStudents }))} /></Panel>
            <Panel title="Lessons started per day"><DailyColumns points={data.daily.map((d) => ({ day: d.day, value: d.lessons }))} /></Panel>
            <Panel title="AI cost per day"><DailyColumns points={data.daily.map((d) => ({ day: d.day, value: d.aiCostUsd }))} format={usd} /></Panel>
          </div>

          <Panel title={`AI consumption (last ${data.windowDays} days)`}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Student usage" value={usd(data.ai.studentUsd)} hint="tutor, lessons, homework…" />
              <Kpi label="Platform content" value={usd(data.ai.platformContentUsd)} hint="lesson & question generation" />
              <Kpi label="AI calls" value={compact(data.ai.calls)} />
              <Kpi label="Tokens" value={compact(data.ai.tokens)} />
            </div>
            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium text-neutral-600">By feature</h3>
                <BarList rows={data.ai.byFeature.map((f) => ({ key: `${f.feature} (${f.calls} calls)`, value: f.costUsd }))} format={usd} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium text-neutral-600">Top students by AI cost (all time)</h3>
                {data.ai.topStudents.length === 0 ? <p className="text-sm text-neutral-500">No student AI usage yet.</p> : (
                  <ul className="space-y-1 text-sm">
                    {data.ai.topStudents.map((s) => (
                      <li key={s.studentId} className="flex justify-between gap-3">
                        <Link className="truncate text-sf-blue-500 hover:underline" href={`/${locale}/admin/students/${s.studentId}`}>{s.fullName}</Link>
                        <span className="tabular-nums text-navy-900">{usd(s.aiCostUsd)} <span className="text-xs text-neutral-500">· {s.aiCalls} calls</span></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Panel>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel title="Curriculum"><BarList rows={toRows(data.breakdowns.curriculum)} /></Panel>
            <Panel title="Governorate"><BarList rows={toRows(data.breakdowns.governorate)} /></Panel>
            <Panel title="Stage"><BarList rows={toRows(data.breakdowns.stage)} /></Panel>
            <Panel title="Grade"><BarList rows={toRows(data.breakdowns.grade)} /></Panel>
            <Panel title="Top schools"><BarList rows={toRows(data.breakdowns.school)} /></Panel>
            <Panel title="Most chosen subjects"><BarList rows={toRows(data.breakdowns.subject)} /></Panel>
            <Panel title="Age"><BarList rows={toRows(data.breakdowns.age)} /></Panel>
            <Panel title="Preferred language"><BarList rows={toRows(data.breakdowns.language)} /></Panel>
          </div>
        </div>
      )}
    </>
  );
}

export default function AdminAnalyticsPage() {
  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN"]}>
      <main className="py-12">
        <SmartifyContainer>
          <h1 className="text-2xl font-bold text-navy-900">Student analytics</h1>
          <p className="mt-2 text-sm text-neutral-500">Who the students are, what they do on Smartify, where they drop off, and what their AI usage costs.</p>
          <Dashboard />
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
