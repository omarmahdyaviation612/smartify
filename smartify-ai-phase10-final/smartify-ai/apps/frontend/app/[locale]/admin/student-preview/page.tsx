"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { AdminDashboardLink } from "@/components/AdminDashboardLink";
import { useApiClient } from "@/lib/api-client";

interface AdminUser { id: string; email: string; role: string; isActive: boolean; isTestStudent: boolean; studentProfile?: { fullName?: string } | null }
const PREVIEW_KEY = "smartify-admin-student-preview";
const SESSION_KEY = "smartify-admin-student-preview-session";
const NAME_KEY = "smartify-admin-student-preview-name";

function StudentPreviewPicker() {
  const { locale } = useParams<{ locale: string }>();
  const isAr = locale === "ar";
  const router = useRouter();
  const { apiFetch } = useApiClient();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [studentId, setStudentId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const candidates = useMemo(() => (users ?? []).filter((user) => user.role === "STUDENT" && user.isActive && user.isTestStudent), [users]);

  useEffect(() => {
    apiFetch<AdminUser[]>("/users").then(setUsers).catch(() => setError(isAr ? "تعذر تحميل حسابات الطلاب التجريبية." : "Could not load student test accounts."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startPreview() {
    const target = candidates.find((candidate) => candidate.id === studentId);
    if (!target || busy) return;
    setBusy(true);
    setError("");
    try {
      const started = await apiFetch<{ sessionId: string; studentId: string; studentName: string }>(`/users/${target.id}/test-preview/start`, { method: "POST" });
      window.sessionStorage.setItem(PREVIEW_KEY, started.studentId);
      window.sessionStorage.setItem(SESSION_KEY, started.sessionId);
      window.sessionStorage.setItem(NAME_KEY, started.studentName);
      router.push(`/${locale}/dashboard`);
    } catch {
      setError(isAr ? "لم نتمكن من بدء المعاينة. تأكد أن الحساب مفعّل للاختبار." : "Preview could not start. Check that test access is enabled for this account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminDashboardLink />
      <main className="py-12">
        <SmartifyContainer>
          <h1 className="text-2xl font-bold text-navy-900">{isAr ? "اختبار تجربة الطالب" : "Test the student experience"}</h1>
          <p className="mt-2 max-w-3xl text-sm text-neutral-600">
            {isAr ? "اختر حسابًا تجريبيًا مفعّلًا لاختبار صفحات الطالب وميزاته. تغييرات التقدم تحفظ على الحساب التجريبي فقط، والمدفوعات الحقيقية معطلة في هذا الوضع." : "Choose an enabled test account to explore the student pages and features. Progress changes are saved only to that test account; real payments are disabled in this mode."}
          </p>
          <section className="mt-6 max-w-2xl rounded-sf-lg border border-neutral-200 bg-white p-6">
            <label htmlFor="student-preview" className="block text-sm font-medium text-navy-900">{isAr ? "حساب الطالب التجريبي" : "Student test account"}</label>
            <select id="student-preview" value={studentId} onChange={(event) => setStudentId(event.target.value)} disabled={!users || !candidates.length} className="mt-2 w-full rounded-sf border border-neutral-300 bg-white p-3">
              <option value="">{users ? (isAr ? "اختر حسابًا" : "Choose an account") : (isAr ? "جارٍ التحميل…" : "Loading…")}</option>
              {candidates.map((user) => <option key={user.id} value={user.id}>{user.studentProfile?.fullName || user.email} — {user.email}</option>)}
            </select>
            {!candidates.length && users && <p className="mt-3 text-sm text-neutral-500">{isAr ? "لا توجد حسابات تجريبية مفعّلة. فعّل الوصول لحساب طالب من صفحة المستخدمين أولًا." : "No test accounts are enabled. Enable test access for a student from the Users page first."}</p>}
            {error && <p role="alert" className="mt-3 text-sm text-error-500">{error}</p>}
            <button type="button" onClick={startPreview} disabled={!studentId || busy} className="mt-4 rounded-sf bg-sf-blue-500 px-5 py-3 font-semibold text-white disabled:opacity-50">
              {busy ? (isAr ? "جارٍ الفتح…" : "Opening…") : (isAr ? "ابدأ اختبار الطالب" : "Start student test")}
            </button>
          </section>
        </SmartifyContainer>
      </main>
    </>
  );
}

export default function StudentPreviewPage() {
  return <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN"]}><StudentPreviewPicker /></AdminGuard>;
}
