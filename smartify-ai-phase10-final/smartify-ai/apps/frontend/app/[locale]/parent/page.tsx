"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { ApiError, useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";
import { getMarketingCopy } from "@/content/marketing";

type Student = { id: string; fullName: string; attempts: number; quizzes: number; canViewConversations: boolean };

// "unauthorized" means the signed-in account doesn't have Parent access
// enabled yet (backend RolesGuard 403) — distinct from a genuine Parent
// account that simply has zero linked students, and distinct from a
// network/server failure. See Parent Access Gating UX Clarity task.
type AccessState = "checking" | "authorized" | "unauthorized" | "error";

export default function ParentDashboardPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const searchParams = useSearchParams();
  const isAr = locale === "ar";
  const { apiFetch } = useApiClient();
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [students, setStudents] = useState<Student[]>([]);
  const [code, setCode] = useState(() => searchParams.get("code")?.toUpperCase() ?? "");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const parentAccessMessage = isAr
    ? "وصول ولي الأمر غير مفعّل على هذا الحساب بعد. الميزة قيد الطرح حاليًا، ويحتاج فريق سمارتيفاي إلى تفعيلها على حسابك أولًا."
    : "Parent access isn't enabled on this account yet. Parent access is currently rolling out, and our team needs to enable it on your account first.";
  const loadErrorMessage = isAr
    ? "حدث خطأ أثناء تحميل لوحة ولي الأمر. حاول مرة أخرى."
    : "Something went wrong loading your parent dashboard. Please try again.";

  const load = () =>
    apiFetch<{ students: Student[] }>("/parent/dashboard/summary")
      .then((x) => { setStudents(x.students); setAccessState("authorized"); })
      .catch((e: any) => setAccessState(e instanceof ApiError && e.status === 403 ? "unauthorized" : "error"));
  // The API client is recreated by the auth hook; load once when the page mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);
  async function bootstrap() {
    try { await apiFetch("/parent/profile", { method: "POST", body: JSON.stringify({ fullName: name }) }); setMessage(isAr ? "تم حفظ الملف" : "Profile saved"); }
    catch (e: any) { setMessage(e instanceof ApiError && e.status === 403 ? parentAccessMessage : e.message); }
  }
  async function accept() {
    try { await apiFetch("/parent/links/accept", { method: "POST", body: JSON.stringify({ code }) }); setCode(""); setMessage(isAr ? "تم ربط الطالب" : "Student linked"); load(); }
    catch (e: any) { setMessage(e instanceof ApiError && e.status === 403 ? parentAccessMessage : e.message); }
  }
  return <><Navbar locale={locale} copy={getMarketingCopy(locale)} /><main className="py-12"><SmartifyContainer>
    <h1 className="mb-8 text-3xl font-bold text-navy-900">{isAr ? "لوحة ولي الأمر" : "Parent dashboard"}</h1>

    {accessState === "checking" && <p className="mb-6 text-sm text-neutral-500">{isAr ? "جاري التحميل..." : "Loading..."}</p>}

    {accessState === "unauthorized" && (
      <div className="mb-6 rounded-sf-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <p>{parentAccessMessage}</p>
        {code && (
          <p className="mt-2">
            {isAr
              ? `احتفظنا برمز الربط الخاص بك (${code}) — يمكنك العودة إلى هذه الصفحة لإتمام الربط بمجرد تفعيل وصول ولي الأمر.`
              : `We've kept your link code (${code}) saved — come back to this page to finish linking once Parent access is enabled.`}
          </p>
        )}
        <SmartifyButton variant="secondary" className="mt-4" onClick={() => { setAccessState("checking"); void load(); }}>
          {isAr ? "إعادة المحاولة" : "Try again"}
        </SmartifyButton>
      </div>
    )}

    {accessState === "error" && (
      <div role="alert" className="mb-6 text-sm text-error-500">
        <p>{loadErrorMessage}</p>
        <SmartifyButton variant="secondary" className="mt-3" onClick={() => { setAccessState("checking"); void load(); }}>
          {isAr ? "إعادة المحاولة" : "Try again"}
        </SmartifyButton>
      </div>
    )}

    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-sf-lg border border-neutral-200 bg-white p-6"><h2 className="mb-3 font-semibold">{isAr ? "ملف ولي الأمر" : "Parent profile"}</h2><input className="mb-3 w-full rounded border p-2" value={name} onChange={(e) => setName(e.target.value)} placeholder={isAr ? "الاسم الكامل" : "Full name"} /><SmartifyButton onClick={bootstrap}>{isAr ? "حفظ" : "Save"}</SmartifyButton></section>
      <section className="rounded-sf-lg border border-neutral-200 bg-white p-6"><h2 className="mb-3 font-semibold">{isAr ? "ربط طالب" : "Link a student"}</h2><input className="mb-3 w-full rounded border p-2 uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder={isAr ? "رمز الربط" : "Link code"} /><SmartifyButton onClick={accept}>{isAr ? "ربط" : "Link"}</SmartifyButton></section>
    </div>
    {message && <p className="mt-4 text-sm text-neutral-600">{message}</p>}
    {accessState === "authorized" && (
      <section className="mt-8"><h2 className="mb-4 text-xl font-semibold">{isAr ? "الطلاب المرتبطون" : "Linked students"}</h2><div className="grid gap-4 md:grid-cols-2">{students.map((s) => <article key={s.id} className="rounded-sf-lg border border-neutral-200 bg-white p-5"><h3 className="font-semibold">{s.fullName}</h3><p className="mt-2 text-sm text-neutral-600">{isAr ? "الإجابات" : "Attempts"}: {s.attempts} · {isAr ? "الاختبارات" : "Quizzes"}: {s.quizzes}</p><p className="mt-2 text-xs text-neutral-500">{s.canViewConversations ? (isAr ? "عرض المحادثات مفعّل" : "Conversation viewing enabled") : (isAr ? "المحادثات خاصة" : "Conversations are private")}</p></article>)}</div></section>
    )}
  </SmartifyContainer></main></>;
}
