import type { Locale } from "./marketing";

export interface OnboardingCopy {
  steps: string[]; // labels for the 5-step progress indicator
  profile: {
    title: string;
    body: string;
    fullNameLabel: string;
    ageLabel: string;
    countryLabel: string;
    languageLabel: string;
    continueLabel: string;
    // Student school info V1 (2026-09-25)
    governorateLabel: string;
    areaLabel: string;
    schoolLabel: string;
    schoolSearchPlaceholder: string;
    schoolNotListedLabel: string;
    schoolManualLabel: string;
    schoolBackToSearchLabel: string;
    schoolNoResults: string;
    /** Collapsible optional section on the grade & subjects step. */
    schoolSectionLabel: string;
  };
  curriculum: {
    title: string;
    body: string;
    continueLabel: string;
    backLabel: string;
    loadError: string;
  };
  gradeSubjects: {
    title: string;
    body: string;
    gradeLabel: string;
    subjectsLabel: string;
    studyHoursLabel: string;
    goalsLabel: string;
    submitLabel: string;
    backLabel: string;
    submitError: string;
  };
  diagnostic: {
    title: string;
    body: string;
    submitLabel: string;
    loading: string;
    noQuestions: string;
    noQuestionsContinueLabel: string;
    error: string;
    /** Shown under the submit button while some questions are unanswered. */
    unansweredHint: (count: number) => string;
    submittingLabel: string;
  };
  planReady: {
    title: string;
    body: string;
    scoreTitle: string;
    planTitle: string;
    planNote: string;
    dashboardComingSoon: string;
    backHome: string;
  };
}

const en: OnboardingCopy = {
  steps: ["Profile", "Curriculum", "Grade & Subjects", "Diagnostic", "Your Plan"],
  profile: {
    title: "Let's set up your profile",
    body: "Just three quick details — it takes less than a minute.",
    fullNameLabel: "Full name",
    ageLabel: "Age",
    countryLabel: "Country",
    languageLabel: "Preferred language",
    continueLabel: "Continue",
    governorateLabel: "Governorate",
    areaLabel: "Area / District",
    schoolLabel: "School",
    schoolSearchPlaceholder: "Search for your school",
    schoolNotListedLabel: "My school isn't listed",
    schoolManualLabel: "Enter your school name",
    schoolBackToSearchLabel: "Search for my school instead",
    schoolNoResults: "No matching schools found. Try a different search, or enter it manually.",
    schoolSectionLabel: "School & location (optional)",
  },
  curriculum: {
    title: "Choose your curriculum",
    body: "Pick the system the student actually studies — this drives grades, subjects, and pricing.",
    continueLabel: "Continue",
    backLabel: "Back",
    loadError: "Couldn't load curricula. Please try again.",
  },
  gradeSubjects: {
    title: "Grade & subjects",
    body: "Select the grade, then the subjects to focus on.",
    gradeLabel: "Grade",
    subjectsLabel: "Subjects",
    studyHoursLabel: "Weekly study hours (optional)",
    goalsLabel: "Academic goals (optional)",
    submitLabel: "Save & Continue",
    backLabel: "Back",
    submitError: "Couldn't save your profile. Please check your selections and try again.",
  },
  diagnostic: {
    title: "Quick diagnostic",
    body: "A short set of questions across your selected subjects, so we know where to start.",
    submitLabel: "Submit Answers",
    loading: "Loading questions...",
    noQuestions: "Your diagnostic assessment isn't available yet for these subjects. You can continue and start learning now.",
    noQuestionsContinueLabel: "Continue",
    error: "Something went wrong loading the diagnostic. Please try again.",
    unansweredHint: (count) =>
      count === 1 ? "1 question is still unanswered." : `${count} questions are still unanswered.`,
    submittingLabel: "Submitting...",
  },
  planReady: {
    title: "Your learning profile is ready",
    body: "Here's where you're starting from.",
    scoreTitle: "Diagnostic results",
    planTitle: "Initial focus areas",
    planNote: "This is a rule-based starting plan from your diagnostic score — a fully AI-personalized plan is coming in a later phase.",
    dashboardComingSoon: "Your dashboard is ready — some sections (like streaks and achievements) are still being built.",
    backHome: "Go to Dashboard",
  },
};

