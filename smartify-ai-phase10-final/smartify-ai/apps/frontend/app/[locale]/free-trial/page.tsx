"use client";

import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getMarketingCopy } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { useApiClient } from "@/lib/api-client";
import { useCurrentUser } from "@/lib/use-current-user";
import type { Locale } from "@/content/marketing";

interface Subject {
  id: string;
  nameEn: string;
  nameAr: string;
}

export default function FreeTrialPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const router = useRouter();
  const copy = getMarketingCopy(locale);
  const { apiFetch } = useApiClient();
  const { isLoaded, isSignedIn } = useAuth();
  const { user, loading: userLoading } = useCurrentUser();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace(`/${locale}/sign-up`);
      return;
    }
    if (userLoading) return;
    if (user?.role === "PARENT") {
      router.replace(`/${locale}/parent`);
      return;
    }

    apiFetch<{ subjects: Subject[] }>("/dashboard/summary")
      .then((data) => {
        setSubjects(data.subjects);
        if (data.subjects.length > 0) setSelectedSubject(data.subjects[0].id);
        setLoading(false);
      })
      .catch((err) => {
        setError(err?.message || "Failed to load subjects");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, locale, userLoading, user?.role]);

  const handleStartTrial = () => {
    if (!selectedSubject) {
      setError("Please select a subject");
      return;
    }
    router.push(`/${locale}/tutor?subjectId=${selectedSubject}`);
  };

  if (!isLoaded || (isSignedIn && userLoading) || (user?.role === "PARENT")) {
    return (
      <>
        <Navbar locale={locale} copy={copy} />
        <main className="min-h-[70vh] bg-neutral-50 py-12">
          <SmartifyContainer className="max-w-2xl">
            <div className="rounded-sf-xl bg-white p-8 shadow-sm text-center text-neutral-600">
              {isAr ? "جاري التحقق من الحساب..." : "Checking your account..."}
            </div>
          </SmartifyContainer>
        </main>
      </>
    );
  }

  if (!isSignedIn) {
    return (
      <>
        <Navbar locale={locale} copy={copy} />
        <main className="min-h-[70vh] bg-neutral-50 py-12">
          <SmartifyContainer className="max-w-2xl">
            <div className="rounded-sf-xl bg-white p-8 shadow-sm">
              <h1 className="text-3xl font-bold text-navy-900">
                {isAr ? "يجب عليك التسجيل أولاً" : "You must sign up first"}
              </h1>
              <p className="mt-3 text-neutral-600">
                {isAr ? "قم بتسجيل الدخول أو إنشاء حساب للمتابعة." : "Please sign in or create an account to continue."}
              </p>
              <div className="mt-6">
                <SmartifyButton variant="ai" onClick={() => router.push(`/${locale}/sign-up`)}>
                  {isAr ? "تسجيل الدخول" : "Sign in"}
                </SmartifyButton>
              </div>
            </div>
          </SmartifyContainer>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar locale={locale} copy={copy} />
      <main className="min-h-[70vh] bg-neutral-50 py-12">
        <SmartifyContainer className="max-w-2xl">
          <div className="rounded-sf-xl bg-white p-8 shadow-sm">
            <h1 className="text-3xl font-bold text-navy-900">
              {isAr ? "جلسة التعلم المجانية" : "Free Learning Session"}
            </h1>
            <p className="mt-2 text-neutral-600">
              {isAr
                ? "استمتع بجلسة مجانية مع المعلم الذكي. اختر المادة التي تريد دراستها."
                : "Enjoy a free session with the AI Tutor. Choose the subject you want to study."}
            </p>

            {/* Trial Info Card */}
            <div className="mt-6 rounded-sf-lg border-2 border-sf-cyan-400 bg-sf-cyan-50 p-6">
              <h2 className="font-semibold text-navy-900">
                {isAr ? "ماذا تتوقع:" : "What to expect:"}
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-neutral-700">
                <li>
                  • {isAr ? "سؤالان فقط في هذه الجلسة" : "2 questions in this session"}
                </li>
                <li>
                  • {isAr ? "مادة واحدة فقط" : "Single subject only"}
                </li>
                <li>
                  • {isAr ? "شروحات مفصلة من المعلم الذكي" : "Detailed explanations from AI Tutor"}
                </li>
                <li>
                  • {isAr ? "بعدها ستحتاج للاشتراك للمتابعة" : "Subscribe afterwards to continue"}
                </li>
              </ul>
            </div>

            {/* Subject Selection */}
            <div className="mt-8">
              <label className="block font-medium text-navy-900">
                {isAr ? "اختر المادة:" : "Select subject:"}
              </label>
              {loading ? (
                <p className="mt-2 text-neutral-500">{isAr ? "جاري التحميل..." : "Loading..."}</p>
              ) : subjects.length === 0 ? (
                <div className="mt-4 rounded-sf-lg bg-orange-50 p-4 text-orange-800">
                  <p>
                    {isAr
                      ? "يجب عليك إكمال التسجيل أولاً لاختيار المواد."
                      : "Please complete onboarding first to select subjects."}
                  </p>
                  <SmartifyButton
                    variant="secondary"
                    onClick={() => router.push(`/${locale}/onboarding/curriculum`)}
                    className="mt-4"
                  >
                    {isAr ? "أكمل التسجيل" : "Complete Onboarding"}
                  </SmartifyButton>
                </div>
              ) : (
                <select
                  value={selectedSubject || ""}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  className="mt-3 w-full rounded-sf border border-neutral-300 bg-white px-4 py-3 text-neutral-900"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {isAr ? s.nameAr : s.nameEn}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Error Message */}
            {error && <p className="mt-4 text-sm text-error-600">{error}</p>}

            {/* Action Buttons */}
            {subjects.length > 0 && (
              <div className="mt-8 flex gap-3">
                <SmartifyButton
                  variant="ai"
                  onClick={handleStartTrial}
                  disabled={!selectedSubject || loading}
                >
                  {isAr ? "ابدأ الجلسة المجانية" : "Start Free Session"}
                </SmartifyButton>
                <SmartifyButton
                  variant="secondary"
                  onClick={() => router.back()}
                >
                  {isAr ? "رجوع" : "Back"}
                </SmartifyButton>
              </div>
            )}
          </div>
        </SmartifyContainer>
      </main>
    </>
  );
}
