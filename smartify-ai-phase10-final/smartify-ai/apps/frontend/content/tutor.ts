import type { Locale } from "./marketing";

export interface TutorCopy {
  title: string;
  subjectLabel: string;
  aiGeneratedBadge: string;
  inputPlaceholder: string;
  sendLabel: string;
  remainingToday: (dailyRemaining: number, extraRemaining: number) => string;
  buyPack: string;
  buyingPack: string;
  limitReached: string;
  notConfigured: string;
  genericError: string;
  emptyState: string;
  noSubjects: string;
}

const en: TutorCopy = {
  title: "AI Tutor",
  subjectLabel: "Subject",
  aiGeneratedBadge: "AI-generated",
  inputPlaceholder: "Ask about your current topic...",
  sendLabel: "Send",
  remainingToday: (daily, extra) => `${daily} daily + ${extra} extra questions left for this subject`,
  buyPack: "Buy 10 extra questions - 50 EGP",
  buyingPack: "Opening payment...",
  limitReached: "You've used all questions for this subject.",
  notConfigured: "The AI Tutor isn't fully configured yet on this environment. Please try again later.",
  genericError: "Something went wrong. Please try again.",
  emptyState: "Ask a question about your current lesson to get started.",
  noSubjects: "You haven't selected any subjects yet — complete onboarding first.",
};

const ar: TutorCopy = {
  title: "المعلم الذكي",
  subjectLabel: "المادة",
  aiGeneratedBadge: "محتوى مولّد بالذكاء الاصطناعي",
  inputPlaceholder: "اسأل عن موضوعك الحالي...",
  sendLabel: "إرسال",
  remainingToday: (daily, extra) => `${daily} يومية + ${extra} إضافية متبقية لهذه المادة`,
  buyPack: "شراء 10 أسئلة إضافية - 50 جنيه",
  buyingPack: "جاري فتح الدفع...",
  limitReached: "لقد استخدمت كل الأسئلة المتاحة لهذه المادة.",
  notConfigured: "المعلم الذكي غير مُفعّل بالكامل في هذه البيئة حاليًا. حاول مرة أخرى لاحقًا.",
  genericError: "حدث خطأ ما. حاول مرة أخرى.",
  emptyState: "اطرح سؤالًا عن درسك الحالي للبدء.",
  noSubjects: "لم تختر أي مواد بعد — أكمل التسجيل أولًا.",
};

const copyByLocale: Record<Locale, TutorCopy> = { en, ar };
export function getTutorCopy(locale: Locale): TutorCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
