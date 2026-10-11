import type { Locale } from "./marketing";

export interface AiLimitCopy {
  title: string;
  body: string;
  optionsLead: string;
  payLabel: (priceEGP: number) => string;
  payHint: string;
  tomorrowLabel: string;
  tomorrowHint: string;
  pendingTitle: string;
  pendingBody: string;
  // InstaPay checkout page, kind=ai-topup
  checkoutTitle: string;
  checkoutBody: (priceEGP: number) => string;
  backToStudying: string;
}

const en: AiLimitCopy = {
  title: "You've used today's AI study time",
  body: "Great effort today! Your daily AI tutor allowance is used up — your progress is saved and you can pick up right where you stopped.",
  optionsLead: "How would you like to continue?",
  payLabel: (price) => `Continue now — ${price} EGP`,
  payHint: "Unlocks a full extra daily allowance, paid via InstaPay.",
  tomorrowLabel: "Continue tomorrow",
  tomorrowHint: "Your free allowance renews automatically tomorrow.",
  pendingTitle: "Your payment is under review",
  pendingBody: "We received your InstaPay receipt. Your extra allowance unlocks as soon as it's confirmed — then just come back to this lesson.",
  checkoutTitle: "Extra AI study time",
  checkoutBody: (price) => `Pay ${price} EGP via InstaPay to unlock one full extra daily AI allowance. It's activated as soon as we confirm your receipt, and applies to the day it's confirmed.`,
  backToStudying: "Back to studying",
};

const ar: AiLimitCopy = {
  title: "خلّصت وقت المذاكرة بالذكاء الاصطناعي لليوم",
  body: "مجهود رائع النهارده! رصيدك اليومي من المعلّم الذكي خلص — تقدمك محفوظ وتقدر تكمّل من نفس المكان اللي وقفت عنده.",
  optionsLead: "تحب تكمّل إزاي؟",
  payLabel: (price) => `كمّل دلوقتي — ${price} ج`,
  payHint: "بيفتحلك رصيد يومي إضافي كامل، والدفع عن طريق إنستاباي.",
  tomorrowLabel: "هكمّل بكرة",
  tomorrowHint: "رصيدك المجاني بيتجدد تلقائيًا بكرة.",
  pendingTitle: "دفعتك قيد المراجعة",
  pendingBody: "استلمنا إيصال إنستاباي بتاعك. الرصيد الإضافي هيتفتح أول ما نأكّد الدفع — وبعدها ارجع للدرس وكمّل على طول.",
  checkoutTitle: "وقت مذاكرة إضافي بالذكاء الاصطناعي",
  checkoutBody: (price) => `ادفع ${price} ج عن طريق إنستاباي وافتح رصيد يومي إضافي كامل. بيتفعّل أول ما نأكّد الإيصال، وبيكون صالح لليوم اللي اتأكّد فيه.`,
  backToStudying: "ارجع للمذاكرة",
};

const copyByLocale: Record<Locale, AiLimitCopy> = { en, ar };
export function getAiLimitCopy(locale: Locale): AiLimitCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
