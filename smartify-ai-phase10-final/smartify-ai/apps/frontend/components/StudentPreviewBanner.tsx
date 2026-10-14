"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useApiClient } from "@/lib/api-client";

const PREVIEW_KEY = "smartify-admin-student-preview";
const SESSION_KEY = "smartify-admin-student-preview-session";
const NAME_KEY = "smartify-admin-student-preview-name";

export function StudentPreviewBanner() {
  const { locale } = useParams<{ locale: string }>();
  const { apiFetch } = useApiClient();
  const router = useRouter();
  const [student, setStudent] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const id = window.sessionStorage.getItem(PREVIEW_KEY);
    if (id) setStudent({ id, name: window.sessionStorage.getItem(NAME_KEY) || "Student" });
  }, []);

  async function stopPreview() {
    if (!student || busy) return;
    setBusy(true);
    setError(false);
    try {
      await apiFetch("/users/test-preview/stop", {
        method: "POST",
        body: JSON.stringify({ studentId: student.id, sessionId: window.sessionStorage.getItem(SESSION_KEY) }),
        headers: { "X-Skip-Student-Preview": "true" },
      });
      window.sessionStorage.removeItem(PREVIEW_KEY);
      window.sessionStorage.removeItem(SESSION_KEY);
      window.sessionStorage.removeItem(NAME_KEY);
      setStudent(null);
      router.push(`/${locale}/admin/student-preview`);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (!student) return null;
  const isAr = locale === "ar";
  return (
    <div className="sticky top-0 z-[100] flex flex-wrap items-center justify-center gap-3 bg-amber-300 px-4 py-2 text-sm font-semibold text-navy-900 shadow">
      <span>{isAr ? `وضع اختبار الطالب: ${student.name} — لا توجد مدفوعات حقيقية` : `Student test mode: ${student.name} — real payments are disabled`}</span>
      <button type="button" onClick={stopPreview} disabled={busy} className="rounded-full bg-white px-3 py-1 underline disabled:opacity-50">
        {busy ? (isAr ? "جارٍ الإنهاء…" : "Ending…") : (isAr ? "إنهاء والعودة للإدارة" : "End and return to admin")}
      </button>
      {error && <span role="alert" className="basis-full text-center font-normal">{isAr ? "تعذر إنهاء المعاينة. أعد المحاولة." : "Could not end preview; please try again."}</span>}
    </div>
  );
}
