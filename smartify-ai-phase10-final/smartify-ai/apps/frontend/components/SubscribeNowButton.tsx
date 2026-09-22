"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { SmartifyButton } from "@smartify/ui";
import type { Locale } from "@/content/marketing";

interface SubscribeNowButtonProps {
  locale: Locale;
  label: string;
  notSignedInMessage?: string;
}

/**
 * Mirrors FreeTrialButton's existing not-signed-in handling for
 * consistency. Subject-based pricing (2026-09-20) — there is no plan ID
 * to carry forward anymore; a signed-in visitor is sent straight to
 * /billing, where they pick their own subjects from their real grade.
 */
export function SubscribeNowButton({ locale, label, notSignedInMessage = "يجب عليك التسجيل أولاً" }: SubscribeNowButtonProps) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const handleClick = () => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      alert(notSignedInMessage);
      router.push(`/${locale}/sign-up`);
      return;
    }

    router.push(`/${locale}/billing`);
  };

  return (
    <SmartifyButton variant="ai" onClick={handleClick} className="mt-4 w-full">
      {label}
    </SmartifyButton>
  );
}
