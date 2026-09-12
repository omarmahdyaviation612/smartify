import type { Locale } from "./marketing";

const messages = {
  en: {
    topicsUnavailable: "Curriculum topics are not yet available for this subject. Choose another subject or check again later.",
    questionsUnavailable: "Questions are not yet available for this selection. Choose another topic or check again later.",
    loadError: "We could not load the learning content. Please try again.",
    submitError: "We could not save your answers. Your answers are still here; please try again.",
    noSubjects: "No subjects are selected. Complete your profile to choose your curriculum and subjects.",
    retry: "Try again", dashboard: "Back to dashboard", onboarding: "Complete profile", loading: "Loading learning content...",
  },
  ar: {
    topicsUnavailable: "موضوعات المنهج غير متاحة بعد لهذه المادة. اختر مادة أخرى أو تحقق مرة أخرى لاحقًا.",
    questionsUnavailable: "الأسئلة غير متاحة بعد لهذا الاختيار. اختر موضوعًا آخر أو تحقق مرة أخرى لاحقًا.",
    loadError: "تعذر تحميل المحتوى التعليمي. يرجى المحاولة مرة أخرى.",
    submitError: "تعذر حفظ إجاباتك. إجاباتك ما زالت موجودة؛ يرجى المحاولة مرة أخرى.",
    noSubjects: "لم يتم اختيار مواد. أكمل ملفك الشخصي لاختيار المنهج والمواد.",
    retry: "إعادة المحاولة", dashboard: "العودة للوحة التحكم", onboarding: "إكمال الملف الشخصي", loading: "جاري تحميل المحتوى التعليمي...",
  },
};
export function getLearningFeedback(locale: Locale) { return messages[locale] ?? messages.ar; }
