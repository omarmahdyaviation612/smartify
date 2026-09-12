import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Smartify AI", template: "%s | Smartify AI" },
};

// Top-level layout only wraps ClerkProvider — <html>/<body> and lang/dir
// live in app/[locale]/layout.tsx, since dir="rtl"/"ltr" depends on locale.
export default function RootLayout({ children }: { children: ReactNode }) {
  return <ClerkProvider>{children}</ClerkProvider>;
}
