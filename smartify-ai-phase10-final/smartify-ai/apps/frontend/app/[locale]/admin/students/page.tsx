"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";
import { StageBadge, fmtDate, pct, usd } from "@/components/admin/AnalyticsCharts";

// Admin student list (2026-10-11): every onboarded student with school,
// location, curriculum, subjects, activity and AI cost. Filters, sorting and
// CSV export all run in the browser on the single list response.

interface StudentRow {
  studentId: string;
  fullName: string;
  email: string;
  age: number;
  isTestStudent: boolean;
  joinedAt: string;
  governorate: string | null;
  area: string | null;
  school: string | null;
  curriculum: { id: string; name: string; code: string };
  grade: { id: string; name: string; level: number };
  subjects: string[];
  subscriptionStatus: string | null;
  monthlyTotalEGP: number | null;
  paidEGP: number;
  stage: "paid" | "trial" | "registered";
  trialLessonsUsed: number;
  tutorTrialQuestionsUsed: number;
  lessonsStarted: number;
  lessonsCompleted: number;
  quizzes: number;
  avgQuizScore: number | null;
  practiceAttempts: number;
  practiceAccuracy: number | null;
  homeworkSessions: number;
  tutorChats: number;
  aiCalls: number;
  aiCostUsd: number;
  aiTokens: number;
  lastActiveAt: string | null;
}

type SortKey = "joinedAt" | "lastActiveAt" | "fullName" | "lessonsStarted" | "aiCostUsd" | "practiceAttempts";

function toCsv(rows: StudentRow[]): string {
  const headers = ["Name", "Email", "Age", "Curriculum", "Grade", "School", "Governorate", "Area", "Subjects", "Stage", "Subscription", "Monthly EGP", "Paid EGP", "Trial lessons", "Tutor trial questions", "Lessons started", "Lessons completed", "Quizzes", "Avg quiz score", "Practice answers", "Practice accuracy", "Homework", "Tutor chats", "AI calls", "AI tokens", "AI cost USD", "Joined", "Last active", "Test student"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => [
    r.fullName, r.email, r.age, r.curriculum.name, r.grade.name, r.school, r.governorate, r.area, r.subjects.join(" | "), r.stage,
    r.subscriptionStatus, r.monthlyTotalEGP, r.paidEGP, r.trialLessonsUsed, r.tutorTrialQuestionsUsed, r.lessonsStarted, r.lessonsCompleted,
    r.quizzes, r.avgQuizScore?.toFixed(1), r.practiceAttempts, r.practiceAccuracy == null ? "" : Math.round(r.practiceAccuracy * 100) + "%",
    r.homeworkSessions, r.tutorChats, r.aiCalls, r.aiTokens, r.aiCostUsd.toFixed(4), r.joinedAt?.slice(0, 10), r.lastActiveAt?.slice(0, 10) ?? "", r.isTestStudent ? "yes" : "",
  ].map(esc).join(","));
  // BOM so Excel opens Arabic names correctly.
  return "﻿" + [headers.join(","), ...lines].join("\n");
}

