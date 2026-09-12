"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getInstapayCopy, type InstapaySubmissionStatus } from "@/content/instapay";
import { getMarketingCopy } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";

interface InitiateResult {
  referenceId: string;
  expectedAmountEGP: number;
  recipientName: string;
  recipientHandle: string;
  instructionsEn: string;
  instructionsAr: string;
}

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

export default function InstapayCheckoutPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const isAr = locale === "ar";
  const copy = getInstapayCopy(locale);
  const navCopy = getMarketingCopy(locale);
  const searchParams = useSearchParams();
  const { apiFetch } = useApiClient();

  const kind = searchParams.get("kind") === "pack" ? "pack" : "subscription";
  const pricingPlanId = searchParams.get("pricingPlanId") ?? "";
  const additionalSubjectsCount = searchParams.get("additionalSubjectsCount");
  const subjectIdsParam = searchParams.get("subjectIds");
  const subjectId = searchParams.get("subjectId") ?? "";

  const [loading, setLoading] = useState(true);
  const [initiated, setInitiated] = useState<InitiateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [senderName, setSenderName] = useState("");
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedStatus, setSubmittedStatus] = useState<InstapaySubmissionStatus | null>(null);

  useEffect(() => {
    async function initiate() {
      try {
        const body =
          kind === "pack"
            ? { subjectId }
            : {
                pricingPlanId,
                additionalSubjectsCount: additionalSubjectsCount ? Number(additionalSubjectsCount) : undefined,
                subjectIds: subjectIdsParam ? subjectIdsParam.split(",").filter(Boolean) : undefined,
              };
        const path = kind === "pack" ? "/instapay/question-pack/initiate" : "/instapay/subscription/initiate";
        const result = await apiFetch<InitiateResult>(path, { method: "POST", body: JSON.stringify(body) });
        setInitiated(result);
        setAmount(String(result.expectedAmountEGP));
      } catch (err: any) {
        setError(err?.status === 503 ? copy.notConfigured : copy.genericError);
      } finally {
        setLoading(false);
      }
    }
    initiate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    if (!file) { setReceipt(null); return; }
    if (!["image/jpeg", "image/png"].includes(file.type)) { setError(copy.invalidFile); setReceipt(null); return; }
    if (file.size > MAX_RECEIPT_BYTES) { setError(copy.fileTooLarge); setReceipt(null); return; }
    setReceipt(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!initiated) return;
    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) { setError(copy.amountRequired); return; }
    if (!receipt) { setError(copy.invalidFile); return; }

    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("referenceId", initiated.referenceId);
      form.append("submittedAmountEGP", String(amountNumber));
      if (senderName.trim()) form.append("senderName", senderName.trim());
      if (note.trim()) form.append("note", note.trim());
      form.append("receipt", receipt);
      const result = await apiFetch<{ status: InstapaySubmissionStatus }>("/instapay/submissions", { method: "POST", body: form });
      setSubmittedStatus(result.status);
    } catch (err: any) {
      setError(err?.message?.includes("already been submitted") ? err.message : copy.genericError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Navbar locale={locale} copy={navCopy} />
      <main className="flex min-h-[70vh] flex-col items-center py-10">
        <SmartifyContainer className="max-w-lg">
          <h1 className="text-2xl font-bold text-navy-900">{copy.instructionsTitle}</h1>

          {loading && <p className="mt-6 text-sm text-neutral-500">{copy.openingInstapay}</p>}

          {!loading && error && !initiated && (
            <div className="mt-6 rounded-sf-lg border border-error-200 bg-error-50 p-4 text-sm text-error-600">{error}</div>
          )}

          {initiated && !submittedStatus && (
            <>
              <div className="mt-6 space-y-2 rounded-sf-lg border border-neutral-200 bg-white p-6 text-sm">
                <p><span className="text-neutral-500">{copy.recipientLabel}: </span><span className="font-semibold">{initiated.recipientName} — {initiated.recipientHandle}</span></p>
                <p><span className="text-neutral-500">{copy.expectedAmountLabel}: </span><span className="font-semibold">{initiated.expectedAmountEGP} EGP</span></p>
                <p><span className="text-neutral-500">{copy.referenceLabel}: </span><span className="font-mono font-semibold">{initiated.referenceId}</span></p>
                <p className="text-neutral-500">{isAr ? initiated.instructionsAr : initiated.instructionsEn}</p>
                <p className="text-xs text-neutral-400">{copy.referenceHint}</p>
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="mb-1 block text-sm text-neutral-600">{copy.amountLabel}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-sf border border-neutral-300 px-4 py-2"
                    disabled={submitting}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-neutral-600">{copy.senderNameLabel}</label>
                  <input
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    className="w-full rounded-sf border border-neutral-300 px-4 py-2"
                    disabled={submitting}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-neutral-600">{copy.noteLabel}</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full rounded-sf border border-neutral-300 px-4 py-2"
                    disabled={submitting}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-neutral-600">{copy.receiptLabel}</label>
                  <input type="file" accept="image/jpeg,image/png" onChange={handleFileChange} disabled={submitting} />
                  <p className="mt-1 text-xs text-neutral-400">{copy.receiptHint}</p>
                </div>

                {error && <p className="text-sm text-error-500">{error}</p>}

                <SmartifyButton type="submit" variant="ai" disabled={submitting || !receipt}>
                  {submitting ? copy.submittingLabel : copy.submitLabel}
                </SmartifyButton>
              </form>
            </>
          )}

          {submittedStatus && (
            <div className="mt-6 rounded-sf-lg border border-neutral-200 bg-white p-6 text-center">
              <h2 className="text-lg font-semibold text-navy-900">{copy.submitSuccessTitle}</h2>
              <p className="mt-2 text-sm text-neutral-500">{copy.submitSuccessBody}</p>
              <p className="mt-4 text-sm font-medium text-sf-purple-600">{copy.status[submittedStatus]}</p>
            </div>
          )}

          <Link href={`/${locale}/billing`} className="mt-6 inline-block text-sm text-sf-blue-500">
            {copy.backToBilling}
          </Link>
        </SmartifyContainer>
      </main>
    </>
  );
}
