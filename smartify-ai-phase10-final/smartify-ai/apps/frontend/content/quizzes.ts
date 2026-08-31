import type { Locale } from "./marketing";

export interface QuizzesCopy {
  title: string;
  subjectLabel: string;
  typeLabel: string;
  topicAssessment: string;
  mockExam: string;
  topicLabel: string;
  startLabel: string;
  submitLabel: string;
  loading: string;
  noSubjects: string;
  scoreLabel: string;
  weakTopicsTitle: string;
  weakTopicsEmpty: string;
  nextStepsTitle: string;
  yourAnswer: string;
  correctAnswer: string;
  explanationLabel: string;
  takeAnother: string;
}

const en: QuizzesCopy = {
  title: "Quizzes & Exams",
  subjectLabel: "Subject",
  typeLabel: "Type",
  topicAssessment: "Topic Assessment",
  mockExam: "Mock Exam",
  topicLabel: "Topic",
  startLabel: "Start Quiz",
  submitLabel: "Submit Quiz",
  loading: "Loading questions...",
  noSubjects: "You haven't selected any subjects yet — complete onboarding first.",
  scoreLabel: "Score",
  weakTopicsTitle: "Weak Topics on This Quiz",
  weakTopicsEmpty: "No weak topics identified on this quiz — nice work.",
  nextStepsTitle: "Recommended Next Steps",
  yourAnswer: "Your answer",
  correctAnswer: "Correct answer",
  explanationLabel: "Explanation",
  takeAnother: "Take Another Quiz",
};

const ar: QuizzesCopy = {
  title: "الاختبارات والامتحانات",
  subjectLabel: "المادة",
  typeLabel: "النوع",
  topicAssessment: "تقييم موضوع",
  mockExam: "اختبار تجريبي",
  topicLabel: "الموضوع",
  startLabel: "ابدأ الاختبار",
  submitLabel: "إرسال الاختبار",
  loading: "جاري تحميل الأسئلة...",
  noSubjects: "لم تختر أي مواد بعد — أكمل التسجيل أولًا.",
  scoreLabel: "النتيجة",
  weakTopicsTitle: "نقاط الضعف في هذا الاختبار",
  weakTopicsEmpty: "لم يتم تحديد نقاط ضعف في هذا الاختبار — أداء رائع.",
  nextStepsTitle: "الخطوات التالية الموصى بها",
  yourAnswer: "إجابتك",
  correctAnswer: "الإجابة الصحيحة",
  explanationLabel: "الشرح",
  takeAnother: "خذ اختبارًا آخر",
};

const copyByLocale: Record<Locale, QuizzesCopy> = { en, ar };
export function getQuizzesCopy(locale: Locale): QuizzesCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
