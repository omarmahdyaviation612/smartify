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
