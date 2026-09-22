"use client";

import { useEffect, useState } from "react";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { useApiClient } from "@/lib/api-client";

// Referral V1 (2026-09-20) — read-only inspection of every Referral row
// via AdminRevenueController's existing /admin/revenue/referrals endpoint
// (SUPER_ADMIN only, same as the rest of admin/revenue). No new analytics
// system — this is a plain list of the real, auditable Referral records.

interface ReferralRow {
  id: string;
  code: string;
  createdAt: string;
  referrerName: string;
  referrerEmail: string;
  referredName: string;
  referredEmail: string;
  earnedAt: string | null;
  appliedAt: string | null;
  appliedSubjectNameEn: string | null;
  appliedExpiresAt: string | null;
}

function StatusBadge({ referral }: { referral: ReferralRow }) {
  if (referral.appliedAt) return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Reward applied</span>;
  if (referral.earnedAt) return <span className="rounded-full bg-sf-blue-100 px-2 py-0.5 text-xs font-medium text-sf-blue-700">Reward pending</span>;
  return <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">Not yet activated</span>;
}

export default function AdminReferralsPage() {
  const { apiFetch } = useApiClient();
  const [referrals, setReferrals] = useState<ReferralRow[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    apiFetch<ReferralRow[]>("/admin/revenue/referrals")
      .then(setReferrals)
      .catch(() => setForbidden(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN"]}>
      <main className="py-12">
        <SmartifyContainer>
          <h1 className="text-2xl font-bold text-navy-900">Referrals</h1>
          <p className="mt-2 text-sm text-neutral-500">Every referral ever created, most recent first — reward state is exactly what BillingService/ReferralService recorded, nothing estimated.</p>

          {forbidden && <p className="mt-6 text-sm text-neutral-500">This page requires Super Admin access.</p>}

          {referrals && referrals.length === 0 && <p className="mt-6 text-sm text-neutral-400">No referrals recorded yet.</p>}

          {referrals && referrals.length > 0 && (
            <div className="mt-6 overflow-x-auto rounded-sf-lg border border-neutral-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                    <th className="px-4 py-3">Referrer</th>
                    <th className="px-4 py-3">Referred</th>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Reward Subject</th>
                    <th className="px-4 py-3">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((r) => (
                    <tr key={r.id} className="border-b border-neutral-100">
                      <td className="px-4 py-3">
                        <p className="font-medium text-navy-900">{r.referrerName}</p>
                        <p className="text-xs text-neutral-400">{r.referrerEmail}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-navy-900">{r.referredName}</p>
                        <p className="text-xs text-neutral-400">{r.referredEmail}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                      <td className="px-4 py-3">
                        <StatusBadge referral={r} />
                      </td>
                      <td className="px-4 py-3">{r.appliedSubjectNameEn ?? "—"}</td>
                      <td className="px-4 py-3">{r.appliedExpiresAt ? new Date(r.appliedExpiresAt).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
