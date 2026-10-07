import type { Locale } from "./marketing";

export type FeatureStatus = "available" | "planned";

export interface ParentFeature {
  title: string;
  description: string;
  status: FeatureStatus;
}

export interface ForParentsCopy {
  hero: { title: string; body: string };
  statusLegend: { available: string; planned: string };
  features: ParentFeature[];
  cta: { title: string; body: string; buttonLabel: string; disclaimer: string };
}

// IMPORTANT: `status` reflects what's actually implemented as of Phase 3/4,
// not aspirational marketing. Update this list as each capability ships —
// this file is the single place that decides what's shown as "available".
const en: ForParentsCopy = {
  hero: {
    title: "Built for Parents, Too",
    body: "Smartify AI is designed around families, not just individual students — one account can support every child, with visibility into how each one is actually doing.",
  },
  statusLegend: { available: "Available now", planned: "Planned" },
  features: [
    {
      title: "One account, multiple children",
      description: "Link multiple student accounts to one parent dashboard and view each child's information separately.",
      status: "available",
    },
    {
      title: "Student progress visibility",
      description: "See completed lessons, recorded quiz and exam scores, recent answer accuracy, and topics suggested for review.",
      status: "available",
    },
    {
      title: "Subject & curriculum tracking",
      description: "See which curriculum, grade, and subjects each child is enrolled in.",
      status: "available",
    },
    {
      title: "AI usage visibility",
      description: "See today's remaining AI tutor questions for each enrolled subject.",
      status: "available",
    },
    {
      title: "Daily question limits",
      description: "Every subject includes a daily allowance of AI questions, configurable by our team — visible to you so there are no surprises.",
      status: "available",
    },
    {
      title: "Weak areas & recommended review",
      description: "A clear view of the topics each child is struggling with, and what we recommend reviewing next.",
      status: "available",
    },
    {
      title: "Manual payments for children",
      description: "Initiate a subject subscription for a linked child, upload the receipt, and track its administrator review status.",
      status: "available",
    },
    {
      title: "Teacher session booking",
      description: "Send a teacher session request for a linked child. The team reviews it and confirms availability separately.",
      status: "available",
    },
    {
      title: "Quiz and practice result alerts",
      description: "Receive the child's name, score, subject, and completion time by email; verified WhatsApp delivery is available when configured.",
      status: "available",
    },
  ],
  cta: {
    title: "See your children's learning in one place",
    body: "Create a parent account and open the invitation links sent by your children to connect their accounts.",
    buttonLabel: "Create an Account",
    disclaimer: "Payments are reviewed manually. A submitted receipt does not activate a service until an administrator approves it.",
  },
};

const ar: ForParentsCopy = {
  hero: {
    title: "مصمم لأولياء الأمور أيضًا",
    body: "سمارتيفاي AI مصمم حول العائلة بأكملها وليس فقط الطالب الفرد — حساب واحد مصمم ليدعم كل أبنائك، مع رؤية واضحة لأداء كل منهم فعليًا.",
  },
  statusLegend: { available: "متاح الآن", planned: "قيد التطوير" },
  features: [
    {
      title: "حساب واحد لعدة أبناء",
      description: "اربط عدة حسابات طلاب بلوحة ولي أمر واحدة، مع عرض بيانات كل ابن بشكل منفصل.",
      status: "available",
    },
    {
      title: "رؤية تقدم الطالب",
      description: "تابع الدروس المكتملة ودرجات الاختبارات والامتحانات ودقة الإجابات الأخيرة والموضوعات المقترحة للمراجعة.",
      status: "available",
    },
    {
      title: "متابعة المواد والمنهج",
      description: "معرفة المنهج والصف والمواد المسجل بها كل طفل.",
      status: "available",
    },
    {
      title: "رؤية استخدام الذكاء الاصطناعي",
      description: "معرفة عدد أسئلة المساعد المتبقية اليوم لكل مادة مسجلة.",
      status: "available",
    },
    {
      title: "حدود الأسئلة اليومية",
      description: "تشمل كل مادة عددًا يوميًا من أسئلة الذكاء الاصطناعي، قابل للتعديل من فريقنا — ومرئي لك حتى لا توجد مفاجآت.",
      status: "available",
    },
    {
      title: "نقاط الضعف ومراجعات موصى بها",
      description: "رؤية واضحة للمواضيع التي يواجه فيها كل طفل صعوبة، وما نوصي بمراجعته لاحقًا.",
      status: "available",
    },
    {
      title: "الدفع اليدوي للأبناء",
      description: "ابدأ اشتراك مواد لابن مرتبط، وارفع الإيصال، وتابع حالة مراجعته من الإدارة.",
      status: "available",
    },
    {
      title: "حجز جلسة مع معلم",
      description: "أرسل طلب جلسة لمعلم لأحد أبنائك. يراجع الفريق الطلب ويؤكد التوافر بشكل منفصل.",
      status: "available",
    },
    {
      title: "إشعارات نتائج التدريب والاختبارات",
      description: "استلم اسم ابنك والنتيجة والمادة ووقت الانتهاء عبر البريد الإلكتروني؛ ويتاح واتساب عند توثيق الرقم وإعداد الخدمة.",
      status: "available",
    },
  ],
  cta: {
    title: "تابع تعلم أبنائك من مكان واحد",
    body: "أنشئ حساب ولي أمر وافتح روابط الدعوة التي يرسلها أبناؤك لربط حساباتهم.",
    buttonLabel: "أنشئ حسابًا",
    disclaimer: "تراجع الإدارة الإيصالات يدويًا. لا يؤدي رفع الإيصال إلى تفعيل الخدمة قبل موافقة الإدارة.",
  },
};

const copyByLocale: Record<Locale, ForParentsCopy> = { en, ar };
export function getForParentsCopy(locale: Locale): ForParentsCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
