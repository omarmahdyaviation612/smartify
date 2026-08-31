"use client";

import Image from "next/image";
import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import type { Locale, MarketingCopy } from "@/content/marketing";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useCurrentUser } from "@/lib/use-current-user";

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "CONTENT_MANAGER", "SUPPORT"];

export function Navbar({ locale, copy }: { locale: Locale; copy: MarketingCopy }) {
  const base = `/${locale}`;
  const { user } = useCurrentUser();
  const isAdmin = user && ADMIN_ROLES.includes(user.role);

  return (
    <header className="sticky top-0 z-[--sf-z-sticky] border-b border-neutral-200 bg-white/90 backdrop-blur">
      <SmartifyContainer className="flex h-20 items-center justify-between">
        <Link href={base} className="flex items-center gap-2">
          <Image src="/brand/smartify-logo.png" alt="Smartify AI" width={40} height={40} priority />
          <span className="text-lg font-bold text-navy-900">Smartify AI</span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-neutral-700 md:flex">
          <Link href={`${base}/#features`}>{copy.nav.features}</Link>
          <Link href={`${base}/#how-it-works`}>{copy.nav.howItWorks}</Link>
          <Link href={`${base}/curricula`}>{copy.nav.curricula}</Link>
          <Link href={`${base}/pricing`}>{copy.nav.pricing}</Link>
          <Link href={`${base}/for-parents`}>{copy.nav.forParents}</Link>
        </nav>

        <div className="flex items-center gap-3">
          <LanguageSwitcher currentLocale={locale} />

          <SignedOut>
            <Link href={`${base}/sign-in`} className="hidden text-sm font-medium text-neutral-700 sm:block">
              {copy.nav.login}
            </Link>
            <Link href={`${base}/sign-up`}>
              <SmartifyButton variant="ai">{copy.nav.getStarted}</SmartifyButton>
            </Link>
          </SignedOut>

          <SignedIn>
            {isAdmin && (
              <Link href={`${base}/admin`} className="hidden text-sm font-medium text-sf-purple-600 sm:block">
                Admin
              </Link>
            )}
            <Link href={`${base}/dashboard`} className="hidden text-sm font-medium text-neutral-700 sm:block">
              {locale === "ar" ? "لوحة التحكم" : "Dashboard"}
            </Link>
            <UserButton afterSignOutUrl={base} />
          </SignedIn>
        </div>
      </SmartifyContainer>
    </header>
  );
}
