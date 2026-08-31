"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { getBillingCopy } from "@/content/billing";
import { getMarketingCopy } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import type { Locale } from "@/content/marketing";

export default function BillingSuccessPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const copy = getBillingCopy(locale);
  const navCopy = getMarketingCopy(locale);

  return (
    <>
      <Navbar locale={locale} copy={navCopy} />
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <SmartifyContainer className="flex flex-col items-center gap-4">
          <h1 className="text-2xl font-bold text-navy-900">{copy.successTitle}</h1>
          <p className="max-w-md text-neutral-600">{copy.successBody}</p>
          <Link href={`/${locale}/billing`}>
            <SmartifyButton variant="ai">{copy.backToBilling}</SmartifyButton>
          </Link>
        </SmartifyContainer>
      </main>
    </>
  );
}
