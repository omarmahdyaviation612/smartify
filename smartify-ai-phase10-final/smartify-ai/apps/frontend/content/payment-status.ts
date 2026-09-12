import type { Locale } from "./marketing";
export type PaymentStatus = "checking" | "verified" | "pending" | "failed" | "unverified";
const copy = {
  en: {
    checking: ["Checking payment", "Please wait while we check your payment with the server."],
    verified: ["Payment verified", "Your payment has been verified and your subscription is active."],
    pending: ["Payment confirmation pending", "Payment or subscription activation is still pending. Check again shortly; this page does not grant access."],
    failed: ["Payment or subscription not active", "The checkout expired, payment failed, or the subscription was canceled. Review your billing details."],
    unverified: ["Payment not verified", "We could not verify a payment for your account. Opening this page does not confirm payment or activate a subscription."],
    retry: "Check again",
  },
  ar: {
    checking: ["جاري التحقق من الدفع", "يرجى الانتظار أثناء التحقق من حالة الدفع عبر الخادم."],
    verified: ["تم التحقق من الدفع", "تم التحقق من دفعتك واشتراكك مفعّل."],
    pending: ["تأكيد الدفع قيد الانتظار", "الدفع أو تفعيل الاشتراك ما زال قيد الانتظار. تحقق مرة أخرى بعد قليل؛ هذه الصفحة لا تمنح صلاحية الوصول."],
    failed: ["الدفع أو الاشتراك غير مفعّل", "انتهت صلاحية عملية الدفع أو فشلت أو تم إلغاء الاشتراك. راجع تفاصيل الفواتير."],
    unverified: ["لم يتم التحقق من الدفع", "لم نتمكن من التحقق من دفعة لحسابك. فتح هذه الصفحة لا يؤكد الدفع ولا يفعّل الاشتراك."],
    retry: "التحقق مرة أخرى",
  },
};
export function getPaymentStatusCopy(locale: Locale) { return copy[locale] ?? copy.ar; }
