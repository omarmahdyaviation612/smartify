import Link from "next/link";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import type { Locale, MarketingCopy } from "@/content/marketing";
import { FreeTrialButton } from "@/components/FreeTrialButton";

export function Hero({ locale, copy }: { locale: Locale; copy: MarketingCopy }) {
  return (
    <section className="bg-[--sf-bg-subtle] py-24">
      <SmartifyContainer className="flex flex-col items-center text-center">
        <span className="mb-4 rounded-full bg-white px-4 py-1 text-sm font-medium text-sf-purple-600 shadow-[--sf-shadow-sm]">
          {copy.hero.eyebrow}
        </span>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight text-navy-900 sm:text-5xl">
          {copy.hero.headline}
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-neutral-600">{copy.hero.subheadline}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <FreeTrialButton
            locale={locale}
            label={copy.hero.ctaPrimary}
            notSignedInMessage="يجب عليك التسجيل أولاً"
          />
          <Link href={`/${locale}/#how-it-works`}>
            <SmartifyButton variant="secondary">{copy.hero.ctaSecondary}</SmartifyButton>
          </Link>
        </div>
      </SmartifyContainer>
    </section>
  );
}

export function TrustedLearning({ copy }: { copy: MarketingCopy }) {
  return (
    <section className="py-20">
      <SmartifyContainer className="text-center">
        <h2 className="text-3xl font-bold text-navy-900">{copy.trustedLearning.title}</h2>
        <p className="mx-auto mt-4 max-w-2xl text-neutral-600">{copy.trustedLearning.body}</p>
      </SmartifyContainer>
    </section>
  );
}

export function CurriculaSection({ copy }: { copy: MarketingCopy }) {
  return (
    <section id="features" className="bg-neutral-50 py-20">
      <SmartifyContainer>
        <div className="text-center">
          <h2 className="text-3xl font-bold text-navy-900">{copy.curricula.title}</h2>
          <p className="mx-auto mt-4 max-w-2xl text-neutral-600">{copy.curricula.body}</p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {copy.curricula.items.map((item) => (
            <div key={item.title} className="rounded-sf-lg border border-neutral-200 bg-white p-6">
              <h3 className="font-semibold text-navy-900">{item.title}</h3>
              <p className="mt-2 text-sm text-neutral-600">{item.description}</p>
            </div>
          ))}
        </div>
      </SmartifyContainer>
    </section>
  );
}

export function HowItWorksSection({ copy }: { copy: MarketingCopy }) {
  return (
    <section id="how-it-works" className="py-20">
      <SmartifyContainer>
        <h2 className="text-center text-3xl font-bold text-navy-900">{copy.howItWorks.title}</h2>
        <ol className="mt-12 grid gap-8 md:grid-cols-4">
          {copy.howItWorks.steps.map((step, i) => (
            <li key={step.title} className="relative rounded-sf-lg border border-neutral-200 bg-white p-6">
              <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ai-gradient text-sm font-bold text-white">
                {i + 1}
              </span>
              <h3 className="font-semibold text-navy-900">{step.title}</h3>
              <p className="mt-2 text-sm text-neutral-600">{step.description}</p>
            </li>
          ))}
        </ol>
      </SmartifyContainer>
    </section>
  );
}

export function AIPersonalizationSection({ copy }: { copy: MarketingCopy }) {
  return (
    <section className="bg-navy-900 py-20 text-white">
      <SmartifyContainer className="grid items-center gap-10 md:grid-cols-2">
        <div>
          <h2 className="text-3xl font-bold">{copy.aiPersonalization.title}</h2>
          <p className="mt-4 text-neutral-300">{copy.aiPersonalization.body}</p>
        </div>
        <ul className="space-y-3">
          {copy.aiPersonalization.points.map((point) => (
            <li key={point} className="flex items-start gap-3 rounded-sf-lg bg-white/5 p-4">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sf-cyan-400" />
              <span className="text-neutral-200">{point}</span>
            </li>
          ))}
        </ul>
      </SmartifyContainer>
    </section>
  );
}

