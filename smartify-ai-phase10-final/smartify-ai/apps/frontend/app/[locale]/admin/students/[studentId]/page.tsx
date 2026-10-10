"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";
import { BarList, DailyColumns, Kpi, Panel, compact, egp, fmtDate, fmtDateTime, pct, usd } from "@/components/admin/AnalyticsCharts";

// Admin student profile (2026-10-11): everything one student entered and did,
// with AI consumption — from /admin/student-analytics/students/:id.

interface Detail {
  profile: {
    studentId: string; fullName: string; email: string; age: number; country: string; preferredLang: string;
    governorate: string | null; area: string | null; school: string | null; schoolFromList: boolean;
    curriculum: string; grade: string; goals: string | null; weeklyStudyHours: number | null; joinedAt: string;
    isTestStudent: boolean; isActive: boolean; parents: string[];
    referredBy: { code: string; referrer: string; at: string } | null; referralsMade: number;
  };
  subjects: Array<{ name: string; priceEGP: number | null; since: string; expiresAt: string | null }>;
  subscription: { status: string; monthlyTotalEGP: number; currentPeriodStart: string | null; currentPeriodEnd: string | null; homeworkAddonActive: boolean; createdAt: string } | null;
  trials: {
    lessonTrial: { startedAt: string; lessons: Array<{ subject: string; topic: string; at: string }> } | null;
    tutorTrial: { subject: string; questionsUsed: number; startedAt: string; completedAt: string | null } | null;
  };
  lessons: Array<{ topic: string; subject: string; status: string; step: number; totalSteps: number | null; startedAt: string; lastActivityAt: string; completedAt: string | null }>;
  quizzes: Array<{ quizType: string; score: number; correctCount: number; totalQuestions: number; createdAt: string; topic: { nameEn: string } | null }>;
  practice: { attempts: number; accuracy: number | null; bySource: Array<{ key: string; count: number }>; bySubject: Array<{ subject: string; attempts: number; correct: number; accuracy: number }> };
  homework: Array<{ status: string; solvedAt: string | null; solutionRevealed: boolean; createdAt: string; extractedQuestion: string; subject: { nameEn: string } }>;
  tutorConversations: Array<{ title: string | null; messages: number; startedAt: string; lastAt: string }>;
  supportTickets: Array<{ title: string; status: string; createdAt: string; closedAt: string | null }>;
  payments: Array<{ kind: string; status: string; expectedAmountEGP: number; submittedAmountEGP: number; createdAt: string; verifiedAt: string | null; rejectionReason: string | null }>;
  ai: { totalUsd: number; calls: number; tokens: number; byFeature: Array<{ feature: string; calls: number; costUsd: number; tokens: number }>; bySubject: Array<{ subject: string; calls: number; costUsd: number }>; daily: Array<{ day: string; costUsd: number }> };
  timeline: Array<{ at: string; type: string; text: string }>;
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between gap-4 border-b border-neutral-100 py-1.5 text-sm last:border-0">
    <span className="text-neutral-500">{label}</span>
    <span className="text-end text-navy-900">{value ?? "—"}</span>
  </div>
);

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-neutral-200">{head.map((h) => <th key={h} className="px-2 py-1.5 text-start font-medium text-neutral-500">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-neutral-100 last:border-0">{r.map((c, j) => <td key={j} className="px-2 py-1.5 align-top text-neutral-700">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function StudentDetail({ studentId }: { studentId: string }) {
  const { apiFetch } = useApiClient();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Detail>(`/admin/student-analytics/students/${studentId}`).then(setD).catch(() => setError("Couldn't load this student."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  if (error) return <p className="mt-6 text-sm text-error-500">{error}</p>;
  if (!d) return <p className="mt-6 text-neutral-500">Loading…</p>;
  const p = d.profile;
  const completed = d.lessons.filter((l) => l.status === "COMPLETED").length;

  return (
    <div className="mt-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">{p.fullName}{p.isTestStudent && <span className="ms-2 rounded bg-neutral-100 px-2 py-0.5 align-middle text-xs text-neutral-500">test student</span>}</h1>
        <p className="mt-1 text-sm text-neutral-500">{p.email} · joined {fmtDate(p.joinedAt)}{!p.isActive && " · account disabled"}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Lessons" value={`${completed}/${d.lessons.length}`} hint="completed / started" />
        <Kpi label="Quizzes" value={d.quizzes.length} />
        <Kpi label="Practice" value={d.practice.attempts} hint={`${pct(d.practice.accuracy)} correct`} />
        <Kpi label="Tutor chats" value={d.tutorConversations.length} />
        <Kpi label="Homework" value={d.homework.length} />
        <Kpi label="AI cost" value={usd(d.ai.totalUsd)} hint={`${compact(d.ai.calls)} calls · ${compact(d.ai.tokens)} tokens`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Profile">
          <Row label="Age" value={p.age} />
          <Row label="Curriculum" value={p.curriculum} />
          <Row label="Grade" value={p.grade} />
          <Row label="School" value={p.school ? `${p.school}${p.schoolFromList ? "" : " (typed)"}` : null} />
          <Row label="Governorate" value={p.governorate} />
          <Row label="Area" value={p.area} />
          <Row label="Country" value={p.country} />
          <Row label="Language" value={p.preferredLang === "ar" ? "Arabic" : p.preferredLang === "en" ? "English" : p.preferredLang} />
          <Row label="Weekly study hours" value={p.weeklyStudyHours} />
          <Row label="Goals" value={p.goals} />
          <Row label="Parents linked" value={p.parents.length ? p.parents.join(", ") : null} />
          <Row label="Referred by" value={p.referredBy ? `${p.referredBy.referrer} (${p.referredBy.code})` : null} />
          <Row label="Referrals made" value={p.referralsMade} />
        </Panel>

        <Panel title="Subjects & payments">
          <Table head={["Subject", "Price", "Since", "Expires"]} empty="No subjects yet." rows={d.subjects.map((s) => [s.name, egp(s.priceEGP), fmtDate(s.since), s.expiresAt ? fmtDate(s.expiresAt) : "—"])} />
          <div className="mt-4">
            <Row label="Subscription" value={d.subscription ? `${d.subscription.status} · ${egp(d.subscription.monthlyTotalEGP)}/month` : "none"} />
            {d.subscription?.currentPeriodEnd && <Row label="Current period ends" value={fmtDate(d.subscription.currentPeriodEnd)} />}
            {d.subscription && <Row label="Homework add-on" value={d.subscription.homeworkAddonActive ? "active" : "no"} />}
          </div>
          <h3 className="mb-1 mt-4 text-sm font-medium text-neutral-600">InstaPay receipts</h3>
          <Table head={["Date", "Amount", "Status"]} empty="No payments submitted." rows={d.payments.map((x) => [fmtDate(x.createdAt), egp(x.submittedAmountEGP), x.status + (x.rejectionReason ? ` — ${x.rejectionReason}` : "")])} />
        </Panel>

        <Panel title="Free trials">
          {d.trials.lessonTrial ? (
            <>
              <p className="text-sm text-neutral-600">Lesson trial started {fmtDate(d.trials.lessonTrial.startedAt)}</p>
              <Table head={["Subject", "Lesson", "Date"]} empty="Trial started but no lesson used yet." rows={d.trials.lessonTrial.lessons.map((l) => [l.subject, l.topic, fmtDate(l.at)])} />
            </>
          ) : <p className="text-sm text-neutral-500">No lesson trial.</p>}
          <div className="mt-4">
            {d.trials.tutorTrial ? (
              <>
                <Row label="Tutor trial subject" value={d.trials.tutorTrial.subject} />
                <Row label="Questions used" value={d.trials.tutorTrial.questionsUsed} />
                <Row label="Finished" value={d.trials.tutorTrial.completedAt ? fmtDate(d.trials.tutorTrial.completedAt) : "not yet"} />
              </>
            ) : <p className="text-sm text-neutral-500">No AI tutor trial.</p>}
          </div>
        </Panel>
      </div>

      <Panel title="AI consumption">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1"><h3 className="mb-2 text-sm font-medium text-neutral-600">By feature</h3><BarList rows={d.ai.byFeature.map((f) => ({ key: `${f.feature} (${f.calls} calls)`, value: f.costUsd }))} format={usd} empty="No AI usage." /></div>
          <div className="lg:col-span-1"><h3 className="mb-2 text-sm font-medium text-neutral-600">By subject</h3><BarList rows={d.ai.bySubject.map((s) => ({ key: `${s.subject} (${s.calls})`, value: s.costUsd }))} format={usd} empty="No AI usage." /></div>
          <div className="lg:col-span-1"><h3 className="mb-2 text-sm font-medium text-neutral-600">Last 30 days</h3><DailyColumns points={d.ai.daily.map((x) => ({ day: x.day, value: x.costUsd }))} format={usd} /></div>
        </div>
      </Panel>

      <Panel title={`Lessons (${d.lessons.length})`}>
        <Table head={["Lesson", "Subject", "Status", "Progress", "Started", "Last activity"]} empty="No lessons opened yet."
          rows={d.lessons.map((l) => [l.topic, l.subject, l.status === "COMPLETED" ? `Completed ${fmtDate(l.completedAt)}` : "In progress", l.totalSteps ? `step ${Math.min(l.step, l.totalSteps)}/${l.totalSteps}` : `step ${l.step}`, fmtDate(l.startedAt), fmtDateTime(l.lastActivityAt)])} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={`Quizzes (${d.quizzes.length})`}>
          <Table head={["Type", "Topic", "Score", "Date"]} empty="No quizzes yet." rows={d.quizzes.map((q) => [q.quizType, q.topic?.nameEn ?? "—", `${q.correctCount}/${q.totalQuestions} (${Math.round(q.score)}%)`, fmtDate(q.createdAt)])} />
        </Panel>
        <Panel title={`Practice (${d.practice.attempts} answers)`}>
          <Table head={["Subject", "Answers", "Correct"]} empty="No practice yet." rows={d.practice.bySubject.map((s) => [s.subject, s.attempts, pct(s.accuracy)])} />
          {d.practice.bySource.length > 0 && <p className="mt-2 text-xs text-neutral-500">By source: {d.practice.bySource.map((s) => `${s.key} ${s.count}`).join(" · ")}</p>}
        </Panel>
        <Panel title={`AI tutor chats (${d.tutorConversations.length})`}>
          <Table head={["Chat", "Messages", "Last message"]} empty="No tutor chats." rows={d.tutorConversations.map((c) => [c.title ?? "Untitled", c.messages, fmtDateTime(c.lastAt)])} />
        </Panel>
        <Panel title={`Homework help (${d.homework.length})`}>
          <Table head={["Subject", "Question", "Status", "Date"]} empty="No homework sessions." rows={d.homework.map((h) => [h.subject.nameEn, <span key="q" className="line-clamp-2 text-xs">{h.extractedQuestion}</span>, h.solvedAt ? "solved" : h.solutionRevealed ? "solution shown" : h.status.toLowerCase().replace(/_/g, " "), fmtDate(h.createdAt)])} />
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Timeline">
          <ol className="max-h-[32rem] space-y-2 overflow-y-auto pe-2">
            {d.timeline.map((e, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="w-36 shrink-0 text-xs tabular-nums text-neutral-500">{fmtDateTime(e.at)}</span>
                <span className="text-neutral-700">{e.text}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title={`Support tickets (${d.supportTickets.length})`}>
          <Table head={["Title", "Status", "Opened"]} empty="No support tickets." rows={d.supportTickets.map((t) => [t.title, t.status.toLowerCase().replace(/_/g, " "), fmtDate(t.createdAt)])} />
        </Panel>
      </div>
    </div>
  );
}

export default function AdminStudentDetailPage() {
  const { locale, studentId } = useParams<{ locale: Locale; studentId: string }>();
  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN"]}>
      <main className="py-12">
        <SmartifyContainer>
          <Link href={`/${locale}/admin/students`} className="text-sm text-sf-blue-500 hover:underline">← All students</Link>
          <StudentDetail studentId={studentId} />
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
