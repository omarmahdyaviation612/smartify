import type { Locale } from "./marketing";

export interface BillingCopy {
  title: string;
  body: string;
  currentPlanTitle: string;
  noSubscription: string;
  statusLabel: string;
  cancelLabel: string;
  cancelConfirm: string;
  choosePlanTitle: string;
  additionalSubjectsLabel: string;
  subscribeLabel: string;
  notConfigured: string;
  genericError: string;
  monthSuffix: string;
  includedSubjects: (count: number) => string;
  extraSubjectPrice: (price: string) => string;
  successTitle: string;
  successBody: string;
  backToBilling: string;
}

const en: BillingCopy = {
  title: "Subscription & Billing",
  body: "Manage your Smartify AI subscription.",
  currentPlanTitle: "Current Plan",
  noSubscription: "You don't have an active subscription yet.",
  statusLabel: "Status",
  cancelLabel: "Cancel Subscription",
  cancelConfirm: "Are you sure you want to cancel? This takes effect immediately.",
  choosePlanTitle: "Choose a Plan",
  additionalSubjectsLabel: "Additional subjects beyond the included amount",
  subscribeLabel: "Subscribe",
  notConfigured: "Payments aren't fully set up in this environment yet — checkout isn't available right now.",
  genericError: "Something went wrong. Please try again.",
  monthSuffix: "EGP / month",
  includedSubjects: (count) => `Includes ${count} subjects`,
  extraSubjectPrice: (price) => `${price} EGP per additional subject`,
  successTitle: "You're subscribed!",
  successBody: "Your subscription is being activated — this can take a moment once payment is confirmed.",
  backToBilling: "Back to Billing",
};

const ar: BillingCopy = {
  title: "الاشتراك والفواتير",
  body: "إدارة اشتراكك في سمارتيفاي AI.",
  currentPlanTitle: "الخطة الحالية",
  noSubscription: "ليس لديك اشتراك فعّال حاليًا.",
  statusLabel: "الحالة",
  cancelLabel: "إلغاء الاشتراك",
  cancelConfirm: "هل أنت متأكد من رغبتك في الإلغاء؟ سيسري ذلك فورًا.",
  choosePlanTitle: "اختر خطة",
  additionalSubjectsLabel: "مواد إضافية بعد العدد المشمول",
  subscribeLabel: "اشترك",
  notConfigured: "الدفع غير مُفعّل بالكامل في هذه البيئة حاليًا — الدفع غير متاح الآن.",
  genericError: "حدث خطأ ما. حاول مرة أخرى.",
  monthSuffix: "ج.م / شهريًا",
  includedSubjects: (count) => `يشمل ${count} مواد`,
  extraSubjectPrice: (price) => `${price} ج.م لكل مادة إضافية`,
  successTitle: "تم الاشتراك!",
  successBody: "جاري تفعيل اشتراكك — قد يستغرق ذلك بعض الوقت بعد تأكيد الدفع.",
  backToBilling: "العودة للفواتير",
};

const copyByLocale: Record<Locale, BillingCopy> = { en, ar };
export function getBillingCopy(locale: Locale): BillingCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
