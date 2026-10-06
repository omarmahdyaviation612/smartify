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
  if (!draft.fullName?.trim() || !draft.country?.trim() || !Number.isInteger(draft.age) || draft.age! < 4 || draft.age! > 25) {
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