export function PracticeAssessmentSection({ copy }: { copy: MarketingCopy }) {
  return (
    <section className="py-20">
      <SmartifyContainer className="text-center">
        <h2 className="text-3xl font-bold text-navy-900">{copy.practiceAssessment.title}</h2>
        <p className="mx-auto mt-4 max-w-2xl text-neutral-600">{copy.practiceAssessment.body}</p>
      </SmartifyContainer>
    </section>
  );
}

export function ProgressTrackingSection({ copy }: { copy: MarketingCopy }) {
  return (
    <section className="bg-neutral-50 py-20">
      <SmartifyContainer className="text-center">
        <h2 className="text-3xl font-bold text-navy-900">{copy.progressTracking.title}</h2>
        <p className="mx-auto mt-4 max-w-2xl text-neutral-600">{copy.progressTracking.body}</p>
      </SmartifyContainer>
    </section>
  );
}

export function ParentInsightsSection({ locale, copy }: { locale: Locale; copy: MarketingCopy }) {
  return (
    <section className="py-20">
      <SmartifyContainer className="flex flex-col items-center gap-6 rounded-sf-xl bg-[--sf-bg-subtle] p-12 text-center">
        <h2 className="text-3xl font-bold text-navy-900">{copy.parentInsights.title}</h2>
        <p className="max-w-2xl text-neutral-600">{copy.parentInsights.body}</p>
        <Link href={`/${locale}/for-parents`}>
          <SmartifyButton variant="primary">{copy.parentInsights.ctaLabel}</SmartifyButton>
        </Link>
      </SmartifyContainer>
    </section>
  );
}

export function PricingTeaser({ locale, copy }: { locale: Locale; copy: MarketingCopy }) {
  return (
    <section id="pricing" className="bg-neutral-50 py-20">
      <SmartifyContainer className="text-center">
        <h2 className="text-3xl font-bold text-navy-900">{copy.pricing.title}</h2>
        <p className="mx-auto mt-4 max-w-2xl text-neutral-600">{copy.pricing.body}</p>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-neutral-500">{copy.pricing.note}</p>
        <Link href={`/${locale}/pricing`} className="mt-8 inline-block">
          <SmartifyButton variant="ai">{copy.pricing.ctaLabel}</SmartifyButton>
        </Link>
      </SmartifyContainer>
    </section>
  );
}

/**
 * Testimonial-alternative section (per product decision: no fabricated
 * reviews). Reuses real, structured copy instead of invented quotes.
 */
export function LearningJourneysSection({ copy }: { copy: MarketingCopy }) {
  return (
    <section className="py-20">
      <SmartifyContainer>
        <div className="text-center">
          <h2 className="text-3xl font-bold text-navy-900">{copy.learningJourneys.title}</h2>
          <p className="mx-auto mt-4 max-w-2xl text-neutral-600">{copy.learningJourneys.body}</p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {copy.learningJourneys.items.map((item) => (
            <div key={item.title} className="rounded-sf-lg border border-neutral-200 bg-white p-6">
              <h3 className="font-semibold text-navy-900">{item.title}</h3>
              <p className="mt-2 text-sm text-neutral-600">{item.description}</p>
            </div>
          ))}
        </div>
      </SmartifyContainer>
    </section>
  );
}

export function FinalCtaSection({ locale, copy }: { locale: Locale; copy: MarketingCopy }) {
  return (
    <section className="bg-ai-gradient py-20 text-center text-white">
      <SmartifyContainer>
        <h2 className="text-3xl font-bold">{copy.finalCta.title}</h2>
        <p className="mx-auto mt-4 max-w-xl text-white/90">{copy.finalCta.body}</p>
        <div className="mt-8 inline-block">
          <FreeTrialButton 
            locale={locale} 
            label={copy.finalCta.ctaLabel}
            notSignedInMessage={copy.finalCta.signUpPrompt || "يجب عليك التسجيل أولاً"}
          />
        </div>
      </SmartifyContainer>
    </section>
  );
}
