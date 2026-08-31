import type { Locale } from "./marketing";

export interface CurriculaPageCopy {
  hero: { title: string; body: string };
  systemsIntro: { title: string; body: string };
  structure: {
    title: string;
    body: string;
    levels: string[]; // Grade > Subject > Unit > Topic > Lesson, labeled
    sampleTitle: string;
    sampleUnavailable: string;
  };
  discovery: {
    title: string;
    body: string;
    selectCurriculumLabel: string;
    selectGradeLabel: string;
    subjectsLabel: string;
    noGrades: string;
  };
  cta: { title: string; body: string; buttonLabel: string };
}

const en: CurriculaPageCopy = {
  hero: {
    title: "Curricula on Smartify AI",
    body: "Every lesson, question, and explanation is tied to a specific curriculum, grade, subject, and topic — never generic content pulled from nowhere.",
  },
  systemsIntro: {
    title: "Four Educational Systems",
    body: "Smartify AI supports the systems Egyptian families actually study. Pricing, grade structure, and subjects differ across systems — British and American curricula are tracked separately, even where they currently overlap.",
  },
  structure: {
    title: "How Curriculum Content Is Structured",
    body: "Every curriculum breaks down the same way, so the AI tutor always knows exactly where a student is:",
    levels: ["Grade", "Subject", "Unit", "Topic", "Lesson"],
    sampleTitle: "A real example from our current (placeholder) content",
    sampleUnavailable: "No sample content is available for this curriculum yet.",
  },
  discovery: {
    title: "Explore Grades & Subjects",
    body: "Pick a curriculum and grade to see which subjects are available.",
    selectCurriculumLabel: "Curriculum",
    selectGradeLabel: "Grade",
    subjectsLabel: "Subjects",
    noGrades: "No grades published for this curriculum yet.",
  },
  cta: {
    title: "Ready to find your student's path?",
    body: "Create an account and we'll walk you through choosing a curriculum, grade, and subjects in a few minutes.",
    buttonLabel: "Start Onboarding",
  },
};

const ar: CurriculaPageCopy = {
  hero: {
    title: "المناهج الدراسية في سمارتيفاي AI",
    body: "كل درس وسؤال وشرح مرتبط بمنهج وصف ومادة وموضوع محدد — وليس محتوى عامًا من مصدر غير معروف.",
  },
  systemsIntro: {
    title: "أربعة أنظمة تعليمية",
    body: "تدعم سمارتيفاي AI الأنظمة التي تدرسها العائلات المصرية فعليًا. تختلف الأسعار وهيكل الصفوف والمواد بين الأنظمة — يتم تتبع المنهجين البريطاني والأمريكي بشكل منفصل، حتى في حال تطابقهما حاليًا.",
  },
  structure: {
    title: "كيف يُبنى محتوى المنهج",
    body: "يُبنى كل منهج بنفس الطريقة، حتى يعرف المعلم الذكي دائمًا موقع الطالب بدقة:",
    levels: ["الصف", "المادة", "الوحدة", "الموضوع", "الدرس"],
    sampleTitle: "مثال حقيقي من محتوانا الحالي (نموذجي)",
    sampleUnavailable: "لا يوجد محتوى نموذجي متاح لهذا المنهج حتى الآن.",
  },
  discovery: {
    title: "استكشف الصفوف والمواد",
    body: "اختر منهجًا وصفًا لمعرفة المواد المتاحة.",
    selectCurriculumLabel: "المنهج",
    selectGradeLabel: "الصف",
    subjectsLabel: "المواد",
    noGrades: "لا توجد صفوف منشورة لهذا المنهج حتى الآن.",
  },
  cta: {
    title: "جاهز لتحديد مسار طالبك؟",
    body: "أنشئ حسابًا وسنساعدك على اختيار المنهج والصف والمواد خلال دقائق.",
    buttonLabel: "ابدأ التسجيل",
  },
};

const copyByLocale: Record<Locale, CurriculaPageCopy> = { en, ar };
export function getCurriculaPageCopy(locale: Locale): CurriculaPageCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
