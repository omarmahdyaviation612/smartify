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
      description: "A single parent account is designed to link to every one of your children's student accounts.",
      status: "planned",
    },
    {
      title: "Student progress visibility",
      description: "See lessons completed, mastery by topic, and how each child's learning is trending over time.",
      status: "planned",
    },
    {
      title: "Subject & curriculum tracking",
      description: "See which curriculum, grade, and subjects each child is enrolled in.",
      status: "planned",
    },
    {
      title: "AI usage visibility",
      description: "See how much your child is using the AI tutor, and how they're using it.",
      status: "planned",
    },
    {
      title: "Daily question limits",
      description: "Every subject includes a daily allowance of AI questions, configurable by our team — visible to you so there are no surprises.",
      status: "planned",
    },
    {
      title: "Weak areas & recommended review",
      description: "A clear view of the topics each child is struggling with, and what we recommend reviewing next.",
      status: "planned",
    },
    {
      title: "Subscription & payment management",
      description: "Manage plans, subjects, and billing for all your children from one place.",
      status: "planned",
    },
    {
      title: "Teacher session booking",
      description: "Book a real teacher session for a topic when AI support isn't enough.",
      status: "planned",
    },
  ],
  cta: {
    title: "Want early access as parent features launch?",
    body: "Create an account now — our team will enable parent access on your account as this rolls out, and you'll be notified as each capability above goes live.",
    buttonLabel: "Create an Account",
    disclaimer: "The parent dashboard is under active development. Nothing above is billed or activated automatically by signing up.",
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
      description: "حساب ولي أمر واحد مصمم للربط بحسابات جميع أبنائك الطلاب.",
      status: "planned",
    },
    {
      title: "رؤية تقدم الطالب",
      description: "متابعة الدروس المكتملة، ومستوى الإتقان لكل موضوع، وتطور تعلم كل طفل بمرور الوقت.",
      status: "planned",
    },
    {
      title: "متابعة المواد والمنهج",
      description: "معرفة المنهج والصف والمواد المسجل بها كل طفل.",
      status: "planned",
    },
    {
      title: "رؤية استخدام الذكاء الاصطناعي",
      description: "معرفة مدى وكيفية استخدام طفلك للمعلم الذكي.",
      status: "planned",
    },
    {
      title: "حدود الأسئلة اليومية",
      description: "تشمل كل مادة عددًا يوميًا من أسئلة الذكاء الاصطناعي، قابل للتعديل من فريقنا — ومرئي لك حتى لا توجد مفاجآت.",
      status: "planned",
    },
    {
      title: "نقاط الضعف ومراجعات موصى بها",
      description: "رؤية واضحة للمواضيع التي يواجه فيها كل طفل صعوبة، وما نوصي بمراجعته لاحقًا.",
      status: "planned",
    },
    {
      title: "إدارة الاشتراك والدفع",
      description: "إدارة الخطط والمواد والفواتير لجميع أبنائك من مكان واحد.",
      status: "planned",
    },
    {
      title: "حجز جلسة مع معلم",
      description: "حجز جلسة مع معلم حقيقي لموضوع معين عندما لا يكفي دعم الذكاء الاصطناعي.",
      status: "planned",
    },
  ],
  cta: {
    title: "تريد وصولًا مبكرًا مع إطلاق ميزات أولياء الأمور؟",
    body: "أنشئ حسابًا الآن — سيقوم فريقنا بتفعيل وصول ولي الأمر على حسابك مع إطلاق هذه الميزات تدريجيًا، وسيتم إشعارك عند تفعيل كل ميزة.",
    buttonLabel: "أنشئ حسابًا",
    disclaimer: "لوحة تحكم ولي الأمر قيد التطوير النشط. لا يتم تفعيل أو محاسبة أي مما سبق تلقائيًا عند التسجيل.",
  },
};

const copyByLocale: Record<Locale, ForParentsCopy> = { en, ar };
export function getForParentsCopy(locale: Locale): ForParentsCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