function StudentsTable() {
  const { locale } = useParams<{ locale: Locale }>();
  const { apiFetch } = useApiClient();
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeTest, setIncludeTest] = useState(false);
  const [q, setQ] = useState("");
  const [curriculum, setCurriculum] = useState("");
  const [grade, setGrade] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [stage, setStage] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "joinedAt", dir: -1 });

  useEffect(() => {
    setRows(null);
    apiFetch<{ total: number; students: StudentRow[] }>(`/admin/student-analytics/students?includeTest=${includeTest}`)
      .then((r) => setRows(r.students))
      .catch(() => setError("Couldn't load students."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeTest]);

  const options = useMemo(() => {
    const all = rows ?? [];
    const uniq = <T,>(xs: T[]) => [...new Map(xs.map((x) => [JSON.stringify(x), x])).values()];
    return {
      curricula: uniq(all.map((r) => r.curriculum)).sort((a, b) => a.name.localeCompare(b.name)),
      grades: uniq(all.filter((r) => !curriculum || r.curriculum.id === curriculum).map((r) => ({ ...r.grade, curriculum: r.curriculum.name }))).sort((a, b) => a.level - b.level),
      governorates: [...new Set(all.map((r) => r.governorate).filter((g): g is string => !!g))].sort(),
    };
  }, [rows, curriculum]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (rows ?? []).filter((r) =>
      (!needle || [r.fullName, r.email, r.school, r.governorate, r.area, ...r.subjects].some((v) => v?.toLowerCase().includes(needle))) &&
      (!curriculum || r.curriculum.id === curriculum) &&
      (!grade || r.grade.id === grade) &&
      (!governorate || r.governorate === governorate) &&
      (!stage || r.stage === stage),
    );
    const val = (r: StudentRow) => {
      const v = r[sort.key];
      return typeof v === "string" ? (sort.key === "fullName" ? v.toLowerCase() : new Date(v).getTime()) : v ?? -Infinity;
    };
    return [...list].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [rows, q, curriculum, grade, governorate, stage, sort]);

  function exportCsv() {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smartify-students-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const SortTh = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="whitespace-nowrap px-3 py-2 text-start font-medium text-neutral-500">
      <button type="button" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : -1 }))} className="hover:text-navy-900">
        {children}{sort.key === k ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  if (error) return <p className="mt-6 text-sm text-error-500">{error}</p>;

  const select = "rounded-sf border border-neutral-300 bg-white px-2 py-1.5 text-sm";
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, school, area, subject…" className="min-w-[16rem] flex-1 rounded-sf border border-neutral-300 px-3 py-1.5 text-sm" />
        <select value={curriculum} onChange={(e) => { setCurriculum(e.target.value); setGrade(""); }} className={select}>
          <option value="">All curricula</option>
          {options.curricula.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={grade} onChange={(e) => setGrade(e.target.value)} className={select}>
          <option value="">All grades</option>
          {options.grades.map((g) => <option key={g.id} value={g.id}>{g.name}{curriculum ? "" : ` · ${g.curriculum}`}</option>)}
        </select>
        <select value={governorate} onChange={(e) => setGovernorate(e.target.value)} className={select}>
          <option value="">All governorates</option>
          {options.governorates.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className={select}>
          <option value="">All stages</option>
          <option value="paid">Paid</option>
          <option value="trial">Tried (not paid)</option>
          <option value="registered">Registered only</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-neutral-600"><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> Test students</label>
        <button type="button" onClick={exportCsv} disabled={!rows || filtered.length === 0} className="rounded-sf border border-neutral-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50">Export CSV</button>
      </div>

      {!rows ? <p className="mt-6 text-neutral-500">Loading…</p> : (
        <>
          <p className="mt-3 text-sm text-neutral-500">{filtered.length} of {rows.length} students</p>
          <div className="mt-2 overflow-x-auto rounded-sf-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <SortTh k="fullName">Student</SortTh>
                  <th className="px-3 py-2 text-start font-medium text-neutral-500">Curriculum · Grade</th>
                  <th className="px-3 py-2 text-start font-medium text-neutral-500">School · Location</th>
                  <th className="px-3 py-2 text-start font-medium text-neutral-500">Subjects</th>
                  <th className="px-3 py-2 text-start font-medium text-neutral-500">Stage</th>
                  <SortTh k="lessonsStarted">Lessons</SortTh>
                  <SortTh k="practiceAttempts">Practice</SortTh>
                  <th className="px-3 py-2 text-start font-medium text-neutral-500">Tutor · HW</th>
                  <SortTh k="aiCostUsd">AI cost</SortTh>
                  <SortTh k="joinedAt">Joined</SortTh>
                  <SortTh k="lastActiveAt">Last active</SortTh>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.studentId} className="border-b border-neutral-100 align-top last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-2">
                      <Link href={`/${locale}/admin/students/${r.studentId}`} className="font-medium text-sf-blue-500 hover:underline">{r.fullName}</Link>
                      {r.isTestStudent && <span className="ms-1 rounded bg-neutral-100 px-1 text-[10px] text-neutral-500">test</span>}
                      <div className="text-xs text-neutral-500">{r.email} · {r.age}y</div>
                    </td>
                    <td className="px-3 py-2 text-neutral-700">{r.curriculum.name}<div className="text-xs text-neutral-500">{r.grade.name}</div></td>
                    <td className="px-3 py-2 text-neutral-700">{r.school ?? "—"}<div className="text-xs text-neutral-500">{[r.area, r.governorate].filter(Boolean).join(", ") || "—"}</div></td>
                    <td className="max-w-[14rem] px-3 py-2 text-xs text-neutral-700">{r.subjects.length ? r.subjects.join(", ") : "—"}</td>
                    <td className="px-3 py-2"><StageBadge stage={r.stage} />{r.trialLessonsUsed > 0 && <div className="mt-1 text-[11px] text-neutral-500">trial: {r.trialLessonsUsed} lesson(s)</div>}</td>
                    <td className="px-3 py-2 tabular-nums">{r.lessonsCompleted}/{r.lessonsStarted}<div className="text-xs text-neutral-500">done/started</div></td>
                    <td className="px-3 py-2 tabular-nums">{r.practiceAttempts}<div className="text-xs text-neutral-500">{pct(r.practiceAccuracy)} correct</div></td>
                    <td className="px-3 py-2 tabular-nums">{r.tutorChats} · {r.homeworkSessions}</td>
                    <td className="px-3 py-2 tabular-nums">{usd(r.aiCostUsd)}<div className="text-xs text-neutral-500">{r.aiCalls} calls</div></td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-600">{fmtDate(r.joinedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-600">{fmtDate(r.lastActiveAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export default function AdminStudentsPage() {
  const { locale } = useParams<{ locale: Locale }>();
  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN"]}>
      <main className="py-12">
        <SmartifyContainer>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-navy-900">Students</h1>
              <p className="mt-2 text-sm text-neutral-500">Everything each student entered and did. Click a student for the full profile and timeline.</p>
            </div>
            <Link href={`/${locale}/admin/analytics`} className="text-sm text-sf-blue-500 hover:underline">Analytics dashboard →</Link>
          </div>
          <StudentsTable />
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
