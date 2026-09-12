"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { SmartifyButton } from "@smartify/ui";
import type { Locale } from "@/content/marketing";

interface SubscribeNowButtonProps {
  locale: Locale;
  label: string;
  planId: string;
  notSignedInMessage?: string;
}

/**
 * Mirrors FreeTrialButton's existing not-signed-in handling for
 * consistency. When the visitor is already signed in, the chosen plan ID
 * is carried into /billing so they don't have to re-pick it — billing's
 * own plan list still validates the ID belongs to their curriculum before
 * using it, so this is just a convenience default, never a trust boundary.
 */
export function SubscribeNowButton({ locale, label, planId, notSignedInMessage = "يجب عليك التسجيل أولاً" }: SubscribeNowButtonProps) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const handleClick = () => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      alert(notSignedInMessage);
      router.push(`/${locale}/sign-up`);
      return;
    }

    router.push(`/${locale}/billing?planId=${planId}`);
  };

  return (
    <SmartifyButton variant="ai" onClick={handleClick} className="mt-4 w-full">
      {label}
    </SmartifyButton>
  );
}
