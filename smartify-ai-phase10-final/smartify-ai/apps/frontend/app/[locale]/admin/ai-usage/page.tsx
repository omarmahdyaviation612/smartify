"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";

// Admin AI Cost / Budget Dashboard (2026-09-20) — read-only view over the
// existing AIUsage ledger via AdminAIConfigController's cost-overview /
// students-spend / students/:id/spend endpoints (all SUPER_ADMIN only,
// same as the rest of admin/ai-config). Budget EDITING stays on
// /admin/platform's existing AISpendingControlsSection — this page only
// links there rather than duplicating that UI.

interface CostSplit {
  totalUsd: number;
  studentRuntimeUsd: number;
  platformAuthoringUsd: number;
}
interface CostOverview {
  today: CostSplit;
  month: CostSplit;
}
interface StudentSpendRow {
  studentId: string;
  fullName: string;
  email: string | null;
  todayUsd: number;
  windowDays: number;
  windowUsd: number;
  perUserBudgetUsd: number | null;
  remainingTodayUsd: number | null;
}
interface StudentSpendDetail {
  windowDays: number;
  totalUsd: number;
  bySubject: Array<{
    subjectId: string | null;
    subjectNameEn: string;
    subjectNameAr: string;
    costUsd: number;
    byFeature: Record<string, number>;
  }>;
}

function usd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function CostSplitCard({ title, split }: { title: string; split: CostSplit }) {
  return (
    <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
      <p className="text-sm text-neutral-500">{title}</p>
      <p className="mt-1 text-2xl font-bold text-navy-900">{usd(split.totalUsd)}</p>
      <div className="mt-3 space-y-1 text-xs text-neutral-500">
        <p>Student runtime (lesson/tutor/TTS): {usd(split.studentRuntimeUsd)}</p>
        <p>Platform content-authoring: {usd(split.platformAuthoringUsd)}</p>
      </div>
    </div>
  );
}

function StudentDetailRow({ studentId }: { studentId: string }) {
  const { apiFetch } = useApiClient();
  const [detail, setDetail] = useState<StudentSpendDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<StudentSpendDetail>(`/admin/ai-config/students/${studentId}/spend`)
      .then(setDetail)
      .catch(() => setError("Could not load this student's Subject breakdown."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  if (error) return <tr><td colSpan={5} className="px-4 py-3 text-xs text-error-500">{error}</td></tr>;
  if (!detail) return <tr><td colSpan={5} className="px-4 py-3 text-xs text-neutral-400">Loading Subject breakdown…</td></tr>;

  if (detail.bySubject.length === 0) {
    return <tr><td colSpan={5} className="px-4 py-3 text-xs text-neutral-400">No AI usage in the last {detail.windowDays} days.</td></tr>;
  }

  return (
    <tr>
      <td colSpan={5} className="bg-neutral-50 px-4 py-3">
        <p className="mb-2 text-xs font-medium text-neutral-500">
          By Subject — last {detail.windowDays} days ({usd(detail.totalUsd)} total)
        </p>
        <div className="space-y-2">
          {detail.bySubject.map((s) => (
            <div key={s.subjectId ?? "__none__"} className="rounded-sf border border-neutral-200 bg-white px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-navy-900">{s.subjectNameEn}</span>
                <span className="text-neutral-500">{usd(s.costUsd)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-neutral-400">
                {Object.entries(s.byFeature).map(([feature, cost]) => (
                  <span key={feature}>
                    {feature}: {usd(cost)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

export default function AdminAIUsagePage() {
  const { locale } = useParams<{ locale: Locale }>();
  const { apiFetch } = useApiClient();
  const [overview, setOverview] = useState<CostOverview | null>(null);
  const [students, setStudents] = useState<StudentSpendRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<CostOverview>("/admin/ai-config/cost-overview")
      .then(setOverview)
      .catch(() => setForbidden(true));
    apiFetch<StudentSpendRow[]>("/admin/ai-config/students-spend")
      .then(setStudents)
      .catch(() => setForbidden(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN"]}>
      <main className="py-12">
        <SmartifyContainer>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-navy-900">AI Cost & Budget</h1>
            <Link href={`/${locale}/admin/platform`} className="text-sm text-sf-blue-500 underline">
              Edit budgets on Platform Config →
            </Link>
          </div>
          <p className="mt-2 text-sm text-neutral-500">
            Platform content-authoring spend (textbook grounding, TOC extraction, lesson/question generation) is billed to Smartify and never
            counted against any student&apos;s budget.
          </p>

          {forbidden && !overview && (
            <p className="mt-6 text-sm text-neutral-500">This dashboard requires Super Admin access.</p>
          )}

          {overview && (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <CostSplitCard title="AI spend today" split={overview.today} />
              <CostSplitCard title="AI spend this month" split={overview.month} />
            </div>
          )}

          <div className="mt-10">
            <h2 className="font-semibold text-navy-900">Student AI spend</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Every student with AI usage in the last {students?.[0]?.windowDays ?? 30} days. Budgets shown are the shared per-student daily cap —
              this system does not support per-Subject limits.
            </p>

            {students && students.length === 0 && <p className="mt-4 text-sm text-neutral-400">No student AI usage recorded yet.</p>}

            {students && students.length > 0 && (
              <div className="mt-4 overflow-x-auto rounded-sf-lg border border-neutral-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Today</th>
                      <th className="px-4 py-3">Window total</th>
                      <th className="px-4 py-3">Remaining today</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <Fragment key={s.studentId}>
                        <tr className="border-b border-neutral-100">
                          <td className="px-4 py-3">
                            <p className="font-medium text-navy-900">{s.fullName}</p>
                            {s.email && <p className="text-xs text-neutral-400">{s.email}</p>}
                          </td>
                          <td className="px-4 py-3">{usd(s.todayUsd)}</td>
                          <td className="px-4 py-3">{usd(s.windowUsd)}</td>
                          <td className="px-4 py-3">
                            {s.remainingTodayUsd === null ? (
                              <span className="text-neutral-400">No global budget set</span>
                            ) : (
                              `${usd(s.remainingTodayUsd)} of ${usd(s.perUserBudgetUsd ?? 0)}`
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setExpandedStudentId((id) => (id === s.studentId ? null : s.studentId))}
                              className="text-xs text-sf-blue-500 underline"
                            >
                              {expandedStudentId === s.studentId ? "Hide" : "By Subject"}
                            </button>
                          </td>
                        </tr>
                        {expandedStudentId === s.studentId && <StudentDetailRow studentId={s.studentId} />}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
