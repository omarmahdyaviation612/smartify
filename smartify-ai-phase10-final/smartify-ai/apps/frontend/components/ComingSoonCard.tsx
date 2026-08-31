export function ComingSoonCard({ title, body, badgeLabel }: { title: string; body: string; badgeLabel: string }) {
  return (
    <div className="rounded-sf-lg border border-dashed border-neutral-300 bg-neutral-50 p-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-navy-900">{title}</h3>
        <span className="rounded-full bg-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600">{badgeLabel}</span>
      </div>
      <p className="text-sm text-neutral-500">{body}</p>
    </div>
  );
}
