"use client";

import { useEffect, useState } from "react";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { useApiClient } from "@/lib/api-client";

interface AIProviderConfig {
  providerKey: string;
  model: string;
  isActive: boolean;
  costPerInputToken: string;
  costPerOutputToken: string;
}
interface PaymentProviderConfig {
  providerKey: string;
  isActive: boolean;
  publicConfig?: { role?: string; hidden?: boolean; productionApproved?: boolean } | null;
}

const IMPLEMENTED_PROVIDERS = ["stripe"]; // only these have a real PaymentProvider implementation today

const PROVIDER_STATUS_LABEL: Record<string, string> = {
  stripe: "Development/test provider only — not production-approved",
  fawry: "Planned production provider — not yet integrated (pending official Fawry docs & credentials)",
  paymob: "Not the current production target",
  paypal: "Not implemented",
};
interface UsageSummary {
  windowDays: number;
  totalRequests: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byFeature: Record<string, { requests: number; costUsd: number }>;
}

function AIProvidersSection() {
  const { apiFetch } = useApiClient();
  const [providers, setProviders] = useState<AIProviderConfig[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    apiFetch<AIProviderConfig[]>("/admin/ai-config/providers").then(setProviders);
    apiFetch<UsageSummary>("/admin/ai-config/usage-summary?days=30").then(setUsage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function activate(providerKey: string) {
    await apiFetch(`/admin/ai-config/providers/${providerKey}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) });
    setProviders((prev) => prev.map((p) => ({ ...p, isActive: p.providerKey === providerKey })));
  }

  return (
    <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 font-semibold text-navy-900">AI Provider</h2>
      <div className="space-y-2">
        {providers.map((p) => (
          <div key={p.providerKey} className="flex items-center justify-between rounded-sf border border-neutral-100 px-4 py-3 text-sm">
            <div>
              <p className="font-medium text-navy-900">
                {p.providerKey} {p.isActive && <span className="text-success-500">(active)</span>}
              </p>
              <p className="text-neutral-500">
                {p.model} · ${p.costPerInputToken}/input tok · ${p.costPerOutputToken}/output tok
              </p>
            </div>
            {!p.isActive && (
              <button onClick={() => activate(p.providerKey)} className="rounded-sf bg-sf-blue-500 px-3 py-1 text-xs text-white">
                Activate
              </button>
            )}
          </div>
        ))}
      </div>

      {usage && (
        <div className="mt-6 border-t border-neutral-100 pt-4 text-sm">
          <h3 className="mb-2 font-semibold text-navy-900">Usage (last {usage.windowDays} days)</h3>
          <p className="text-neutral-600">
            {usage.totalRequests} requests · ${usage.totalCostUsd.toFixed(4)} total cost
          </p>
          <p className="text-neutral-500">
            {usage.totalInputTokens} input tokens · {usage.totalOutputTokens} output tokens
          </p>
          <ul className="mt-2 space-y-1 text-neutral-500">
            {Object.entries(usage.byFeature).map(([feature, stats]) => (
              <li key={feature}>
                {feature}: {stats.requests} requests, ${stats.costUsd.toFixed(4)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PaymentProvidersSection() {
  const { apiFetch } = useApiClient();
  const [providers, setProviders] = useState<PaymentProviderConfig[]>([]);

  useEffect(() => {
    apiFetch<PaymentProviderConfig[]>("/admin/payments/providers").then((data) =>
      // InstaPay stays hidden from the admin panel until its integration
      // requirements are available — per the current provider roadmap.
      setProviders(data.filter((p) => p.providerKey !== "instapay")),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function activate(providerKey: string) {
    await apiFetch(`/admin/payments/providers/${providerKey}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) });
    setProviders((prev) => prev.map((p) => ({ ...p, isActive: p.providerKey === providerKey })));
  }

  return (
    <div className="mt-6 rounded-sf-lg border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 font-semibold text-navy-900">Payment Provider</h2>
      <p className="mb-4 text-xs text-neutral-400">
        Activating a provider here only changes routing — the matching secret env vars (e.g. STRIPE_SECRET_KEY) must
        also be set on the backend, or requests will fail with a clear &quot;not configured&quot; error. Only providers with a
        real implementation can be activated; others are shown for roadmap visibility only.
      </p>
      <div className="space-y-2">
        {providers.map((p) => (
          <div key={p.providerKey} className="rounded-sf border border-neutral-100 px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium text-navy-900">
                {p.providerKey} {p.isActive && <span className="text-success-500">(active)</span>}
              </p>
              {!p.isActive && IMPLEMENTED_PROVIDERS.includes(p.providerKey) && (
                <button onClick={() => activate(p.providerKey)} className="rounded-sf bg-sf-blue-500 px-3 py-1 text-xs text-white">
                  Activate
                </button>
              )}
              {!IMPLEMENTED_PROVIDERS.includes(p.providerKey) && (
                <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-500">Not implemented</span>
              )}
            </div>
            {PROVIDER_STATUS_LABEL[p.providerKey] && (
              <p className="mt-1 text-xs text-neutral-500">{PROVIDER_STATUS_LABEL[p.providerKey]}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SystemConfigSection() {
  const { apiFetch } = useApiClient();
  const [dailyLimit, setDailyLimit] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<{ value: number }>("/admin/ai-config/system-config/default_daily_ai_questions_per_subject").then((c) =>
      setDailyLimit(c.value),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (dailyLimit === null) return;
    await apiFetch("/admin/ai-config/system-config/default_daily_ai_questions_per_subject", {
      method: "PATCH",
      body: JSON.stringify({ value: dailyLimit }),
    });
  }

  return (
    <div className="mt-6 rounded-sf-lg border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 font-semibold text-navy-900">System Config</h2>
      <label className="block max-w-xs">
        <span className="mb-2 block text-sm font-medium text-neutral-700">Daily AI questions per subject</span>
        <div className="flex gap-2">
          <input
            type="number"
            value={dailyLimit ?? ""}
            onChange={(e) => setDailyLimit(Number(e.target.value))}
            className="w-full rounded-sf border border-neutral-300 px-3 py-2"
          />
          <button onClick={save} className="rounded-sf bg-sf-blue-500 px-4 py-2 text-sm text-white">
            Save
          </button>
        </div>
      </label>
    </div>
  );
}

export default function AdminPlatformPage() {
  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN"]}>
      <main className="py-12">
        <SmartifyContainer className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold text-navy-900">Platform Config</h1>
          <div className="mt-6">
            <AIProvidersSection />
            <PaymentProvidersSection />
            <SystemConfigSection />
          </div>
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