const ar: OnboardingCopy = {
  steps: ["الملف الشخصي", "المنهج", "الصف والمواد", "التقييم", "خطتك"],
  profile: {
    title: "لنجهز ملفك الشخصي",
    body: "ثلاث معلومات سريعة فقط — أقل من دقيقة.",
    fullNameLabel: "الاسم الكامل",
    ageLabel: "العمر",
    countryLabel: "الدولة",
    languageLabel: "اللغة المفضلة",
    continueLabel: "متابعة",
    governorateLabel: "المحافظة",
    areaLabel: "المنطقة / الإدارة التعليمية",
    schoolLabel: "المدرسة",
    schoolSearchPlaceholder: "ابحث عن مدرستك",
    schoolNotListedLabel: "مدرستي غير موجودة",
    schoolManualLabel: "اكتب اسم مدرستك",
    schoolBackToSearchLabel: "البحث عن مدرستي بدلاً من ذلك",
    schoolNoResults: "لم يتم العثور على مدارس مطابقة. جرّب بحثًا مختلفًا أو أدخل الاسم يدويًا.",
    schoolSectionLabel: "المدرسة ومكان السكن (اختياري)",
  },
  curriculum: {
    title: "اختر منهجك الدراسي",
    body: "اختر النظام الذي يدرسه الطالب فعليًا — هذا يحدد الصفوف والمواد والأسعار.",
    continueLabel: "متابعة",
    backLabel: "رجوع",
    loadError: "تعذر تحميل المناهج. حاول مرة أخرى.",
  },
  gradeSubjects: {
    title: "الصف والمواد",
    body: "اختر الصف، ثم المواد التي تريد التركيز عليها.",
    gradeLabel: "الصف",
    subjectsLabel: "المواد",
    studyHoursLabel: "ساعات الدراسة الأسبوعية (اختياري)",
    goalsLabel: "الأهداف الدراسية (اختياري)",
    submitLabel: "حفظ ومتابعة",
    backLabel: "رجوع",
    submitError: "تعذر حفظ ملفك الشخصي. تحقق من اختياراتك وحاول مرة أخرى.",
  },
  diagnostic: {
    title: "تقييم سريع",
    body: "مجموعة قصيرة من الأسئلة عبر المواد التي اخترتها، حتى نعرف من أين نبدأ.",
    submitLabel: "إرسال الإجابات",
    loading: "جاري تحميل الأسئلة...",
    noQuestions: "التقييم التشخيصي لسه مش متاح للمواد دي. تقدر تكمل وتبدأ التعلّم دلوقتي.",
    noQuestionsContinueLabel: "متابعة",
    error: "حدث خطأ أثناء تحميل التقييم. حاول مرة أخرى.",
    unansweredHint: (count) =>
      count === 1 ? "باقي سؤال واحد بدون إجابة." : `باقي ${count} أسئلة بدون إجابة.`,
    submittingLabel: "جاري الإرسال...",
  },
  planReady: {
    title: "ملفك التعليمي جاهز",
    body: "هذه نقطة بدايتك.",
    scoreTitle: "نتائج التقييم",
    planTitle: "مجالات التركيز الأولية",
    planNote: "هذه خطة بداية مبنية على قواعد بسيطة من نتيجة تقييمك — خطة مخصصة بالكامل بالذكاء الاصطناعي قادمة في مرحلة لاحقة.",
    dashboardComingSoon: "لوحة تحكمك جاهزة — بعض الأقسام (مثل سلسلة الإنجاز والشارات) ما زالت قيد التطوير.",
    backHome: "الذهاب للوحة التحكم",
  },
};

const copyByLocale: Record<Locale, OnboardingCopy> = { en, ar };
export function getOnboardingCopy(locale: Locale): OnboardingCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
