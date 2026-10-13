"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getOnboardingCopy } from "@/content/onboarding";
import { OnboardingStepper } from "@/components/OnboardingStepper";
import { readDraft, trackOnboardingStep, writeDraft } from "@/lib/onboarding-draft";
import { ApiError, useApiClient } from "@/lib/api-client";
import { displayPhone, normalizePhoneNumber } from "@/lib/phone";
import type { Locale } from "@/content/marketing";

/**
 * Step 1 — kept to a few quick fields (onboarding drop-off fix,
 * 2026-10-11). The parent's mobile (2026-10-13) is required and saved
 * right away, so the team can follow up even if the student stops here. Country now defaults to Egypt and, like governorate / area /
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
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    trackOnboardingStep(apiFetch, "profile");
    // Pre-fill a number saved earlier (e.g. coming back from a later step).
    apiFetch<{ phone?: string | null }>("/users/me")
      .then((me) => { if (me?.phone) setPhone((current) => current || displayPhone(me.phone)); })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!normalizePhoneNumber(phone)) {
      setPhoneError(copy.profile.phoneInvalid);
      return;
    }
    setSaving(true);
    setPhoneError(null);
    try {
      await apiFetch("/users/me/phone", { method: "PUT", body: JSON.stringify({ phone: phone.trim() }) });
    } catch (err) {
      setPhoneError(err instanceof ApiError && err.status === 400 ? copy.profile.phoneInvalid : copy.profile.phoneSaveFailed);
      setSaving(false);
      return;
    }
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

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.profile.phoneLabel}</span>
              <input
                required
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                placeholder="01012345678"
                maxLength={25}
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setPhoneError(null); }}
                aria-invalid={!!phoneError}
                aria-describedby="phone-hint"
                className={`w-full rounded-sf border px-4 py-2 text-start ${phoneError ? "border-error-500" : "border-neutral-300"}`}
              />
              {phoneError
                ? <span role="alert" className="mt-1 block text-sm text-error-500">{phoneError}</span>
                : <span id="phone-hint" className="mt-1 block text-xs text-neutral-500">{copy.profile.phoneHint}</span>}
            </label>

            <SmartifyButton type="submit" variant="ai" className="w-full" disabled={saving}>
              {copy.profile.continueLabel}
            </SmartifyButton>
          </form>
        </SmartifyContainer>
      </main>
    </>
  );
}
