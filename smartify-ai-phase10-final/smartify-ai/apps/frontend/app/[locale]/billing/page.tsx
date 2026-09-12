"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getBillingCopy } from "@/content/billing";
import { getInstapayCopy } from "@/content/instapay";
import { getMarketingCopy } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { ApiError, useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";

interface PricingPlan {
  id: string;
  levelCodeEn: string;
  levelCodeAr: string;
  monthlyPriceEGP: string;
  includedSubjects: number;
  additionalSubjectPriceEGP: string;
  gradeLevel: number | null;
  subjects: Array<{ id: string; nameEn: string; nameAr: string }>;
  basicSubjectIds: string[];
}
interface Subscription {
  id: string;
  status: string;
  monthlyTotalEGP: string;
  additionalSubjectsCount: number;
  pricingPlan: PricingPlan;
}

export default function BillingPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPlanId = searchParams.get("planId");
  const isAr = locale === "ar";
  const copy = getBillingCopy(locale);
  const instapayCopy = getInstapayCopy(locale);
  const navCopy = getMarketingCopy(locale);
  const { apiFetch } = useApiClient();

  const [plans, setPlans] = useState<PricingPlan[] | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [extraSubjectIds, setExtraSubjectIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notOnboarded, setNotOnboarded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(true);

  async function loadBillingData() {
    setLoadingPlans(true);
    setError(null);
    Promise.all([apiFetch<PricingPlan[]>("/billing/plans"), apiFetch<Subscription | null>("/billing/subscription")])
      .then(([planData, subData]) => {
        setPlans(planData);
        setSubscription(subData);
        if (planData[0]) {
          // A plan carried forward from the public pricing page (?planId=)
          // wins only if it's genuinely one of THIS student's own curriculum
          // plans — never trusted blindly, just a convenience default so
          // they don't have to re-pick what they already chose.
          const requested = requestedPlanId ? planData.find((plan) => plan.id === requestedPlanId) : undefined;
          if (requested) {
            setSelectedPlanId(requested.id);
            return;
          }
          const level = planData[0].gradeLevel ?? 7;
          const selected = planData.find((plan) => {
            const code = plan.levelCodeEn.toLowerCase();
            if (code.includes("primary") || code.includes("1-5")) return level <= 5;
            if (code.includes("preparatory") || code.includes("6-8")) return level >= 6 && level <= 8;
            if (code.includes("grade 9")) return level === 9;
            if (code.includes("secondary") || code.includes("10-12")) return level >= 10;
            return false;
          });
          setSelectedPlanId((selected ?? planData[0]).id);
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotOnboarded(true);
          return;
        }
        setError(isAr ? "تعذر تحميل بيانات الاشتراك. حاول مرة أخرى." : "Could not load subscription data. Please try again.");
      })
      .finally(() => {
        setLoadingPlans(false);
      });
  }

  useEffect(() => {
    loadBillingData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubscribe() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{ checkoutUrl: string }>("/billing/checkout", {
        method: "POST",
        body: JSON.stringify({
          pricingPlanId: selectedPlanId,
          additionalSubjectsCount: extraSubjectIds.length,
          subjectIds: extraSubjectIds,
        }),
      });
      window.location.href = res.checkoutUrl;
    } catch (err: any) {
      const msg = err?.message ?? "";
      setError(msg.includes("not configured") || msg.includes("No payment provider") ? copy.notConfigured : copy.genericError);
      setSubmitting(false);
    }
  }

  const selectedPlan = plans?.find((plan) => plan.id === selectedPlanId);
  const basicSubjectIds = new Set(selectedPlan?.basicSubjectIds ?? []);
  const optionalSubjects = (selectedPlan?.subjects ?? []).filter((subject) => !basicSubjectIds.has(subject.id));
  const additionalTotal = optionalSubjects
    .filter((subject) => extraSubjectIds.includes(subject.id))
    .reduce((total) => total + Number(selectedPlan?.additionalSubjectPriceEGP ?? 0), 0);
  const monthlyTotal = Number(selectedPlan?.monthlyPriceEGP ?? 0) + additionalTotal;

  async function handleCancel() {
    if (!confirm(copy.cancelConfirm)) return;
    try {
      const updated = await apiFetch<Subscription>("/billing/cancel", { method: "POST" });
      setSubscription(updated);
    } catch {
      setError(copy.genericError);
    }

  }

  if (notOnboarded) {
    return (
      <>
        <Navbar locale={locale} copy={navCopy} />
        <main className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center text-neutral-600">
          <p>{isAr ? "أكمل التسجيل أولًا لاختيار المنهج والمواد." : "Complete onboarding first to choose your curriculum and subjects."}</p>
          <SmartifyButton variant="ai" onClick={() => router.push(`/${locale}/onboarding/profile`)}>
            {isAr ? "إكمال التسجيل" : "Complete onboarding"}
          </SmartifyButton>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar locale={locale} copy={navCopy} />
      <main className="py-12">
        <SmartifyContainer className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold text-navy-900">{copy.title}</h1>
          <p className="mt-2 text-neutral-600">{copy.body}</p>

          <div className="mt-8 rounded-sf-lg border border-neutral-200 bg-white p-6">
            <h2 className="mb-3 font-semibold text-navy-900">{copy.currentPlanTitle}</h2>
            {subscription ? (
              <div className="space-y-2 text-sm">
                <p className="text-neutral-700">
                  {isAr ? subscription.pricingPlan.levelCodeAr : subscription.pricingPlan.levelCodeEn} —{" "}
                  {subscription.monthlyTotalEGP} {copy.monthSuffix}
                </p>
                <p className="text-neutral-500">
                  {copy.statusLabel}: <span className="font-medium text-navy-900">{subscription.status}</span>
                </p>
                {subscription.status === "active" && (
                  <SmartifyButton variant="secondary" onClick={handleCancel} className="mt-2">
                    {copy.cancelLabel}
                  </SmartifyButton>
                )}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">{copy.noSubscription}</p>
            )}
          </div>

          {loadingPlans && <p className="mt-8 text-sm text-neutral-500">{isAr ? "جاري تحميل الباقات..." : "Loading plans..."}</p>}

          {error && (
            <div role="alert" className="mt-4 text-sm text-error-500">
              <p>{error}</p>
              <SmartifyButton variant="secondary" onClick={loadBillingData} className="mt-3">
                {isAr ? "إعادة المحاولة" : "Try again"}
              </SmartifyButton>
            </div>
          )}

          {!loadingPlans && plans?.length === 0 && (
            <div className="mt-8 rounded-sf-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              <p>{isAr ? "لا توجد باقات نشطة لهذا المنهج حاليًا." : "No active plans are available for this curriculum."}</p>
              <SmartifyButton variant="secondary" className="mt-4" onClick={loadBillingData}>
                {isAr ? "إعادة المحاولة" : "Try again"}
              </SmartifyButton>
            </div>
          )}

          {!loadingPlans && plans && plans.length > 0 && selectedPlan && (
            <div className="mt-8">
              <h2 className="mb-4 font-semibold text-navy-900">{copy.choosePlanTitle}</h2>
              <div className="rounded-sf-lg border border-sf-blue-500 bg-[--sf-bg-subtle] p-5">
                <p className="font-semibold text-navy-900">{isAr ? selectedPlan.levelCodeAr : selectedPlan.levelCodeEn}</p>
                <p className="mt-1 text-2xl font-bold text-navy-900">
                  {selectedPlan.monthlyPriceEGP} <span className="text-sm font-normal text-neutral-500">{copy.monthSuffix}</span>
                </p>
                <p className="mt-3 text-sm font-medium text-navy-900">{isAr ? "المواد الأساسية المشمولة" : "Included core subjects"}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedPlan.subjects.filter((subject) => basicSubjectIds.has(subject.id)).map((subject) => (
                    <span key={subject.id} className="rounded-full bg-white px-3 py-1 text-sm text-neutral-700">
                      {isAr ? subject.nameAr : subject.nameEn}
                    </span>
                  ))}
                </div>
              </div>

              {optionalSubjects.length > 0 && (
                <div className="mt-6 rounded-sf-lg border border-neutral-200 bg-white p-5">
                  <h3 className="font-semibold text-navy-900">{isAr ? "أضف مواد إلى السلة" : "Add subjects to cart"}</h3>
                  <p className="mt-1 text-sm text-neutral-500">{copy.extraSubjectPrice(selectedPlan.additionalSubjectPriceEGP)}</p>
                  <div className="mt-3 space-y-2">
                    {optionalSubjects.map((subject) => (
                      <label key={subject.id} className="flex items-center justify-between rounded-sf border border-neutral-200 px-3 py-2">
                        <span>{isAr ? subject.nameAr : subject.nameEn}</span>
                        <input
                          type="checkbox"
                          checked={extraSubjectIds.includes(subject.id)}
                          onChange={() => setExtraSubjectIds((ids) => ids.includes(subject.id) ? ids.filter((id) => id !== subject.id) : [...ids, subject.id])}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 rounded-sf-lg bg-neutral-50 p-5">
                <div className="flex justify-between font-semibold text-navy-900">
                  <span>{isAr ? "الإجمالي الشهري" : "Monthly total"}</span>
                  <span>{monthlyTotal} {copy.monthSuffix}</span>
                </div>
              </div>


              <SmartifyButton variant="ai" className="mt-6 w-full" disabled>
                {isAr ? "الدفع عبر فوري قريبًا" : "Fawry payment coming soon"}
              </SmartifyButton>
              <SmartifyButton
                variant="secondary"
                className="mt-3 w-full"
                onClick={() => {
                  const params = new URLSearchParams({ kind: "subscription", pricingPlanId: selectedPlanId });
                  if (extraSubjectIds.length > 0) params.set("subjectIds", extraSubjectIds.join(","));
                  router.push(`/${locale}/billing/instapay?${params.toString()}`);
                }}
              >
                {instapayCopy.payWithInstapay}
              </SmartifyButton>
            </div>
          )}
        </SmartifyContainer>
      </main>
    </>
  );
}
