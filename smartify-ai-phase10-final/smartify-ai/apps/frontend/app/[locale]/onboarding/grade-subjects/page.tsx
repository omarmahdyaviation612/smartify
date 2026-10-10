"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getOnboardingCopy } from "@/content/onboarding";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { DEFAULT_COUNTRY, getOnboardingPrerequisite, readDraft, trackOnboardingStep, writeDraft } from "@/lib/onboarding-draft";
import { EGYPT_GOVERNORATES } from "@/content/governorates";
import { SchoolCombobox } from "@/components/SchoolCombobox";
import { ApiError, useApiClient } from "@/lib/api-client";
import { API_URL } from "@/lib/api";
import type { Locale } from "@/content/marketing";
import type { CurriculumCatalogEntry } from "@/components/CurriculumExplorer";

const COUNTRIES: Array<{ value: string; ar: string; en: string }> = [
  { value: "Egypt", ar: "مصر", en: "Egypt" },
  { value: "Saudi Arabia", ar: "السعودية", en: "Saudi Arabia" },
  { value: "United Arab Emirates", ar: "الإمارات", en: "UAE" },
  { value: "Kuwait", ar: "الكويت", en: "Kuwait" },
  { value: "Qatar", ar: "قطر", en: "Qatar" },
  { value: "Other", ar: "دولة أخرى", en: "Other" },
];

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

  // Optional "school & location" section (moved here from step 1 by the
  // onboarding drop-off fix, 2026-10-11). Country defaults to Egypt.
  const [country, setCountry] = useState(draft.country || DEFAULT_COUNTRY);
  const [governorate, setGovernorate] = useState(draft.governorate ?? "");
  const [area, setArea] = useState(draft.area ?? "");
  const [schoolId, setSchoolId] = useState(draft.schoolId ?? "");
  const [schoolLabel, setSchoolLabel] = useState("");
  const [schoolNameManual, setSchoolNameManual] = useState(draft.schoolNameManual ?? "");
  const [manualEntry, setManualEntry] = useState(!!draft.schoolNameManual && !draft.schoolId);
  const isEgypt = country === "Egypt";

  function toggleManualEntry(next: boolean) {
    setManualEntry(next);
    if (next) {
      setSchoolId("");
      setSchoolLabel("");
    } else {
      setSchoolNameManual("");
    }
  }

  useEffect(() => {
    trackOnboardingStep(apiFetch, "grade-subjects");
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
    if (!latestDraft.fullName || !latestDraft.age) {
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

    const location = {
      country: country || DEFAULT_COUNTRY,
      governorate: isEgypt ? governorate || undefined : undefined,
      area: area.trim() || undefined,
      schoolId: isEgypt && !manualEntry ? schoolId || undefined : undefined,
      schoolNameManual: manualEntry || !isEgypt ? schoolNameManual.trim() || undefined : undefined,
    };

    try {
      await apiFetch("/onboarding/profile", {
        method: "POST",
        body: JSON.stringify({
          fullName: latestDraft.fullName,
          age: latestDraft.age,
          country: location.country,
          preferredLang: latestDraft.preferredLang ?? locale,
          curriculumCode: latestDraft.curriculumCode,
          gradeId: selectedGrade.id,
          subjectIds,
          weeklyStudyHours,
          goals: goals || undefined,
          governorate: location.governorate,
          area: location.area,
          schoolId: location.schoolId,
          schoolNameManual: location.schoolNameManual,
        }),
      });
      writeDraft({ gradeId: selectedGrade.id, subjectIds, weeklyStudyHours, goals, ...location });

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
      } else if (submitError instanceof ApiError && submitError.status === 400 && submitError.message) {
        // Show the backend's reason (e.g. a school from another governorate)
        // instead of a generic message the student can't act on.
        setError(`${copy.gradeSubjects.submitError} (${submitError.message})`);
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

              <details className="rounded-sf-lg border border-neutral-200 bg-white p-4" open={!!(draft.governorate || draft.schoolId || draft.schoolNameManual)}>
                <summary className="cursor-pointer text-sm font-medium text-neutral-700">{copy.profile.schoolSectionLabel}</summary>
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.profile.countryLabel}</span>
                    <select
                      value={COUNTRIES.some((c) => c.value === country) ? country : "Other"}
                      onChange={(e) => {
                        setCountry(e.target.value);
                        setGovernorate("");
                        setSchoolId("");
                        setSchoolLabel("");
                      }}
                      className="w-full rounded-sf border border-neutral-300 bg-white px-4 py-2"
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.value} value={c.value}>{isAr ? c.ar : c.en}</option>
                      ))}
                    </select>
                  </label>

                  {isEgypt && (
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.profile.governorateLabel}</span>
                      <select
                        value={governorate}
                        onChange={(e) => {
                          setGovernorate(e.target.value);
                          // A school belongs to one governorate — never carry a stale one over.
                          setSchoolId("");
                          setSchoolLabel("");
                        }}
                        className="w-full rounded-sf border border-neutral-300 bg-white px-4 py-2"
                      >
                        <option value="">{isAr ? "اختر" : "Select"}</option>
                        {EGYPT_GOVERNORATES.map((g) => (
                          <option key={g.code} value={g.code}>{isAr ? g.nameAr : g.nameEn}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.profile.areaLabel}</span>
                    <input value={area} onChange={(e) => setArea(e.target.value)} className="w-full rounded-sf border border-neutral-300 px-4 py-2" />
                  </label>

                  <div>
                    <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.profile.schoolLabel}</span>
                    {isEgypt && !manualEntry ? (
                      <>
                        <SchoolCombobox
                          locale={locale}
                          governorate={governorate}
                          value={schoolId ? { id: schoolId, label: schoolLabel } : null}
                          onSelect={(school) => {
                            setSchoolId(school?.id ?? "");
                            setSchoolLabel(school?.label ?? "");
                          }}
                          placeholder={copy.profile.schoolSearchPlaceholder}
                          noResultsLabel={copy.profile.schoolNoResults}
                        />
                        <button type="button" onClick={() => toggleManualEntry(true)} className="mt-2 text-sm font-medium text-sf-blue-500 underline">
                          {copy.profile.schoolNotListedLabel}
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          value={schoolNameManual}
                          onChange={(e) => setSchoolNameManual(e.target.value)}
                          placeholder={copy.profile.schoolManualLabel}
                          className="w-full rounded-sf border border-neutral-300 px-4 py-2"
                        />
                        {isEgypt && (
                          <button type="button" onClick={() => toggleManualEntry(false)} className="mt-2 text-sm font-medium text-sf-blue-500 underline">
                            {copy.profile.schoolBackToSearchLabel}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </details>

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
