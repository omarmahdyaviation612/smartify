"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { useApiClient } from "@/lib/api-client";
import type { Locale } from "@/content/marketing";

interface RevenueSummary {
  windowDays: number;
  activeSubscriptionCount: number;
  monthlyRecurringRevenueEGP: number;
  revenueByCurriculumEGP: Record<string, number>;
  aiCostUsdInWindow: number;
  note: string;
}

function AdminNavCard({ href, title, body, badge }: { href: string; title: string; body: string; badge?: number }) {
  return (
    <Link href={href} className="block rounded-sf-lg border border-neutral-200 bg-white p-6 hover:border-sf-blue-500">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-navy-900">{title}</h3>
        {Boolean(badge) && (
          <span className="rounded-full bg-error-500 px-2 py-0.5 text-xs font-semibold text-white">{badge}</span>
        )}
      </div>
      <p className="mt-1 text-sm text-neutral-500">{body}</p>
    </Link>
  );
}

export default function AdminOverviewPage() {
  const { locale } = useParams<{ locale: Locale }>();
  const { apiFetch } = useApiClient();
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pendingInstapay, setPendingInstapay] = useState(0);

  useEffect(() => {
    apiFetch<RevenueSummary>("/admin/revenue/summary")
      .then(setSummary)
      .catch(() => setForbidden(true));
    apiFetch<{ count: number }>("/admin/instapay/pending-count")
      .then((res) => setPendingInstapay(res.count))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN", "CONTENT_MANAGER", "SUPPORT"]}>
      <main className="py-12">
        <SmartifyContainer>
          <h1 className="text-2xl font-bold text-navy-900">Admin</h1>

          {summary && (
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                <p className="text-sm text-neutral-500">Active subscriptions</p>
                <p className="mt-1 text-2xl font-bold text-navy-900">{summary.activeSubscriptionCount}</p>
              </div>
              <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                <p className="text-sm text-neutral-500">Monthly recurring revenue</p>
                <p className="mt-1 text-2xl font-bold text-navy-900">{summary.monthlyRecurringRevenueEGP} EGP</p>
              </div>
              <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                <p className="text-sm text-neutral-500">AI cost ({summary.windowDays}d)</p>
                <p className="mt-1 text-2xl font-bold text-navy-900">${summary.aiCostUsdInWindow.toFixed(4)}</p>
              </div>
              <p className="sm:col-span-3 text-xs text-neutral-400">{summary.note}</p>
            </div>
          )}
          {!summary && forbidden && (
            <p className="mt-6 text-sm text-neutral-500">
              Revenue summary requires Super Admin access — you can still use the sections below.
            </p>
          )}

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <AdminNavCard href={`/${locale}/admin/users`} title="Users" body="View accounts and manage roles." />
            <AdminNavCard
              href={`/${locale}/admin/curriculum`}
              title="Curriculum & Pricing"
              body="Manage grades, subjects, and EGP pricing plans."
            />
            <AdminNavCard
              href={`/${locale}/admin/platform`}
              title="Platform Config"
              body="AI provider, payment provider, and system settings (Super Admin only)."
            />
            <AdminNavCard
              href={`/${locale}/admin/instapay`}
              title="InstaPay Payments"
              body="Review and confirm manual InstaPay payment submissions."
              badge={pendingInstapay}
            />
          </div>
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
