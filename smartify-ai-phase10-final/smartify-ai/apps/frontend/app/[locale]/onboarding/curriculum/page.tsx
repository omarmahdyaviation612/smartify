"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getOnboardingCopy } from "@/content/onboarding";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { getOnboardingPrerequisite, readDraft, writeDraft } from "@/lib/onboarding-draft";
import { API_URL } from "@/lib/api";
import type { Locale } from "@/content/marketing";
import type { CurriculumCatalogEntry } from "@/components/CurriculumExplorer";

export default function OnboardingCurriculumPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const copy = getOnboardingCopy(locale);
  const router = useRouter();
  const existing = readDraft();

  const [catalog, setCatalog] = useState<CurriculumCatalogEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState(existing.curriculumId ?? "");

  useEffect(() => {
    const previousStep = getOnboardingPrerequisite(readDraft(), "curriculum");
    if (previousStep) {
      router.replace(`/${locale}/onboarding/${previousStep}`);
      return;
    }
    fetch(`${API_URL}/curricula`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: CurriculumCatalogEntry[]) => {
        setCatalog(data);
        if (!selectedId && data[0]) setSelectedId(data[0].id);
      })
      .catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleContinue() {
    const chosen = catalog?.find((c) => c.id === selectedId);
    if (!chosen) return;
    writeDraft({ curriculumId: chosen.id, curriculumCode: chosen.code, gradeId: undefined, subjectIds: undefined });
    router.push(`/${locale}/onboarding/grade-subjects`);
  }

  return (
    <>
      <OnboardingStepper steps={copy.steps} currentIndex={1} />
      <main className="py-16">
        <SmartifyContainer className="mx-auto max-w-xl">
          <h1 className="text-2xl font-bold text-navy-900">{copy.curriculum.title}</h1>
          <p className="mt-2 text-neutral-600">{copy.curriculum.body}</p>

          {error && <p className="mt-6 text-sm text-error-500">{copy.curriculum.loadError}</p>}

          {catalog && (
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {catalog.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`rounded-sf-lg border p-5 text-start transition-colors ${
                    selectedId === c.id ? "border-sf-blue-500 bg-[--sf-bg-subtle]" : "border-neutral-200 bg-white hover:border-neutral-300"
                  }`}
                >
                  <span className="font-semibold text-navy-900">{isAr ? c.nameAr : c.nameEn}</span>
                  <p className="mt-1 text-sm text-neutral-500">
                    {isAr ? `${c.grades.length} صف متاح` : `${c.grades.length} grade(s) available`}
                  </p>
                </button>
              ))}
            </div>
          )}

          <div className="mt-8 flex justify-between">
            <SmartifyButton variant="ghost" onClick={() => router.push(`/${locale}/onboarding/profile`)}>
              {copy.curriculum.backLabel}
            </SmartifyButton>
            <SmartifyButton variant="ai" disabled={!selectedId} onClick={handleContinue}>
              {copy.curriculum.continueLabel}
            </SmartifyButton>
          </div>
        </SmartifyContainer>
      </main>
    </>
  );
}
