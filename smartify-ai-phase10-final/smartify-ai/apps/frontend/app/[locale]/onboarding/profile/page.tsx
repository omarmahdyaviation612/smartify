"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getOnboardingCopy } from "@/content/onboarding";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { readDraft, trackOnboardingStep, writeDraft } from "@/lib/onboarding-draft";
import { useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";

/**
 * Step 1 — kept to three quick fields (onboarding drop-off fix,
 * 2026-10-11). Country now defaults to Egypt and, like governorate / area /
 * school, is an optional section on the grade & subjects step, so a new
 * student reaches the curriculum choice in seconds.
 */
export default function OnboardingProfilePage() {
  const { locale } = useParams<{ locale: Locale }>();
  const copy = getOnboardingCopy(locale);
  const router = useRouter();
  const { apiFetch } = useApiClient();
  const existing = readDraft();

  const [fullName, setFullName] = useState(existing.fullName ?? "");
  const [age, setAge] = useState(existing.age?.toString() ?? "");
  const [preferredLang, setPreferredLang] = useState<"ar" | "en">(existing.preferredLang ?? locale);

  useEffect(() => {
    trackOnboardingStep(apiFetch, "profile");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    writeDraft({ fullName: fullName.trim(), age: Number(age), preferredLang });
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
                minLength={2}
                maxLength={100}
                autoComplete="name"
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
                inputMode="numeric"
                min={4}
                max={25}
                value={age}
                onChange={(e) => setAge(e.target.value)}
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

            <SmartifyButton type="submit" variant="ai" className="w-full">
              {copy.profile.continueLabel}
            </SmartifyButton>
          </form>
        </SmartifyContainer>
      </main>
    </>
  );
}
