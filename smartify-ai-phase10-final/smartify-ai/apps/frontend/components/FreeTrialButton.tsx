"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { SmartifyButton } from "@smartify/ui";
import type { Locale } from "@/content/marketing";

interface FreeTrialButtonProps {
  locale: Locale;
  label: string;
  notSignedInMessage?: string;
}

export function FreeTrialButton({ locale, label, notSignedInMessage = "يجب عليك التسجيل أولاً" }: FreeTrialButtonProps) {
  const router = useRouter();
  const { isSignedIn } = useAuth();

  const handleClick = () => {
    if (!isSignedIn) {
      alert(notSignedInMessage);
      router.push(`/${locale}/sign-up`);
    } else {
      router.push(`/${locale}/free-trial`);
    }
  };

  return (
    <SmartifyButton variant="secondary" onClick={handleClick}>
      {label}
    </SmartifyButton>
  );
}
