import Link from "next/link";
import { getMarketingCopy, type Locale } from "@/content/marketing";
import { getForParentsCopy } from "@/content/for-parents";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";

export function generateStaticParams() {
  return [{ locale: "ar" }, { locale: "en" }];
}

export default async function ForParentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const nav = getMarketingCopy(locale);
  const copy = getForParentsCopy(locale);

  return (
    <>
      <Navbar locale={locale} copy={nav} />
      <main>
        <section className="bg-[--sf-bg-subtle] py-20 text-center">
          <SmartifyContainer>
            <h1 className="text-4xl font-bold text-navy-900">{copy.hero.title}</h1>
            <p className="mx-auto mt-4 max-w-2xl text-neutral-600">{copy.hero.body}</p>
          </SmartifyContainer>
        </section>

        <section className="py-20">
          <SmartifyContainer>
            <div className="mb-8 flex justify-center gap-6 text-sm">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-success-500" /> {copy.statusLegend.available}
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-neutral-400" /> {copy.statusLegend.planned}
              </span>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {copy.features.map((f) => (
                <div key={f.title} className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold text-navy-900">{f.title}</h3>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                        f.status === "available"
                          ? "bg-success-100 text-success-500"
                          : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {f.status === "available" ? copy.statusLegend.available : copy.statusLegend.planned}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-600">{f.description}</p>
                </div>
              ))}
            </div>
          </SmartifyContainer>
        </section>

        <section className="bg-neutral-50 py-20 text-center">
          <SmartifyContainer className="flex flex-col items-center gap-4">
            <h2 className="text-3xl font-bold text-navy-900">{copy.cta.title}</h2>
            <p className="max-w-xl text-neutral-600">{copy.cta.body}</p>
            <Link href={`/${locale}/sign-up`}>
              <SmartifyButton variant="ai">{copy.cta.buttonLabel}</SmartifyButton>
            </Link>
            <p className="max-w-md text-xs text-neutral-400">{copy.cta.disclaimer}</p>
          </SmartifyContainer>
        </section>
      </main>
      <Footer locale={locale} copy={nav} />
    </>
  );
}
