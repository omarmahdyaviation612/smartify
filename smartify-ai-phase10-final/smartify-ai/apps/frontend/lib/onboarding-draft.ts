"use client";

// Lightweight client-side draft for the multi-page onboarding wizard.
// Intentionally NOT sent to the backend until the grade-subjects step
// (the point where a single, atomic StudentProfile write makes sense) —
// see apps/backend/src/onboarding/onboarding.service.ts.

export interface OnboardingDraft {
  fullName?: string;
  age?: number;
  country?: string;
  preferredLang?: "ar" | "en";
  curriculumCode?: string;
  curriculumId?: string;
  gradeId?: string;
  subjectIds?: string[];
  weeklyStudyHours?: number;
  goals?: string;
  // Student school info V1 (2026-09-25) — collected on the profile step
  // like the fields above, carried through the draft the same way, and
  // sent in the same single POST /onboarding/profile the rest of the
  // draft already goes out in (see grade-subjects/page.tsx). schoolId and
  // schoolNameManual are mutually exclusive; the UI enforces this by
  // clearing one whenever the other is set — see profile/page.tsx.
  governorate?: string;
  area?: string;
  schoolId?: string;
  schoolNameManual?: string;
}

const KEY = "sf_onboarding_draft";

export function getOnboardingPrerequisite(
  draft: OnboardingDraft,
  step: "curriculum" | "grade-subjects",
): "profile" | "curriculum" | null {
  // Country is no longer asked on step 1 (defaults to Egypt, editable on
  // the grade & subjects step) — only name and age gate the next steps.
  if (!draft.fullName?.trim() || !Number.isInteger(draft.age) || draft.age! < 4 || draft.age! > 25) {
    return "profile";
  }
  if (step === "grade-subjects" && (!draft.curriculumId || !draft.curriculumCode)) {
    return "curriculum";
  }
  return null;
}

export function readDraft(): OnboardingDraft {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function writeDraft(patch: Partial<OnboardingDraft>) {
  const next = { ...readDraft(), ...patch };
  window.localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearDraft() {
  window.localStorage.removeItem(KEY);
}

export const DEFAULT_COUNTRY = "Egypt";

// ---------------------------------------------------------------------------
// Onboarding drop-off fixes (2026-10-11)
// ---------------------------------------------------------------------------

const NEXT_KEY = "sf_onboarding_next";

/**
 * Only same-site, locale-relative app paths ("/free-trial", "/billing")
 * are accepted as a post-onboarding destination — never a full URL or a
 * protocol-relative "//host" that would turn this into an open redirect.
 */
export function sanitizeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes(":")) return null;
  if (value.length > 200) return null;
  return value;
}

/** Remember where the student was heading (free trial, billing...) before onboarding. */
export function rememberOnboardingNext(next: string | null | undefined) {
  const safe = sanitizeNextPath(next);
  if (!safe || safe.startsWith("/onboarding") || safe === "/welcome") return;
  try {
    window.localStorage.setItem(NEXT_KEY, safe);
  } catch {
    // storage disabled — the student simply lands on the dashboard
  }
}

/** Read and clear the remembered destination. */
export function takeOnboardingNext(): string | null {
  try {
    const value = sanitizeNextPath(window.localStorage.getItem(NEXT_KEY));
    window.localStorage.removeItem(NEXT_KEY);
    return value;
  } catch {
    return null;
  }
}

export type OnboardingTrackedStep = "welcome" | "profile" | "curriculum" | "grade-subjects" | "diagnostic" | "plan-ready";

/**
 * Fire-and-forget: tells the backend this account opened an onboarding
 * step, so the admin funnel shows exactly where students stop. Sent once
 * per step per browser session; failures are ignored.
 */
export function trackOnboardingStep(
  apiFetch: (path: string, init?: RequestInit) => Promise<unknown>,
  step: OnboardingTrackedStep,
) {
  if (typeof window === "undefined") return;
  const key = `sf_onboarding_tracked_${step}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
  } catch {
    // ignore — tracking still fires, the backend de-duplicates anyway
  }
  apiFetch("/onboarding/progress", { method: "POST", body: JSON.stringify({ step }) }).catch(() => undefined);
}
