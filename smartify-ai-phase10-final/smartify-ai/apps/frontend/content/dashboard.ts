import type { Locale } from "./marketing";

export interface DashboardCopy {
  loading: string;
  noProfile: string;
  goToOnboarding: string;
  greetingMorning: string;
  greetingAfternoon: string;
  greetingEvening: string;
  subtitle: string;
  comingSoon: string;
  sections: {
    focus: { title: string; empty: string };
    aiTutor: { title: string; body: string };
    streak: { title: string; body: string };
    weeklyTime: { title: string; body: string };
    subjectProgress: { title: string; note: string; empty: string };
    weakTopics: { title: string; empty: string };
    recentActivity: { title: string; empty: string; correct: string; incorrect: string };
    achievements: { title: string; body: string };
    upcomingExams: { title: string; body: string };
  };
}

const en: DashboardCopy = {
  loading: "Loading your dashboard...",
  noProfile: "You haven't completed onboarding yet.",
  goToOnboarding: "Start Onboarding",
  greetingMorning: "Good morning",
  greetingAfternoon: "Good afternoon",
  greetingEvening: "Good evening",
  subtitle: "Here's where things stand.",
  comingSoon: "Coming soon",
  sections: {
    focus: { title: "Recommended Focus", empty: "No recommendations yet — complete your diagnostic." },
    aiTutor: { title: "AI Tutor", body: "The AI Tutor chat is launching in a future phase." },
    streak: { title: "Streak", body: "Streak tracking isn't live yet." },
    weeklyTime: { title: "Weekly Study Time", body: "Study-time tracking isn't live yet." },
    subjectProgress: {
      title: "Subject Progress",
      note: "Based on your diagnostic score — lesson-based progress tracking arrives once lessons are available.",
      empty: "No diagnostic results yet.",
    },
    weakTopics: { title: "Topics to Review", empty: "No weak topics identified yet — this fills in as you answer more questions." },
    recentActivity: { title: "Recent Activity", empty: "No activity yet.", correct: "Correct", incorrect: "Incorrect" },
    achievements: { title: "Achievements", body: "Badges and milestones are coming in a future phase." },
    upcomingExams: { title: "Upcoming Exams", body: "Exam scheduling isn't live yet." },
  },
};

const ar: DashboardCopy = {
  loading: "جاري تحميل لوحة التحكم...",
  noProfile: "لم تكمل عملية التسجيل بعد.",
  goToOnboarding: "ابدأ التسجيل",
  greetingMorning: "صباح الخير",
  greetingAfternoon: "مساء الخير",
  greetingEvening: "مساء الخير",
  subtitle: "إليك وضعك الحالي.",
  comingSoon: "قريبًا",
  sections: {
    focus: { title: "التركيز الموصى به", empty: "لا توجد توصيات بعد — أكمل تقييمك التشخيصي." },
    aiTutor: { title: "المعلم الذكي", body: "محادثة المعلم الذكي ستُطلق في مرحلة لاحقة." },
    streak: { title: "سلسلة الإنجاز", body: "تتبع سلسلة الإنجاز غير مفعّل بعد." },
    weeklyTime: { title: "وقت الدراسة الأسبوعي", body: "تتبع وقت الدراسة غير مفعّل بعد." },
    subjectProgress: {
      title: "تقدم المواد",
      note: "مبني على نتيجة تقييمك التشخيصي — سيتوفر تتبع التقدم حسب الدروس عند توفر الدروس.",
      empty: "لا توجد نتائج تقييم بعد.",
    },
    weakTopics: { title: "مواضيع للمراجعة", empty: "لم يتم تحديد نقاط ضعف بعد — ستظهر هنا مع إجابتك على المزيد من الأسئلة." },
    recentActivity: { title: "النشاط الأخير", empty: "لا يوجد نشاط بعد.", correct: "إجابة صحيحة", incorrect: "إجابة خاطئة" },
    achievements: { title: "الإنجازات", body: "الشارات والإنجازات قادمة في مرحلة لاحقة." },
    upcomingExams: { title: "الاختبارات القادمة", body: "جدولة الاختبارات غير مفعّلة بعد." },
  },
};

const copyByLocale: Record<Locale, DashboardCopy> = { en, ar };
export function getDashboardCopy(locale: Locale): DashboardCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
