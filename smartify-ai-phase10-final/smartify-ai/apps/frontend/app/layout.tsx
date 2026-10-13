import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Smartify AI", template: "%s | Smartify AI" },
  // Installable web app (2026-10-13) — needed for admin push notifications on iPhone,
  // which only work once the site is added to the Home Screen.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Smartify", statusBarStyle: "default" },
  icons: { apple: "/brand/icon-192.png" },
};

// Top-level layout only wraps ClerkProvider — <html>/<body> and lang/dir
// live in app/[locale]/layout.tsx, since dir="rtl"/"ltr" depends on locale.
export default function RootLayout({ children }: { children: ReactNode }) {
  // Clerk Frontend API reverse-proxy (see middleware.ts's /__clerk
  // handling) — undefined in any environment where the env var isn't
  // set (e.g. local dev), which is the same as not passing this prop at
  // all, so unproxied environments are unaffected.
  return <ClerkProvider proxyUrl={process.env.NEXT_PUBLIC_CLERK_PROXY_URL}>{children}</ClerkProvider>;
}
