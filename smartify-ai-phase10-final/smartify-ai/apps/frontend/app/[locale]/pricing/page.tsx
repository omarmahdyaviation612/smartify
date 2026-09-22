import { getMarketingCopy, type Locale } from "@/content/marketing";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SmartifyContainer } from "@smartify/ui";
import { SubscribeNowButton } from "@/components/SubscribeNowButton";

interface PricingSubject {
  id: string;
  nameEn: string;
  nameAr: string;
  priceEGP: number | null;
}
interface PricingGrade {
  nameEn: string;
  nameAr: string;
  level: number;
  subjects: PricingSubject[];
}
interface PricingCurriculum {
  code: string;
  nameEn: string;
  nameAr: string;
  grades: PricingGrade[];
}
interface PricingResponse {
  currency: string;
  dailyAiQuestionsPerSubjectIncluded: number | null;
  curricula: PricingCurriculum[];
}

export function generateStaticParams() {
  return [{ locale: "ar" }, { locale: "en" }];
}

// Pricing is fetched live from the backend — the source of truth is each
// Subject's own priceEGP (packages/database), never a hardcoded value or
// the legacy PricingPlan bundle tiers.
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
                  <div className="space-y-10">
                    {curriculum.grades
                      .filter((grade) => grade.subjects.length > 0)
                      .map((grade) => (
                        <div key={grade.level}>
                          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                            {isAr ? grade.nameAr : grade.nameEn}
                          </h3>
                          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                            {grade.subjects.map((subject) => {
                              const available = subject.priceEGP != null;
                              return (
                                <div key={subject.id} className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                                  <h4 className="font-semibold text-navy-900">{isAr ? subject.nameAr : subject.nameEn}</h4>
                                  {available ? (
                                    <p className="mt-3 text-3xl font-bold text-navy-900">
                                      {subject.priceEGP} <span className="text-base font-normal text-neutral-500">{isAr ? "ج.م / شهريًا" : "EGP / mo"}</span>
                                    </p>
                                  ) : (
                                    <p className="mt-3 text-sm text-neutral-400">
                                      {isAr ? "غير متاحة بعد" : "Not yet available"}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
              <div className="text-center">
                <SubscribeNowButton
                  locale={locale}
                  label={copy.pricing.ctaLabel}
                  notSignedInMessage={isAr ? "يجب عليك التسجيل أولاً" : "You must sign up first"}
                />
              </div>
            </div>
          )}
        </SmartifyContainer>
      </main>
      <Footer locale={locale} copy={copy} />
    </>
  );
}
