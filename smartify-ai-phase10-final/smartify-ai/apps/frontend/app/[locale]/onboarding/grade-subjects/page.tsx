"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getOnboardingCopy } from "@/content/onboarding";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { getOnboardingPrerequisite, readDraft, writeDraft } from "@/lib/onboarding-draft";
import { ApiError, useApiClient } from "@/lib/api-client";
import { API_URL } from "@/lib/api";
import type { Locale } from "@/content/marketing";
import type { CurriculumCatalogEntry } from "@/components/CurriculumExplorer";

export default function OnboardingGradeSubjectsPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const copy = getOnboardingCopy(locale);
  const router = useRouter();
  const { apiFetch } = useApiClient();
  const draft = readDraft();

  const [catalog, setCatalog] = useState<CurriculumCatalogEntry[] | null>(null);
  const [gradeId, setGradeId] = useState(draft.gradeId ?? "");
  const [subjectIds, setSubjectIds] = useState<string[]>(draft.subjectIds ?? []);
  const [studyHours, setStudyHours] = useState(draft.weeklyStudyHours?.toString() ?? "");
  const [goals, setGoals] = useState(draft.goals ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const currentDraft = readDraft();
    const previousStep = getOnboardingPrerequisite(currentDraft, "grade-subjects");
    if (previousStep) {
      router.replace(`/${locale}/onboarding/${previousStep}`);
      return;
    }
    fetch(`${API_URL}/curricula`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: CurriculumCatalogEntry[]) => {
        if (!data.some((c) => c.id === currentDraft.curriculumId && c.code === currentDraft.curriculumCode)) {
          router.replace(`/${locale}/onboarding/curriculum`);
          return;
        }
        setCatalog(data);
      })
      .catch(() => setError(copy.curriculum.loadError));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const curriculum = catalog?.find((c) => c.id === draft.curriculumId);
  const grades = useMemo(() => curriculum?.grades ?? [], [curriculum]);
  const selectedGrade = useMemo(() => grades.find((g) => g.id === gradeId) ?? grades[0], [grades, gradeId]);

  function toggleSubject(id: string) {
    setSubjectIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleSubmit() {
    const latestDraft = readDraft();
    if (!latestDraft.curriculumCode) {
      setError(isAr ? "يرجى اختيار المنهج أولًا." : "Please choose a curriculum first.");
      return;
    }
    if (!latestDraft.fullName || !latestDraft.age || !latestDraft.country) {
      setError(isAr ? "يرجى إكمال بيانات الملف الشخصي أولًا." : "Please complete your profile first.");
      return;
    }
    if (!selectedGrade || subjectIds.length === 0) {
      setError(isAr ? "اختر الصف ومادة واحدة على الأقل." : "Choose a grade and at least one subject.");
      return;
    }

    const weeklyStudyHours = studyHours ? Number(studyHours) : undefined;
    if (weeklyStudyHours !== undefined && (!Number.isInteger(weeklyStudyHours) || weeklyStudyHours < 0 || weeklyStudyHours > 60)) {
      setError(isAr ? "أدخل عدد ساعات صحيحًا بين 0 و60." : "Enter a whole number of hours between 0 and 60.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await apiFetch("/onboarding/profile", {
        method: "POST",
        body: JSON.stringify({
          fullName: latestDraft.fullName,
          age: latestDraft.age,
          country: latestDraft.country,
          preferredLang: latestDraft.preferredLang ?? locale,
          curriculumCode: latestDraft.curriculumCode,
          gradeId: selectedGrade.id,
          subjectIds,
          weeklyStudyHours,
          goals: goals || undefined,
        }),
      });
      writeDraft({ gradeId: selectedGrade.id, subjectIds, weeklyStudyHours, goals });

      // Referral V1 (2026-09-20) — the StudentProfile now exists, so this
      // is the earliest point a referral can actually attach. Best-effort
      // and never blocking: a missing/invalid/already-used code must
      // never stop onboarding. Cleared either way so it's only ever
      // submitted once, matching "cannot be changed later".
      const referralCode = window.localStorage.getItem("smartify_referral_code");
      if (referralCode) {
        await apiFetch("/referral/attach", { method: "POST", body: JSON.stringify({ code: referralCode }) }).catch(() => undefined);
        window.localStorage.removeItem("smartify_referral_code");
      }

      router.push(`/${locale}/onboarding/diagnostic`);
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        setError(isAr ? "انتهت جلسة الدخول أو لم تتم مزامنة الحساب. سجّل الدخول مرة أخرى ثم حاول." : "Your session expired or your account is not synced. Sign in again and retry.");
      } else {
        setError(copy.gradeSubjects.submitError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <OnboardingStepper steps={copy.steps} currentIndex={2} />
      <main className="py-16">
        <SmartifyContainer className="mx-auto max-w-xl">
          <h1 className="text-2xl font-bold text-navy-900">{copy.gradeSubjects.title}</h1>
          <p className="mt-2 text-neutral-600">{copy.gradeSubjects.body}</p>

          {!curriculum && error && (
            <p className="mt-6 text-sm text-error-500">{error}</p>
          )}

          {curriculum && (
            <div className="mt-8 space-y-6">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.gradeSubjects.gradeLabel}</span>
                <select
                  value={selectedGrade?.id ?? ""}
                  onChange={(e) => {
                    setGradeId(e.target.value);
                    setSubjectIds([]);
                  }}
                  className="w-full rounded-sf border border-neutral-300 bg-white px-4 py-2"
                >
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {isAr ? g.nameAr : g.nameEn}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.gradeSubjects.subjectsLabel}</span>
                <div className="flex flex-wrap gap-3">
                  {selectedGrade?.subjects.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleSubject(s.id)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                        subjectIds.includes(s.id)
                          ? "border-sf-blue-500 bg-sf-blue-500 text-white"
                          : "border-neutral-300 bg-white text-neutral-700"
                      }`}
                    >
                      {isAr ? s.nameAr : s.nameEn}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.gradeSubjects.studyHoursLabel}</span>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={studyHours}
                  onChange={(e) => setStudyHours(e.target.value)}
                  className="w-full rounded-sf border border-neutral-300 px-4 py-2"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.gradeSubjects.goalsLabel}</span>
                <textarea
                  value={goals}
                  onChange={(e) => setGoals(e.target.value)}
                  rows={3}
                  className="w-full rounded-sf border border-neutral-300 px-4 py-2"
                />
              </label>

              {error && <p className="text-sm text-error-500">{error}</p>}

              <div className="flex justify-between pt-2">
                <SmartifyButton variant="ghost" onClick={() => router.push(`/${locale}/onboarding/curriculum`)}>
                  {copy.gradeSubjects.backLabel}
                </SmartifyButton>
                <SmartifyButton variant="ai" disabled={submitting || subjectIds.length === 0} onClick={handleSubmit}>
                  {copy.gradeSubjects.submitLabel}
                </SmartifyButton>
              </div>
            </div>
          )}
        </SmartifyContainer>
      </main>
    </>
  );
}
