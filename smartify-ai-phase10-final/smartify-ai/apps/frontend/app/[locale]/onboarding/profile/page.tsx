"use client";

import { useRouter, useParams } from "next/navigation";
import { useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getOnboardingCopy } from "@/content/onboarding";
import { EGYPT_GOVERNORATES } from "@/content/governorates";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { SchoolCombobox } from "@/components/SchoolCombobox";
import { readDraft, writeDraft } from "@/lib/onboarding-draft";
import type { Locale } from "@/content/marketing";

export default function OnboardingProfilePage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const copy = getOnboardingCopy(locale);
  const router = useRouter();
  const existing = readDraft();

  const [fullName, setFullName] = useState(existing.fullName ?? "");
  const [age, setAge] = useState(existing.age?.toString() ?? "");
  const [country, setCountry] = useState(existing.country ?? "");
  const [preferredLang, setPreferredLang] = useState<"ar" | "en">(existing.preferredLang ?? locale);

  // Student school info V1 (2026-09-25) — governorate/area/school, added
  // to this existing profile step rather than a new one. schoolId and
  // schoolNameManual are mutually exclusive; `manualEntry` tracks which
  // mode the UI is in ("My school isn't listed" toggles it), and switching
  // back to search always clears schoolNameManual (see toggleManualEntry).
  const [governorate, setGovernorate] = useState(existing.governorate ?? "");
  const [area, setArea] = useState(existing.area ?? "");
  const [schoolId, setSchoolId] = useState(existing.schoolId ?? "");
  const [schoolLabel, setSchoolLabel] = useState(""); // display-only, never persisted — the draft only stores schoolId
  const [schoolNameManual, setSchoolNameManual] = useState(existing.schoolNameManual ?? "");
  const [manualEntry, setManualEntry] = useState(!!existing.schoolNameManual && !existing.schoolId);

  function toggleManualEntry(next: boolean) {
    setManualEntry(next);
    if (next) {
      setSchoolId("");
      setSchoolLabel("");
    } else {
      setSchoolNameManual("");
    }
  }

  function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    writeDraft({
      fullName,
      age: Number(age),
      country,
      preferredLang,
      governorate: governorate || undefined,
      area: area.trim() || undefined,
      schoolId: manualEntry ? undefined : schoolId || undefined,
      schoolNameManual: manualEntry ? (schoolNameManual.trim() || undefined) : undefined,
    });
    router.push(`/${locale}/onboarding/curriculum`);
  }

  return (
    <>
      <OnboardingStepper steps={copy.steps} currentIndex={0} />
      <main className="py-16">
        <SmartifyContainer className="mx-auto max-w-lg">
          <h1 className="text-2xl font-bold text-navy-900">{copy.profile.title}</h1>
          <p className="mt-2 text-neutral-600">{copy.profile.body}</p>

          <form onSubmit={handleContinue} className="mt-8 space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.profile.fullNameLabel}</span>
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-sf border border-neutral-300 px-4 py-2"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.profile.ageLabel}</span>
              <input
                required
                type="number"
                min={4}
                max={25}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full rounded-sf border border-neutral-300 px-4 py-2"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.profile.countryLabel}</span>
              <input
                required
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-sf border border-neutral-300 px-4 py-2"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.profile.languageLabel}</span>
              <select
                value={preferredLang}
                onChange={(e) => setPreferredLang(e.target.value as "ar" | "en")}
                className="w-full rounded-sf border border-neutral-300 bg-white px-4 py-2"
              >
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.profile.governorateLabel}</span>
              <select
                value={governorate}
                onChange={(e) => {
                  setGovernorate(e.target.value);
                  // A school only ever belongs to one governorate — clear
                  // any prior selection/search rather than let a stale
                  // schoolId silently carry over to a new governorate.
                  setSchoolId("");
                  setSchoolLabel("");
                }}
                className="w-full rounded-sf border border-neutral-300 bg-white px-4 py-2"
              >
                <option value="">{isAr ? "اختر" : "Select"}</option>
                {EGYPT_GOVERNORATES.map((g) => (
                  <option key={g.code} value={g.code}>
                    {isAr ? g.nameAr : g.nameEn}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.profile.areaLabel}</span>
              <input
                value={area}
                onChange={(e) => setArea(e.target.value)}
                className="w-full rounded-sf border border-neutral-300 px-4 py-2"
              />
            </label>

            <div>
              <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.profile.schoolLabel}</span>
              {!manualEntry ? (
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
                  <button
                    type="button"
                    onClick={() => toggleManualEntry(true)}
                    className="mt-2 text-sm font-medium text-sf-blue-500 underline"
                  >
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
                  <button
                    type="button"
                    onClick={() => toggleManualEntry(false)}
                    className="mt-2 text-sm font-medium text-sf-blue-500 underline"
                  >
                    {copy.profile.schoolBackToSearchLabel}
                  </button>
                </>
              )}
            </div>

            <SmartifyButton type="submit" variant="ai" className="w-full">
              {copy.profile.continueLabel}
            </SmartifyButton>
          </form>
        </SmartifyContainer>
      </main>
    </>
  );
}
