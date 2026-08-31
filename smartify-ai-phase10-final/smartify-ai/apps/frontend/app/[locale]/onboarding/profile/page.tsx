"use client";

import { useRouter, useParams } from "next/navigation";
import { useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getOnboardingCopy } from "@/content/onboarding";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { readDraft, writeDraft } from "@/lib/onboarding-draft";
import type { Locale } from "@/content/marketing";

export default function OnboardingProfilePage() {
  const { locale } = useParams<{ locale: Locale }>();
  const copy = getOnboardingCopy(locale);
  const router = useRouter();
  const existing = readDraft();

  const [fullName, setFullName] = useState(existing.fullName ?? "");
  const [age, setAge] = useState(existing.age?.toString() ?? "");
  const [country, setCountry] = useState(existing.country ?? "");
  const [preferredLang, setPreferredLang] = useState<"ar" | "en">(existing.preferredLang ?? locale);

  function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    writeDraft({ fullName, age: Number(age), country, preferredLang });
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

            <SmartifyButton type="submit" variant="ai" className="w-full">
              {copy.profile.continueLabel}
            </SmartifyButton>
          </form>
        </SmartifyContainer>
      </main>
    </>
  );
}
