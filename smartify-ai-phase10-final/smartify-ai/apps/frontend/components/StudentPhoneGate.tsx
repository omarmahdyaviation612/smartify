"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { SmartifyButton } from "@smartify/ui";
import { ApiError, useApiClient } from "@/lib/api-client";
import { normalizePhoneNumber } from "@/lib/phone";

const COPY = {
  ar: {
    title: "محتاجين رقم موبايل ولي الأمر",
    body: "عشان نقدر نتابع مستوى الطالب ونساعدكم بسرعة لو حصلت أي مشكلة. هنتواصل على واتساب بس.",
    label: "رقم موبايل ولي الأمر (واتساب)",
    save: "حفظ ومتابعة",
    invalid: "اكتب رقم موبايل صحيح، مثلاً 01012345678.",
    failed: "مقدرناش نحفظ الرقم. اتأكد من الاتصال وحاول تاني.",
  },
  en: {
    title: "We need the parent's mobile number",
    body: "So we can follow up on the student's progress and help quickly if anything goes wrong. We'll only contact you on WhatsApp.",
    label: "Parent's mobile number (WhatsApp)",
    save: "Save and continue",
    invalid: "Enter a valid mobile number, e.g. 01012345678.",
    failed: "Couldn't save the mobile number. Check your connection and try again.",
  },
};

/**
 * Contact phone (2026-10-13): students who finished onboarding before the
 * mobile number became required are asked for it once, in a blocking
 * dialog, on their next visit. Onboarding pages collect it themselves.
 */
export function StudentPhoneGate({ locale }: { locale: string }) {
  const copy = COPY[locale === "en" ? "en" : "ar"];
  const pathname = usePathname() ?? "";
  const { isLoaded, isSignedIn } = useAuth();
  const { apiFetch } = useApiClient();
  const [needed, setNeeded] = useState(false);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const skip = /\/(onboarding|sign-in|sign-up|admin|parent)(\/|$)/.test(pathname);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || skip) return;
    let active = true;
    apiFetch<{ role?: string; phone?: string | null; hasStudentProfile?: boolean }>("/users/me")
      .then((me) => { if (active) setNeeded(me?.role === "STUDENT" && !!me.hasStudentProfile && !me.phone); })
      .catch(() => undefined);
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, skip]);

  if (!needed || skip) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!normalizePhoneNumber(phone)) { setError(copy.invalid); return; }
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/users/me/phone", { method: "PUT", body: JSON.stringify({ phone: phone.trim() }) });
      setNeeded(false);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? copy.invalid : copy.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-navy-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="phone-gate-title">
      <form onSubmit={save} className="w-full max-w-md rounded-sf-lg bg-white p-6 shadow-xl">
        <h2 id="phone-gate-title" className="text-xl font-bold text-navy-900">{copy.title}</h2>
        <p className="mt-2 text-sm text-neutral-600">{copy.body}</p>
        <label className="mt-5 block">
          <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.label}</span>
          <input
            required
            autoFocus
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            placeholder="01012345678"
            maxLength={25}
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError(null); }}
            aria-invalid={!!error}
            className={`w-full rounded-sf border px-4 py-2 text-start ${error ? "border-error-500" : "border-neutral-300"}`}
          />
          {error && <span role="alert" className="mt-1 block text-sm text-error-500">{error}</span>}
        </label>
        <SmartifyButton type="submit" variant="ai" className="mt-5 w-full" disabled={saving}>{copy.save}</SmartifyButton>
      </form>
    </div>
  );
}
