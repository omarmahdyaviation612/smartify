import type { Locale } from "./marketing";

export interface BillingCopy {
  title: string;
  body: string;
  currentPlanTitle: string;
  noSubscription: string;
  statusLabel: string;
  cancelLabel: string;
  cancelConfirm: string;
  chooseSubjectsTitle: string;
  chooseSubjectsBody: string;
  unpriced: string;
  totalLabel: string;
  subscribeLabel: string;
  notConfigured: string;
  genericError: string;
  monthSuffix: string;
  noSubjectsAvailable: string;
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
  chooseSubjectsTitle: "Choose your subjects",
  chooseSubjectsBody: "Every subject has its own independent monthly price — pick as many as you'd like. Your total is the sum of the subjects you select.",
  unpriced: "Not yet available",
  totalLabel: "Monthly total",
  subscribeLabel: "Subscribe",
  notConfigured: "Payments aren't fully set up in this environment yet — checkout isn't available right now.",
  genericError: "Something went wrong. Please try again.",
  monthSuffix: "EGP / month",
  noSubjectsAvailable: "No subjects are available for your grade yet.",
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
  chooseSubjectsTitle: "اختر موادك",
  chooseSubjectsBody: "لكل مادة سعرها الشهري المستقل — اختر أي عدد تريده. إجماليك هو مجموع أسعار المواد التي تختارها.",
  unpriced: "غير متاحة بعد",
  totalLabel: "الإجمالي الشهري",
  subscribeLabel: "اشترك",
  notConfigured: "الدفع غير مُفعّل بالكامل في هذه البيئة حاليًا — الدفع غير متاح الآن.",
  genericError: "حدث خطأ ما. حاول مرة أخرى.",
  monthSuffix: "ج.م / شهريًا",
  noSubjectsAvailable: "لا توجد مواد متاحة لصفك الدراسي بعد.",
  successTitle: "تم الاشتراك!",
  successBody: "جاري تفعيل اشتراكك — قد يستغرق ذلك بعض الوقت بعد تأكيد الدفع.",
  backToBilling: "العودة للفواتير",
};

const copyByLocale: Record<Locale, BillingCopy> = { en, ar };
export function getBillingCopy(locale: Locale): BillingCopy {
  return copyByLocale[locale] ?? copyByLocale.ar;
}
