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

interface BillingSubject {
  id: string;
  nameEn: string;
  nameAr: string;
  priceEGP: number | null;
  entitlement: "ACTIVE" | "LOCKED";
  grade: { nameEn: string; nameAr: string };
  curriculum: { nameEn: string; nameAr: string };
}
interface Subscription {
  id: string;
  status: string;
  monthlyTotalEGP: string;
  subjects: Array<{ id: string; nameEn: string; nameAr: string }>;
  pendingSubjectChange?: { subjectIds: string[]; homeworkAddonActive?: boolean; homeworkAddonAllowance?: number | null; checkoutUrl?: string } | null;
  homeworkAddonActive?: boolean;
  homeworkAddonMonthlyAmountEGP?: number | string | null;
  homeworkAddonMonthlyAllowance?: number | null;
}
interface HomeworkTier { allowance: 10 | 20; amountEGP: number }

export default function BillingPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const router = useRouter();
  const requestedSubjectId = useSearchParams().get("subjectId");
  const isAr = locale === "ar";
  const copy = getBillingCopy(locale);
  const instapayCopy = getInstapayCopy(locale);
  const navCopy = getMarketingCopy(locale);
  const { apiFetch } = useApiClient();

  const [subjects, setSubjects] = useState<BillingSubject[] | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notOnboarded, setNotOnboarded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [homeworkAddon, setHomeworkAddon] = useState(false);
  const [homeworkAllowance, setHomeworkAllowance] = useState<10 | 20>(10);
  const [homeworkTiers, setHomeworkTiers] = useState<HomeworkTier[]>([]);
  const [homeworkConfigured, setHomeworkConfigured] = useState(false);

  async function loadBillingData() {
    setLoadingSubjects(true);
    setError(null);
    Promise.all([apiFetch<BillingSubject[]>("/billing/subjects"), apiFetch<Subscription | null>("/billing/subscription"), apiFetch<{configured:boolean;tiers:HomeworkTier[]}>("/billing/homework-addon")])
      .then(([subjectData, subData, addonData]) => {
        setSubjects(subjectData);
        setSubscription(subData);
        setHomeworkAddon(subData?.homeworkAddonActive === true);
        const activeAllowance = subData?.homeworkAddonMonthlyAllowance;
        setHomeworkAllowance(activeAllowance === 20 ? 20 : 10);
        const snapshotPrice = Number(subData?.homeworkAddonMonthlyAmountEGP ?? 0);
        const tiers = [...addonData.tiers];
        if (subData?.homeworkAddonActive && snapshotPrice > 0 && (activeAllowance === 10 || activeAllowance === 20)) {
          const activeTier = tiers.find(t => t.allowance === activeAllowance);
          if (activeTier) activeTier.amountEGP = snapshotPrice;
          else tiers.push({ allowance: activeAllowance, amountEGP: snapshotPrice });
        }
        setHomeworkTiers(tiers);
        setHomeworkConfigured(addonData.configured || (subData?.homeworkAddonActive === true && activeAllowance != null));
        setSelectedSubjectIds(subjectData.filter(s => s.id === requestedSubjectId || (subData?.status === "active" && subData.subjects.some(owned => owned.id === s.id))).filter(s => s.priceEGP != null).map(s => s.id));
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotOnboarded(true);
          return;
        }
        setError(isAr ? "تعذر تحميل بيانات الاشتراك. حاول مرة أخرى." : "Could not load subscription data. Please try again.");
      })
      .finally(() => {
        setLoadingSubjects(false);
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
        body: JSON.stringify({ subjectIds: selectedSubjectIds, homeworkAddon, ...(homeworkAddon ? { homeworkAddonAllowance: homeworkAllowance } : {}) }),
      });
      window.location.href = res.checkoutUrl;
    } catch (err: any) {
      const msg = err?.message ?? "";
      setError(msg.includes("not configured") || msg.includes("No payment provider") ? copy.notConfigured : copy.genericError);
      setSubmitting(false);
    }
  }

  const priceById = new Map((subjects ?? []).map((subject) => [subject.id, subject.priceEGP]));
  const selectedHomeworkTier = homeworkTiers.find(t => t.allowance === homeworkAllowance);
  const monthlyTotal = selectedSubjectIds.reduce((total, id) => total + Number(priceById.get(id) ?? 0), 0) + (homeworkAddon ? Number(selectedHomeworkTier?.amountEGP ?? 0) : 0);

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
          {requestedSubjectId && subjects?.some(s => s.id === requestedSubjectId) && (
            <p className="mt-4 rounded-sf bg-amber-50 p-4 text-sm text-amber-900">
              {isAr ? "إضافة مادة إلى اشتراكك: " : "Add a subject to your subscription: "}
              {subjects.filter(s => s.id === requestedSubjectId).map(s => `${isAr ? s.nameAr : s.nameEn} · ${isAr ? s.grade.nameAr : s.grade.nameEn} · ${isAr ? s.curriculum.nameAr : s.curriculum.nameEn} · ${s.priceEGP == null ? copy.unpriced : `${s.priceEGP} ${copy.monthSuffix}`}`).join("")}
            </p>
          )}

          <div className="mt-8 rounded-sf-lg border border-neutral-200 bg-white p-6">
            <h2 className="mb-3 font-semibold text-navy-900">{copy.currentPlanTitle}</h2>
            {subscription ? (
              <div className="space-y-2 text-sm">
                <p className="text-neutral-700">
                  {subscription.subjects.map((subject) => (isAr ? subject.nameAr : subject.nameEn)).join(isAr ? "، " : ", ")} —{" "}
                  {subscription.monthlyTotalEGP} {copy.monthSuffix}
                </p>
                <p className="text-neutral-500">
                  {copy.statusLabel}: <span className="font-medium text-navy-900">{subscription.status}</span>
                </p>
                {subscription.pendingSubjectChange && (
                  <a className="inline-block font-medium text-ai-600 underline" href={subscription.pendingSubjectChange.checkoutUrl ?? `/${locale}/billing/instapay?kind=subscription&subjectIds=${encodeURIComponent(subscription.pendingSubjectChange.subjectIds.join(","))}&homeworkAddon=${subscription.pendingSubjectChange.homeworkAddonActive === true}&homeworkAddonAllowance=${subscription.pendingSubjectChange.homeworkAddonAllowance ?? ""}`}>
                    {isAr ? "متابعة الدفع لإضافة المادة" : "Continue payment to add your subject"}
                  </a>
                )}
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

          {loadingSubjects && <p className="mt-8 text-sm text-neutral-500">{isAr ? "جاري تحميل المواد..." : "Loading subjects..."}</p>}

          {error && (
            <div role="alert" className="mt-4 text-sm text-error-500">
              <p>{error}</p>
              <SmartifyButton variant="secondary" onClick={loadBillingData} className="mt-3">
                {isAr ? "إعادة المحاولة" : "Try again"}
              </SmartifyButton>
            </div>
          )}

          {!loadingSubjects && subjects?.length === 0 && (
            <div className="mt-8 rounded-sf-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              <p>{copy.noSubjectsAvailable}</p>
              <SmartifyButton variant="secondary" className="mt-4" onClick={loadBillingData}>
                {isAr ? "إعادة المحاولة" : "Try again"}
              </SmartifyButton>
            </div>
          )}

          {!loadingSubjects && subjects && subjects.length > 0 && (
            <div className="mt-8">
              <h2 className="mb-1 font-semibold text-navy-900">{copy.chooseSubjectsTitle}</h2>
              <p className="mb-4 text-sm text-neutral-500">{copy.chooseSubjectsBody}</p>

              <div className="space-y-2">
                {subjects.map((subject) => {
                  const unpriced = subject.priceEGP == null;
                  const checked = selectedSubjectIds.includes(subject.id);
                  return (
                    <label
                      key={subject.id}
                      className={`flex items-center justify-between rounded-sf border px-3 py-2 ${
                        unpriced ? "border-neutral-100 bg-neutral-50 text-neutral-400" : "border-neutral-200"
                      }`}
                    >
                      <span>{isAr ? subject.nameAr : subject.nameEn}</span>
                      <span className="flex items-center gap-3">
                        <span className="text-sm text-neutral-500">
                          {unpriced ? copy.unpriced : `${subject.priceEGP} ${copy.monthSuffix}`}
                        </span>
                        <input
                          type="checkbox"
                          disabled={unpriced || (subscription?.status === "active" && subscription.subjects.some(owned => owned.id === subject.id))}
                          checked={checked}
                          onChange={() =>
                            setSelectedSubjectIds((ids) =>
                              ids.includes(subject.id) ? ids.filter((id) => id !== subject.id) : [...ids, subject.id]
                            )
                          }
                        />
                      </span>
                    </label>
                  );
                })}
              </div>

              <section className={`mt-5 rounded-sf border p-4 ${homeworkConfigured ? "border-ai-200" : "border-neutral-200 bg-neutral-50"}`}>
                <label className="flex items-center justify-between gap-4">
                  <span><span className="block font-medium">{isAr ? "إضافة مساعد حل الواجب" : "Add Homework Helper"}</span><span className="text-sm text-neutral-500">{isAr ? "إرشاد بالاعتماد على موضوعات منهجك" : "Step-by-step help from your curriculum"}</span></span>
                  <input type="checkbox" checked={homeworkAddon} disabled={!homeworkConfigured} onChange={e=>setHomeworkAddon(e.target.checked)} aria-label={isAr ? "إضافة مساعد حل الواجب" : "Add Homework Helper"}/>
                </label>
                {homeworkTiers.map(tier => <label key={tier.allowance} className={`mt-3 flex cursor-pointer items-center justify-between rounded-sf border p-3 ${homeworkAllowance === tier.allowance ? "border-ai-500 bg-ai-50" : "border-neutral-200"}`}>
                  <span>{isAr ? `حتى ${tier.allowance} سؤالًا شهريًا` : `Up to ${tier.allowance} questions per month`}</span>
                  <span className="flex items-center gap-2">{tier.amountEGP} {copy.monthSuffix}<input type="radio" name="homework-tier" checked={homeworkAllowance === tier.allowance} disabled={!homeworkAddon || !homeworkConfigured} onChange={()=>setHomeworkAllowance(tier.allowance)}/></span>
                </label>)}
                {!homeworkConfigured && <p className="mt-2 text-sm text-neutral-500">{copy.notConfigured}</p>}
              </section>

              <div className="mt-6 rounded-sf-lg bg-neutral-50 p-5">
                <div className="flex justify-between font-semibold text-navy-900">
                  <span>{copy.totalLabel}</span>
                  <span>{monthlyTotal} {copy.monthSuffix}</span>
                </div>
              </div>

              <SmartifyButton variant="ai" className="mt-6 w-full" disabled>
                {isAr ? "الدفع عبر فوري قريبًا" : "Fawry payment coming soon"}
              </SmartifyButton>
              <SmartifyButton
                variant="secondary"
                className="mt-3 w-full"
                disabled={selectedSubjectIds.length === 0}
                onClick={() => {
                  const params = new URLSearchParams({ kind: "subscription", subjectIds: selectedSubjectIds.join(","), homeworkAddon: String(homeworkAddon), homeworkAddonAllowance: String(homeworkAllowance) });
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
