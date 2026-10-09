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

interface BudgetStatus {
  globalBudgetUsd: number | null;
  perUserBudgetUsd: number | null;
  platformContentAuthoringDailyBudgetUsd: number | null;
  studentSupportDailyBudgetUsd: number | null;
  dailyQuestionsPerSubject: number;
  globalSpentTodayUsd: number;
  globalRemainingUsd: number | null;
}

/**
 * SUPER_ADMIN AI spending controls (Phase 9.4B). Reuses the existing
 * admin/ai-config area and its SystemConfig-backed budget/usage
 * infrastructure — no new admin system, no new analytics pipeline.
 * Today's spend and remaining-budget figures come straight from
 * AdminAIConfigService.getBudgetStatus(), which itself reuses
 * AIUsageService.getGlobalSpendToday() — the exact same number the
 * runtime circuit breaker checks, not a separately-computed approximation.
 */
function AISpendingControlsSection() {
  const { apiFetch } = useApiClient();
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [globalInput, setGlobalInput] = useState("");
  const [perUserInput, setPerUserInput] = useState("");
  const [platformInput, setPlatformInput] = useState("");
  const [supportInput, setSupportInput] = useState("");
  const [dailyQuestionsInput, setDailyQuestionsInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function applyStatus(s: BudgetStatus) {
    setStatus(s);
    setGlobalInput(s.globalBudgetUsd === null ? "" : String(s.globalBudgetUsd));
    setPerUserInput(s.perUserBudgetUsd === null ? "" : String(s.perUserBudgetUsd));
    setPlatformInput(s.platformContentAuthoringDailyBudgetUsd === null ? "" : String(s.platformContentAuthoringDailyBudgetUsd));
    setSupportInput(s.studentSupportDailyBudgetUsd === null ? "" : String(s.studentSupportDailyBudgetUsd));
    setDailyQuestionsInput(String(s.dailyQuestionsPerSubject));
  }

  useEffect(() => {
    apiFetch<BudgetStatus>("/admin/ai-config/budget-status").then(applyStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setError(null);
    const globalDailyBudgetUsd = Number(globalInput);
    const perUserDailyBudgetUsd = Number(perUserInput);
    const platformContentAuthoringDailyBudgetUsd = Number(platformInput);
    const studentSupportDailyBudgetUsd = Number(supportInput);
    const dailyQuestionsPerSubject = Number(dailyQuestionsInput);

    if (!Number.isFinite(globalDailyBudgetUsd) || globalDailyBudgetUsd <= 0) {
      setError("Global daily AI budget must be a positive number.");
      return;
    }
    if (!Number.isFinite(perUserDailyBudgetUsd) || perUserDailyBudgetUsd <= 0) {
      setError("Per-user daily AI budget must be a positive number.");
      return;
    }
    if (perUserDailyBudgetUsd > globalDailyBudgetUsd) {
      setError("Per-user daily AI budget cannot exceed the global daily AI budget.");
      return;
    }
    if (!Number.isFinite(platformContentAuthoringDailyBudgetUsd) || platformContentAuthoringDailyBudgetUsd <= 0) {
      setError("Platform content-authoring daily AI budget must be a positive number.");
      return;
    }
    if (platformContentAuthoringDailyBudgetUsd > globalDailyBudgetUsd) {
      setError("Platform content-authoring daily AI budget cannot exceed the global daily AI budget.");
      return;
    }
    if (!Number.isFinite(studentSupportDailyBudgetUsd) || studentSupportDailyBudgetUsd <= 0 || studentSupportDailyBudgetUsd > globalDailyBudgetUsd) { setError("Student support AI budget must be positive and cannot exceed the global budget."); return; }
    if (!Number.isInteger(dailyQuestionsPerSubject) || dailyQuestionsPerSubject <= 0) {
      setError("Daily AI questions per subject must be a positive whole number.");
      return;
    }

    setSaving(true);
    try {
      const updated = await apiFetch<BudgetStatus>("/admin/ai-config/spending-controls", {
        method: "PATCH",
        body: JSON.stringify({ globalDailyBudgetUsd, perUserDailyBudgetUsd, platformContentAuthoringDailyBudgetUsd, studentSupportDailyBudgetUsd, dailyQuestionsPerSubject }),
      });
      applyStatus(updated);
    } catch (err: any) {
      setError(err?.message ?? "Could not save AI spending controls.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 rounded-sf-lg border border-neutral-200 bg-white p-6">
      <h2 className="mb-1 font-semibold text-navy-900">AI Spending Controls</h2>
      <p className="mb-4 text-xs text-neutral-500">
        These caps protect against unexpected OpenAI spend. Changes take effect immediately for every new AI/TTS
        request — no deploy or restart needed.
      </p>

      <div className="space-y-4">
        <label className="block max-w-sm">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Global Daily AI Budget (USD)</span>
          <p className="mb-2 text-xs text-neutral-500">Maximum combined AI/TTS spend allowed per day, across all students.</p>
          <input
            type="number"
            step="0.01"
            min="0"
            value={globalInput}
            onChange={(e) => setGlobalInput(e.target.value)}
            className="w-full rounded-sf border border-neutral-300 px-3 py-2"
          />
        </label>

        <label className="block max-w-sm">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Per-User Daily AI Budget (USD)</span>
          <p className="mb-2 text-xs text-neutral-500">Maximum AI/TTS spend one user may consume per day. Must not exceed the global budget.</p>
          <input
            type="number"
            step="0.01"
            min="0"
            value={perUserInput}
            onChange={(e) => setPerUserInput(e.target.value)}
            className="w-full rounded-sf border border-neutral-300 px-3 py-2"
          />
        </label>

        <label className="block max-w-sm">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Platform Content-Authoring Daily AI Budget (USD)</span>
          <p className="mb-2 text-xs text-neutral-500">
            Independent cap for shared platform work (Unit grounding, lazy lesson/question generation) — never drawn
            from any single student&apos;s cap. Must not exceed the global budget.
          </p>
          <input
            type="number"
            step="0.01"
            min="0"
            value={platformInput}
            onChange={(e) => setPlatformInput(e.target.value)}
            className="w-full rounded-sf border border-neutral-300 px-3 py-2"
          />
        </label>

        <label className="block max-w-sm">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Student Technical Support Daily AI Budget (USD)</span>
          <p className="mb-2 text-xs text-neutral-500">Independent feature cap; human escalation remains available when reached.</p>
          <input type="number" step="0.01" min="0" value={supportInput} onChange={(e) => setSupportInput(e.target.value)} className="w-full rounded-sf border border-neutral-300 px-3 py-2" />
        </label>

        <label className="block max-w-sm">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Daily AI Questions Per Subject</span>
          <p className="mb-2 text-xs text-neutral-500">
            Educational usage limit (included AI questions per subject per day) — separate from the USD spending caps above.
          </p>
          <input
            type="number"
            step="1"
            min="1"
            value={dailyQuestionsInput}
            onChange={(e) => setDailyQuestionsInput(e.target.value)}
            className="w-full rounded-sf border border-neutral-300 px-3 py-2"
          />
        </label>

        {error && <p className="text-sm text-error-500">{error}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="rounded-sf bg-sf-blue-500 px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {status && (
        <div className="mt-6 border-t border-neutral-100 pt-4 text-sm">
          <p className="text-neutral-600">
            Today&apos;s AI spend: <span className="font-medium text-navy-900">${status.globalSpentTodayUsd.toFixed(4)}</span>
          </p>
          <p className="text-neutral-600">
            Global budget remaining:{" "}
            <span className="font-medium text-navy-900">
              {status.globalRemainingUsd === null ? "No global cap set" : `$${status.globalRemainingUsd.toFixed(4)}`}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

interface TtsConfig {
  provider: string;
  model: string;
  voice: string;
}

/**
 * Read-only — no voice switching UI in this phase (B11). The existing
 * generic system-config/:key GET endpoint already serves this; no new
 * backend surface needed.
 */
function TtsInfoSection() {
  const { apiFetch } = useApiClient();
  const [tts, setTts] = useState<TtsConfig | null>(null);

  useEffect(() => {
    apiFetch<{ value: TtsConfig }>("/admin/ai-config/system-config/tts_config")
      .then((c) => setTts(c?.value ?? null))
      .catch(() => setTts(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!tts) return null;

  return (
    <div className="mt-6 rounded-sf-lg border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 font-semibold text-navy-900">Voice (TTS)</h2>
      <div className="space-y-1 text-sm">
        <p className="text-neutral-600">
          TTS Model: <span className="font-medium text-navy-900">{tts.model}</span>
        </p>
        <p className="text-neutral-600">
          Selected Voice: <span className="font-medium text-navy-900">{tts.voice}</span>
        </p>
      </div>
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
            <AISpendingControlsSection />
            <TtsInfoSection />
          </div>
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
