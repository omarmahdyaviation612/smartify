"use client";

// Dependency-free chart primitives for the admin analytics pages (2026-10-11):
// plain HTML/SVG bars, so no charting library is added to the bundle.

export const usd = (v: number | null | undefined) =>
  v == null ? "—" : v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
export const egp = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v).toLocaleString()} EGP`);
export const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
export const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString() : "—");
export const fmtDateTime = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "—");
export const compact = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));

export function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-sf-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-navy-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

export function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-sf-lg border border-neutral-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-navy-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Horizontal bars, largest first. */
export function BarList({ rows, format = (v: number) => String(v), empty = "No data yet." }: { rows: Array<{ key: string; value: number }>; format?: (v: number) => string; empty?: string }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <div className="flex justify-between gap-3">
            <span className="truncate text-neutral-700" title={r.key}>{r.key}</span>
            <span className="shrink-0 tabular-nums font-medium text-navy-900">{format(r.value)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-neutral-100">
            <div className="h-2 rounded-full bg-sf-blue-500" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Daily vertical bars with a hover title per day. */
export function DailyColumns({ points, format = (v: number) => String(v), height = 120 }: { points: Array<{ day: string; value: number }>; format?: (v: number) => string; height?: number }) {
  const max = Math.max(...points.map((p) => p.value), 0);
  const total = points.reduce((s, p) => s + p.value, 0);
  if (max === 0) return <p className="text-sm text-neutral-500">Nothing in this period.</p>;
  const w = 100 / points.length;
  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-32 w-full" role="img" aria-label={`Total ${format(total)}`}>
        {points.map((p, i) => {
          const h = (p.value / max) * (height - 4);
          return (
            <rect key={p.day} x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={h} rx={0.6} className="fill-sf-blue-500">
              <title>{`${p.day}: ${format(p.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-neutral-400">
        <span>{points[0]?.day}</span>
        <span>max {format(max)} / day</span>
        <span>{points[points.length - 1]?.day}</span>
      </div>
    </div>
  );
}

export function Funnel({ steps }: { steps: Array<{ stage: string; count: number }> }) {
  const top = steps[0]?.count || 1;
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].count : null;
        return (
          <li key={s.stage} className="text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-neutral-700">{s.stage}</span>
              <span className="tabular-nums text-navy-900">
                <strong>{s.count}</strong>
                <span className="ms-2 text-xs text-neutral-500">{pct(s.count / top)} of all{prev ? ` · ${pct(prev ? s.count / prev : 0)} of previous` : ""}</span>
              </span>
            </div>
            <div className="mt-1 h-3 rounded-full bg-neutral-100">
              <div className="h-3 rounded-full bg-sf-purple-600" style={{ width: `${Math.max(2, (s.count / top) * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  const styles: Record<string, string> = {
    paid: "bg-success-100 text-success-500",
    trial: "bg-amber-100 text-amber-800",
    registered: "bg-neutral-100 text-neutral-600",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[stage] ?? styles.registered}`}>{stage}</span>;
}
