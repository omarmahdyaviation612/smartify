import { getMarketingCopy, type Locale } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SmartifyContainer } from "@smartify/ui";
import { SubscribeNowButton } from "@/components/SubscribeNowButton";

interface PricingTier {
  id: string;
  levelEn: string;
  levelAr: string;
  monthlyPriceEGP: string;
  includedSubjects: number;
  additionalSubjectPriceEGP: string;
}
interface PricingCurriculum {
  code: string;
  nameEn: string;
  nameAr: string;
  tiers: PricingTier[];
}
interface PricingResponse {
  currency: string;
  dailyAiQuestionsPerSubjectIncluded: number | null;
  curricula: PricingCurriculum[];
}

export function generateStaticParams() {
  return [{ locale: "ar" }, { locale: "en" }];
}

// Pricing is fetched live from the backend — the source of truth is the
// PricingPlan table (packages/database), never a hardcoded value here.
async function getPricing(): Promise<PricingResponse | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${apiUrl}/pricing`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null; // backend unreachable at build/request time — render a friendly fallback below
  }
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const copy = getMarketingCopy(locale);
  const pricing = await getPricing();
  const isAr = locale === "ar";

  return (
    <>
      <Navbar locale={locale} copy={copy} />
      <main className="py-20">
        <SmartifyContainer>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-navy-900">{copy.pricing.title}</h1>
            <p className="mx-auto mt-4 max-w-2xl text-neutral-600">{copy.pricing.body}</p>
            {pricing?.dailyAiQuestionsPerSubjectIncluded != null && (
              <p className="mt-2 text-sm text-neutral-500">
                {isAr
                  ? `يشمل كل اشتراك ${pricing.dailyAiQuestionsPerSubjectIncluded} سؤال ذكاء اصطناعي يوميًا لكل مادة.`
                  : `Every subscription includes ${pricing.dailyAiQuestionsPerSubjectIncluded} AI questions per subject, per day.`}
              </p>
            )}
          </div>

          {!pricing && (
            <p className="mt-12 text-center text-neutral-500">
              {isAr ? "تعذر تحميل الأسعار حاليًا. حاول مرة أخرى لاحقًا." : "Pricing is temporarily unavailable. Please try again shortly."}
            </p>
          )}

          {pricing && (
            <div className="mt-14 space-y-16">
              {pricing.curricula.map((curriculum) => (
                <div key={curriculum.code}>
                  <h2 className="mb-6 text-xl font-semibold text-navy-900">
                    {isAr ? curriculum.nameAr : curriculum.nameEn}
                  </h2>
                  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                    {curriculum.tiers.map((tier) => (
                      <div key={tier.levelEn} className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                        <h3 className="font-semibold text-navy-900">{isAr ? tier.levelAr : tier.levelEn}</h3>
                        <p className="mt-3 text-3xl font-bold text-navy-900">
                          {tier.monthlyPriceEGP} <span className="text-base font-normal text-neutral-500">{isAr ? "ج.م / شهريًا" : "EGP / mo"}</span>
                        </p>
                        <p className="mt-3 text-sm text-neutral-600">
                          {isAr
                            ? `يشمل ${tier.includedSubjects} مواد`
                            : `Includes ${tier.includedSubjects} subjects`}
                        </p>
                        <p className="mt-1 text-sm text-neutral-500">
                          {isAr
                            ? `${tier.additionalSubjectPriceEGP} ج.م لكل مادة إضافية`
                            : `${tier.additionalSubjectPriceEGP} EGP per additional subject`}
                        </p>
                        <SubscribeNowButton
                          locale={locale}
                          planId={tier.id}
                          label={copy.pricing.ctaLabel}
                          notSignedInMessage={isAr ? "يجب عليك التسجيل أولاً" : "You must sign up first"}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SmartifyContainer>
      </main>
      <Footer locale={locale} copy={copy} />
    </>
  );
}
