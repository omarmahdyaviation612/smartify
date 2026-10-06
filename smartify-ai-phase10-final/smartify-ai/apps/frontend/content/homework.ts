import type { Locale } from "./marketing";
export const homeworkCopy = (locale: Locale) => locale === "ar" ? {
  title: "مساعد حل الواجب", subtitle: "صوّر سؤالًا واحدًا، وسأرشدك خطوة بخطوة من منهجك.", locked: "الميزة متاحة بإضافة مساعد الواجب على اشتراكك.",
  upgrade: "إدارة الاشتراك", subject: "المادة", photo: "صورة الواجب", privacy: "نحذف الصورة بعد قراءتها ونحتفظ بنص السؤال لمتابعتك لاحقًا.",
  upload: "قراءة السؤال", topic: "اختر الموضوع الأقرب لسؤالك من منهجك:", confirm: "ابدأ بهذا الموضوع", help: "ساعدني بتلميح", answer: "إجابتي", send: "تحقق من إجابتي",
  reveal: "اكشف الحل الكامل", remaining: "أسئلة الواجب المتبقية هذا الشهر", unsupported: "لم نتمكن من قراءة سؤال واحد أو ربطه بموضوع متاح في منهجك. جرّب صورة أوضح.",
  resume: "جلسات سابقة", newSession: "سؤال جديد", loading: "جاري التحميل...", noSubjects: "لا توجد مواد مشمولة باشتراكك.", error: "تعذر إكمال الطلب. حاول مرة أخرى.", solved: "أحسنت! يمكنك الرجوع لهذه الجلسة لاحقًا.", attempts: "محاولات الإجابة غير الصحيحة",
} : {
  title: "Homework Helper", subtitle: "Photograph one question and I’ll guide you through it using your curriculum.", locked: "Homework Helper is available as an add-on to your subscription.",
  upgrade: "Manage subscription", subject: "Subject", photo: "Homework photo", privacy: "We delete the photo after reading it and keep only the question text so you can resume later.",
  upload: "Read question", topic: "Choose the closest matching topic from your curriculum:", confirm: "Start with this topic", help: "Give me a hint", answer: "My answer", send: "Check my answer",
  reveal: "Show the full solution", remaining: "Homework questions left this month", unsupported: "We couldn't read one question or match it to an available topic in your curriculum. Try a clearer photo.",
  resume: "Previous sessions", newSession: "New question", loading: "Loading...", noSubjects: "No subjects are included in your subscription.", error: "We couldn't complete that request. Please try again.", solved: "Great work! You can return to this session later.", attempts: "Incorrect answer attempts",
};
