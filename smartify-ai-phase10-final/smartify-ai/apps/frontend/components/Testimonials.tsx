import { SmartifyContainer } from "@smartify/ui";

export interface Testimonial {
  id: string;
  quote: string;
  authorName: string;
  authorContext: string; // e.g. "Parent, Cairo" — only ever real, submitted data
  avatarUrl?: string;
}

/**
 * Reusable testimonials section, ready to receive REAL testimonials once
 * they exist. Deliberately renders nothing (not even a skeleton section)
 * when the list is empty — no fabricated reviews are ever shown, and no
 * placeholder is rendered pretending social proof exists.
 *
 * Data source for `testimonials` is intentionally left to the caller —
 * wire it to a DB table or CMS query once real submissions exist.
 */
export function Testimonials({ testimonials, title }: { testimonials: Testimonial[]; title: string }) {
  if (testimonials.length === 0) return null;

  return (
    <section className="py-20">
      <SmartifyContainer>
        <h2 className="mb-10 text-center text-3xl font-bold text-navy-900">{title}</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <blockquote key={t.id} className="rounded-sf-lg border border-neutral-200 bg-white p-6 shadow-[--sf-shadow-sm]">
              <p className="text-neutral-700">&quot;{t.quote}&quot;</p>
              <footer className="mt-4 text-sm font-medium text-navy-900">
                {t.authorName} <span className="font-normal text-neutral-500">— {t.authorContext}</span>
              </footer>
            </blockquote>
          ))}
        </div>
      </SmartifyContainer>
    </section>
  );
}
