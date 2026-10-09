"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
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
interface CurriculumStatusSummary {
  summary: {
    subjects: number;
    units: number;
    groundedUnits: number;
    topics: number;
    generatedTopics: number;
    textbookGroundedTopics: number;
  };
}
interface GrowthSummary {
  trialUsers: number;
  trialLessonsConsumed: number;
  referralsCreated: number;
  successfulReferrals: number;
  referralRewardsIssued: number;
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
  const { signOut } = useClerk();
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pendingInstapay, setPendingInstapay] = useState(0);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [curriculumSummary, setCurriculumSummary] = useState<CurriculumStatusSummary["summary"] | null>(null);
  const [growth, setGrowth] = useState<GrowthSummary | null>(null);
  const [newReceiptAlert, setNewReceiptAlert] = useState(false);
  const lastPendingCount = useRef<number | null>(null);

  useEffect(() => {
    apiFetch<RevenueSummary>("/admin/revenue/summary")
      .then(setSummary)
      .catch(() => setForbidden(true));
    apiFetch<{ count: number }>("/admin/instapay/pending-count")
      .then((res) => { lastPendingCount.current = res.count; setPendingInstapay(res.count); })
      .catch(() => {});
    apiFetch<Array<unknown>>("/users")
      .then((res) => setUserCount(res.length))
      .catch(() => {});
    apiFetch<CurriculumStatusSummary>("/admin/curriculum/status")
      .then((res) => setCurriculumSummary(res.summary))
      .catch(() => {});
    apiFetch<GrowthSummary>("/admin/revenue/growth-summary")
      .then(setGrowth)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      apiFetch<{ count: number }>("/admin/instapay/pending-count")
        .then((res) => {
          if (!active) return;
          if (lastPendingCount.current !== null && res.count > lastPendingCount.current) setNewReceiptAlert(true);
          lastPendingCount.current = res.count;
          setPendingInstapay(res.count);
        })
        .catch(() => {})
        .finally(() => { inFlight = false; });
    }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [apiFetch]);

  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN", "CONTENT_MANAGER", "SUPPORT"]}>
      <main className="py-12">
        <SmartifyContainer>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-navy-900">Admin</h1>
            <button
              type="button"
              onClick={() => signOut({ redirectUrl: `/${locale}` })}
              className="rounded-sf border border-neutral-200 px-4 py-2 text-sm font-medium text-error-500 hover:border-error-500 hover:text-error-600"
            >
              {locale === "ar" ? "تسجيل الخروج" : "Sign out"}
            </button>
          </div>

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

          {newReceiptAlert && <div role="status" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-sf-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><span>{locale === "ar" ? "وصلت إيصالات دفع جديدة للمراجعة." : "New payment receipts are waiting for review."}</span><div className="flex gap-3"><Link className="font-semibold underline" href={`/${locale}/admin/instapay`}>{locale === "ar" ? "مراجعة الإيصالات" : "Review receipts"}</Link><button type="button" onClick={() => setNewReceiptAlert(false)}>{locale === "ar" ? "إخفاء" : "Dismiss"}</button></div></div>}

          {(userCount != null || curriculumSummary) && (
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              {userCount != null && (
                <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                  <p className="text-sm text-neutral-500">Users</p>
                  <p className="mt-1 text-2xl font-bold text-navy-900">{userCount}</p>
                </div>
              )}
              {curriculumSummary && (
                <>
                  <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                    <p className="text-sm text-neutral-500">Subjects</p>
                    <p className="mt-1 text-2xl font-bold text-navy-900">{curriculumSummary.subjects}</p>
                  </div>
                  <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                    <p className="text-sm text-neutral-500">Units</p>
                    <p className="mt-1 text-2xl font-bold text-navy-900">{curriculumSummary.units}</p>
                  </div>
                  <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                    <p className="text-sm text-neutral-500">Topics</p>
                    <p className="mt-1 text-2xl font-bold text-navy-900">{curriculumSummary.topics}</p>
                  </div>
                </>
              )}
            </div>
          )}

          {growth && (
            <div className="mt-4 grid gap-4 sm:grid-cols-5">
              <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                <p className="text-sm text-neutral-500">Trial users</p>
                <p className="mt-1 text-2xl font-bold text-navy-900">{growth.trialUsers}</p>
              </div>
              <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                <p className="text-sm text-neutral-500">Trial lessons consumed</p>
                <p className="mt-1 text-2xl font-bold text-navy-900">{growth.trialLessonsConsumed}</p>
              </div>
              <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                <p className="text-sm text-neutral-500">Referrals created</p>
                <p className="mt-1 text-2xl font-bold text-navy-900">{growth.referralsCreated}</p>
              </div>
              <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                <p className="text-sm text-neutral-500">Successful referrals</p>
                <p className="mt-1 text-2xl font-bold text-navy-900">{growth.successfulReferrals}</p>
              </div>
              <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                <p className="text-sm text-neutral-500">Rewards issued</p>
                <p className="mt-1 text-2xl font-bold text-navy-900">{growth.referralRewardsIssued}</p>
              </div>
            </div>
          )}

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <AdminNavCard href={`/${locale}/admin/users`} title="Users" body="View accounts and manage roles." />
            <AdminNavCard
              href={`/${locale}/admin/curriculum`}
              title="Curriculum & Subject Pricing"
              body="Manage grades, subjects, and each subject's own EGP price."
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
            <AdminNavCard href={`/${locale}/admin/parent-notifications`} title="Parent result notifications" body="Review failed result emails and retry delivery." />
            <AdminNavCard href={`/${locale}/admin/teacher-requests`} title="Teacher session requests" body="Review requests and confirm a booking after coordination." />
            <AdminNavCard href={`/${locale}/admin/support`} title={locale === "ar" ? "الدعم الفني" : "Technical support"} body={locale === "ar" ? "مراجعة مشكلات الطلاب والرد عليها." : "Review student issues and reply to support requests."} />
            <AdminNavCard
              href={`/${locale}/admin/ai-usage`}
              title="AI Cost & Budget"
              body="Platform and per-student AI spend, budgets, and Subject breakdowns (Super Admin only)."
            />
            <AdminNavCard
              href={`/${locale}/admin/referrals`}
              title="Referrals"
              body="Inspect referral/reward records (Super Admin only)."
            />
          </div>
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
