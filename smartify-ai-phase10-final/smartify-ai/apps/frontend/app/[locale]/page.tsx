import { getMarketingCopy, type Locale } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import {
  Hero,
  TrustedLearning,
  CurriculaSection,
  HowItWorksSection,
  AIPersonalizationSection,
  PracticeAssessmentSection,
  ProgressTrackingSection,
  ParentInsightsSection,
  PricingTeaser,
  LearningJourneysSection,
  FinalCtaSection,
} from "@/components/sections";
import { Testimonials, type Testimonial } from "@/components/Testimonials";

export function generateStaticParams() {
  return [{ locale: "ar" }, { locale: "en" }];
}

// No real testimonials exist yet — kept as an empty array on purpose so
// Testimonials renders nothing, per the "no fabricated social proof" rule.
// Replace with a real data fetch once submissions exist.
const REAL_TESTIMONIALS: Testimonial[] = [];

export default function HomePage({ params }: { params: { locale: Locale } }) {
  const copy = getMarketingCopy(params.locale);

  return (
    <>
      <Navbar locale={params.locale} copy={copy} />
      <main>
        <Hero locale={params.locale} copy={copy} />
        <TrustedLearning copy={copy} />
        <CurriculaSection copy={copy} />
        <HowItWorksSection copy={copy} />
        <AIPersonalizationSection copy={copy} />
        <PracticeAssessmentSection copy={copy} />
        <ProgressTrackingSection copy={copy} />
        <ParentInsightsSection locale={params.locale} copy={copy} />
        <PricingTeaser locale={params.locale} copy={copy} />
        <Testimonials testimonials={REAL_TESTIMONIALS} title={params.locale === "ar" ? "قصص طلابنا" : "Student Stories"} />
        <LearningJourneysSection copy={copy} />
        <FinalCtaSection locale={params.locale} copy={copy} />
      </main>
      <Footer locale={params.locale} copy={copy} />
    </>
  );
}
