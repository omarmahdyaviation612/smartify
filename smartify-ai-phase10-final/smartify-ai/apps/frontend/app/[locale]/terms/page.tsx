import { getMarketingCopy, type Locale } from "@/content/marketing";
import { getLegalCopy } from "@/content/legal";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SmartifyContainer } from "@smartify/ui";

export function generateStaticParams() {
  return [{ locale: "ar" }, { locale: "en" }];
}

export default async function TermsOfServicePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const nav = getMarketingCopy(locale);
  const copy = getLegalCopy(locale).terms;

  return (
    <>
      <Navbar locale={locale} copy={nav} />
      <main className="py-16">
        <SmartifyContainer className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold text-navy-900">{copy.title}</h1>
          <p className="mt-2 text-sm text-neutral-500">
            {locale === "ar" ? `آخر تحديث: ${copy.lastUpdated}` : `Last updated: ${copy.lastUpdated}`}
          </p>
          <p className="mt-6 text-neutral-700">{copy.intro}</p>

          <div className="mt-10 space-y-10">
            {copy.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-xl font-semibold text-navy-900">{section.heading}</h2>
                <div className="mt-3 space-y-3">
                  {section.paragraphs.map((paragraph, index) => (
                    <p key={index} className="text-neutral-700">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </SmartifyContainer>
      </main>
      <Footer locale={locale} copy={nav} />
    </>
  );
}
