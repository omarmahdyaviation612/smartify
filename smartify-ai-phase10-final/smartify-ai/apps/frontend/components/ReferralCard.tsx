"use client";
import { useEffect, useState } from "react";
import { SmartifyButton } from "@smartify/ui";
import { useApiClient } from "@/lib/api-client";

interface PendingReward {
  referralId: string;
  earnedAt: string;
}
interface AppliedReward {
  referralId: string;
  appliedAt: string;
  subjectId: string | null;
  subjectNameEn: string | null;
  subjectNameAr: string | null;
  expiresAt: string | null;
}
interface ReferralMe {
  code: string;
  referralsCreated: number;
  successfulReferrals: number;
  pendingRewards: PendingReward[];
  appliedRewards: AppliedReward[];
}
interface EligibleSubject {
  id: string;
  nameEn: string;
  nameAr: string;
}

/**
 * Referral V1 (2026-09-20) — code/link, referral counts, and applying an
 * earned (but unapplied) reward to one eligible Subject. Reward EARNING
 * happens server-side at the referred student's first paid activation
 * (BillingService) — this card only ever shows/applies what's already
 * true server-side, it never grants anything itself.
 */
export function ReferralCard({ isAr, locale }: { isAr: boolean; locale: string }) {
  const { apiFetch } = useApiClient();
  const [me, setMe] = useState<ReferralMe | null>(null);
  const [link, setLink] = useState("");
  const [eligible, setEligible] = useState<EligibleSubject[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [pickedSubjectId, setPickedSubjectId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function refetch() {
    apiFetch<ReferralMe>("/referral/me").then(setMe).catch(() => {});
  }

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (me) setLink(`${window.location.origin}/${isAr ? "ar" : "en"}/sign-up?ref=${encodeURIComponent(me.code)}`);
  }, [me, isAr]);

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e: any) {
      setError(e?.message ?? (isAr ? "تعذر نسخ الرابط." : "Could not copy the link."));
    }
  }

  async function startApply(referralId: string) {
    setApplyingId(referralId);
    setError("");
    setPickedSubjectId("");
    if (!eligible) {
      try {
        const subjects = await apiFetch<EligibleSubject[]>("/referral/eligible-subjects");
        setEligible(subjects);
      } catch {
        setEligible([]);
      }
    }
  }

  async function confirmApply() {
    if (!applyingId || !pickedSubjectId) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/referral/rewards/${applyingId}/apply`, { method: "POST", body: JSON.stringify({ subjectId: pickedSubjectId }) });
      setApplyingId(null);
      refetch();
    } catch (e: any) {
      setError(e?.message ?? (isAr ? "تعذر تطبيق المكافأة." : "Could not apply the reward."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
      <h2 className="font-semibold text-navy-900">{isAr ? "دعوة الأصدقاء" : "Refer a friend"}</h2>
      <p className="my-2 text-sm text-neutral-600">
        {isAr
          ? "شارك رمزك — عندما يفعّل صديقك أول مادة مدفوعة، تحصل على 30 يومًا مجانًا لمادة واحدة."
          : "Share your code — when your friend activates their first paid subject, you earn 30 free days for one subject."}
      </p>

      {!me && <p className="text-sm text-neutral-400">{isAr ? "جارٍ التحميل..." : "Loading..."}</p>}

      {me && (
        <>
          <p className="mb-2 rounded bg-neutral-100 p-3 text-center text-xl font-bold tracking-widest">{me.code}</p>
          <div className="flex flex-wrap gap-2">
            <SmartifyButton onClick={copyLink} variant="secondary">
              {copied ? (isAr ? "تم النسخ" : "Copied") : isAr ? "نسخ الرابط" : "Copy link"}
            </SmartifyButton>
          </div>
          <p className="mt-2 break-all text-xs text-neutral-500" dir="ltr">
            {link}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3 text-center text-sm">
            <div>
              <p className="text-lg font-bold text-navy-900">{me.referralsCreated}</p>
              <p className="text-xs text-neutral-500">{isAr ? "دعوات" : "Referrals"}</p>
            </div>
            <div>
              <p className="text-lg font-bold text-navy-900">{me.successfulReferrals}</p>
              <p className="text-xs text-neutral-500">{isAr ? "ناجحة" : "Successful"}</p>
            </div>
          </div>

          {me.pendingRewards.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-neutral-100 pt-4">
              <p className="text-sm font-medium text-navy-900">{isAr ? "مكافآت بانتظار التفعيل" : "Rewards ready to apply"}</p>
              {me.pendingRewards.map((r) => (
                <div key={r.referralId} className="rounded-sf border border-neutral-100 p-3">
                  {applyingId === r.referralId ? (
                    <div className="space-y-2">
                      <select
                        value={pickedSubjectId}
                        onChange={(e) => setPickedSubjectId(e.target.value)}
                        className="w-full rounded-sf border border-neutral-300 px-3 py-2 text-sm"
                      >
                        <option value="">{isAr ? "اختر مادة" : "Choose a subject"}</option>
                        {(eligible ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {isAr ? s.nameAr : s.nameEn}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <SmartifyButton onClick={confirmApply} disabled={busy || !pickedSubjectId}>
                          {isAr ? "تأكيد" : "Confirm"}
                        </SmartifyButton>
                        <SmartifyButton variant="secondary" onClick={() => setApplyingId(null)}>
                          {isAr ? "إلغاء" : "Cancel"}
                        </SmartifyButton>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => startApply(r.referralId)} className="text-xs text-sf-blue-500 underline">
                      {isAr ? "تطبيق المكافأة (30 يومًا لمادة واحدة)" : "Apply reward (30 days, one subject)"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {me.appliedRewards.length > 0 && (
            <div className="mt-4 space-y-1 border-t border-neutral-100 pt-4">
              <p className="text-sm font-medium text-navy-900">{isAr ? "مكافآت مُفعّلة" : "Applied rewards"}</p>
              {me.appliedRewards.map((r) => (
                <p key={r.referralId} className="text-xs text-neutral-500">
                  {isAr ? r.subjectNameAr ?? "" : r.subjectNameEn ?? ""} — {isAr ? "حتى" : "until"}{" "}
                  {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : ""}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      {error && <p className="mt-2 text-sm text-error-500">{error}</p>}
    </div>
  );
}
