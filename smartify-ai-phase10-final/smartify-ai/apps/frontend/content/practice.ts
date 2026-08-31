import type { Locale } from "./marketing";

export interface PracticeCopy {
  title: string;
  subjectLabel: string;
  topicLabel: string;
  allTopics: string;
  startLabel: string;
  submitLabel: string;
  loading: string;
  noSubjects: string;
  resultsTitle: string;
  correctLabel: string;
  incorrectLabel: string;
  correctAnswer: string;
  explanationLabel: string;
  practiceAgain: string;
  accuracyBadge: (percent: number) => string;
  newTopicBadge: string;
}

const en: PracticeCopy = {
  title: "Practice",
  subjectLabel: "Subject",
  topicLabel: "Topic",
  allTopics: "All topics",
  startLabel: "Start Practice",
  submitLabel: "Submit Answers",
  loading: "Loading questions...",
  noSubjects: "You haven't selected any subjects yet — complete onboarding first.",
  resultsTitle: "Results",
  correctLabel: "Correct",
  incorrectLabel: "Incorrect",
  correctAnswer: "Correct answer",
  explanationLabel: "Explanation",
  practiceAgain: "Practice Again",
  accuracyBadge: (percent) => `${percent}% accuracy so far`,
  newTopicBadge: "Not attempted yet",
};

const ar: PracticeCopy = {
  title: "التدريب",
  subjectLabel: "المادة",
  topicLabel: "الموضوع",
  allTopics: "كل المواضيع",
  startLabel: "ابدأ التدريب",
  submitLabel: "إرسال الإجابات",
  loading: "جاري تحميل الأسئلة...",
  noSubjects: "لم تختر أي مواد بعد — أكمل التسجيل أولًا.",
  resultsTitle: "النتائج",
  correctLabel: "إجابة صحيحة",
  incorrectLabel: "إجابة خاطئة",
  correctAnswer: "الإجابة الصحيحة",
  explanationLabel: "الشرح",
  practiceAgain: "تدرّب مرة أخرى",
  accuracyBadge: (percent) => `دقة ${percent}% حتى الآن`,
  newTopicBadge: "لم تتم تجربته بعد",
};

const copyByLocale: Record<Locale, PracticeCopy> = { en, ar };
export function getPracticeCopy(locale: Locale): PracticeCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
