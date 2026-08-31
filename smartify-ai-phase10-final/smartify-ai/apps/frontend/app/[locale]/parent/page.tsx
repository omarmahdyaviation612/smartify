"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";
import { getMarketingCopy } from "@/content/marketing";

type Student = { id: string; fullName: string; attempts: number; quizzes: number; canViewConversations: boolean };

export default function ParentDashboardPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const searchParams = useSearchParams();
  const isAr = locale === "ar";
  const { apiFetch } = useApiClient();
  const [students, setStudents] = useState<Student[]>([]);
  const [code, setCode] = useState(() => searchParams.get("code")?.toUpperCase() ?? "");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const load = () => apiFetch<{ students: Student[] }>("/parent/dashboard/summary").then((x) => setStudents(x.students)).catch(() => undefined);
  // The API client is recreated by the auth hook; load once when the page mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);
  async function bootstrap() {
    try { await apiFetch("/parent/profile", { method: "POST", body: JSON.stringify({ fullName: name }) }); setMessage(isAr ? "تم حفظ الملف" : "Profile saved"); }
    catch (e: any) { setMessage(e.message); }
  }
  async function accept() {
    try { await apiFetch("/parent/links/accept", { method: "POST", body: JSON.stringify({ code }) }); setCode(""); setMessage(isAr ? "تم ربط الطالب" : "Student linked"); load(); }
    catch (e: any) { setMessage(e.message); }
  }
  return <><Navbar locale={locale} copy={getMarketingCopy(locale)} /><main className="py-12"><SmartifyContainer>
    <h1 className="mb-8 text-3xl font-bold text-navy-900">{isAr ? "لوحة ولي الأمر" : "Parent dashboard"}</h1>
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-sf-lg border border-neutral-200 bg-white p-6"><h2 className="mb-3 font-semibold">{isAr ? "ملف ولي الأمر" : "Parent profile"}</h2><input className="mb-3 w-full rounded border p-2" value={name} onChange={(e) => setName(e.target.value)} placeholder={isAr ? "الاسم الكامل" : "Full name"} /><SmartifyButton onClick={bootstrap}>{isAr ? "حفظ" : "Save"}</SmartifyButton></section>
      <section className="rounded-sf-lg border border-neutral-200 bg-white p-6"><h2 className="mb-3 font-semibold">{isAr ? "ربط طالب" : "Link a student"}</h2><input className="mb-3 w-full rounded border p-2 uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder={isAr ? "رمز الربط" : "Link code"} /><SmartifyButton onClick={accept}>{isAr ? "ربط" : "Link"}</SmartifyButton></section>
    </div>
    {message && <p className="mt-4 text-sm text-neutral-600">{message}</p>}
    <section className="mt-8"><h2 className="mb-4 text-xl font-semibold">{isAr ? "الطلاب المرتبطون" : "Linked students"}</h2><div className="grid gap-4 md:grid-cols-2">{students.map((s) => <article key={s.id} className="rounded-sf-lg border border-neutral-200 bg-white p-5"><h3 className="font-semibold">{s.fullName}</h3><p className="mt-2 text-sm text-neutral-600">{isAr ? "الإجابات" : "Attempts"}: {s.attempts} · {isAr ? "الاختبارات" : "Quizzes"}: {s.quizzes}</p><p className="mt-2 text-xs text-neutral-500">{s.canViewConversations ? (isAr ? "عرض المحادثات مفعّل" : "Conversation viewing enabled") : (isAr ? "المحادثات خاصة" : "Conversations are private")}</p></article>)}</div></section>
  </SmartifyContainer></main></>;
}
