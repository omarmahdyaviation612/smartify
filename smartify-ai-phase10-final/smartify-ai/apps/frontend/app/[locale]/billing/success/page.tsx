"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getBillingCopy } from "@/content/billing";
import { getMarketingCopy } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import type { Locale } from "@/content/marketing";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useApiClient } from "@/lib/api-client";
import { getPaymentStatusCopy, type PaymentStatus } from "@/content/payment-status";

export default function BillingSuccessPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const copy = getBillingCopy(locale);
  const navCopy = getMarketingCopy(locale);
  const statusCopy = getPaymentStatusCopy(locale);
  const { isLoaded, isSignedIn } = useAuth();
  const { apiFetch } = useApiClient();
  const [status, setStatus] = useState<PaymentStatus>("checking");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { setStatus("unverified"); return; }
    let active = true;
    setStatus("checking");
    apiFetch<{ status: string }>("/billing/payment-status", { cache: "no-store" })
      .then((result) => {
        if (active) setStatus(["verified", "pending", "failed"].includes(result?.status) ? result.status as PaymentStatus : "unverified");
      })
      .catch(() => { if (active) setStatus("unverified"); });
    return () => { active = false; };
    // apiFetch wraps Clerk's current getToken; auth transitions and explicit retries drive this check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, retry]);

  return (
    <>
      <Navbar locale={locale} copy={navCopy} />
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <SmartifyContainer className="flex flex-col items-center gap-4">
          <div role="status" aria-live="polite" data-payment-status={status}>
            <h1 className="text-2xl font-bold text-navy-900">{statusCopy[status][0]}</h1>
            <p className="mt-4 max-w-md text-neutral-600">{statusCopy[status][1]}</p>
          </div>
          {status !== "verified" && <SmartifyButton variant="secondary" disabled={status === "checking"} onClick={() => setRetry((n) => n + 1)}>{statusCopy.retry}</SmartifyButton>}
          <Link href={`/${locale}/billing`}>
            <SmartifyButton variant="ai">{copy.backToBilling}</SmartifyButton>
          </Link>
        </SmartifyContainer>
      </main>
    </>
  );
}
