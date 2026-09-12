import Link from "next/link";
import { getMarketingCopy, type Locale } from "@/content/marketing";
import { getCurriculaPageCopy } from "@/content/curricula-page";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { CurriculumExplorer, type CurriculumCatalogEntry } from "@/components/CurriculumExplorer";
import { SmartifyButton, SmartifyContainer } from "@smartify/ui";
import { serverFetch } from "@/lib/api";

export function generateStaticParams() {
  return [{ locale: "ar" }, { locale: "en" }];
}

interface StructureSample {
  curriculum: { nameEn: string; nameAr: string };
  grade: { nameEn: string; nameAr: string } | null;
  subject: { nameEn: string; nameAr: string } | null;
  unit: { nameEn: string; nameAr: string } | null;
  topics: Array<{ nameEn: string; nameAr: string; lessons: Array<{ nameEn: string; nameAr: string }> }>;
}

export default async function CurriculaPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const nav = getMarketingCopy(locale);
  const copy = getCurriculaPageCopy(locale);
  const isAr = locale === "ar";

  // Both the catalog and the structure sample come straight from the
  // database (via the backend) — nothing about curricula, grades,
  // subjects, or the sample lesson tree is hardcoded in this page.
  const catalog = (await serverFetch<CurriculumCatalogEntry[]>("/curricula")) ?? [];
  const firstCode = catalog[0]?.code;
  const sample = firstCode ? await serverFetch<StructureSample>(`/curricula/${firstCode}/structure-sample`) : null;

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
            <div className="text-center">
              <h2 className="text-3xl font-bold text-navy-900">{copy.systemsIntro.title}</h2>
              <p className="mx-auto mt-4 max-w-2xl text-neutral-600">{copy.systemsIntro.body}</p>
            </div>

            {catalog.length === 0 ? (
              <p className="mt-10 text-center text-neutral-500">
                {isAr ? "تعذر تحميل المناهج حاليًا." : "Curricula are temporarily unavailable."}
              </p>
            ) : (
              <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {catalog.map((c) => (
                  <div key={c.id} className="rounded-sf-lg border border-neutral-200 bg-white p-6">
                    <h3 className="font-semibold text-navy-900">{isAr ? c.nameAr : c.nameEn}</h3>
                    <p className="mt-2 text-sm text-neutral-500">
                      {isAr
                        ? `${c.grades.length} صف منشور`
                        : `${c.grades.length} grade${c.grades.length === 1 ? "" : "s"} published`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </SmartifyContainer>
        </section>

        <section className="bg-neutral-50 py-20">
          <SmartifyContainer>
            <div className="text-center">
              <h2 className="text-3xl font-bold text-navy-900">{copy.structure.title}</h2>
              <p className="mx-auto mt-4 max-w-2xl text-neutral-600">{copy.structure.body}</p>
            </div>

            <div className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-3">
              {copy.structure.levels.map((level, i) => (
                <div key={level} className="flex items-center gap-3">
                  <span className="rounded-full bg-ai-gradient px-5 py-2 text-sm font-semibold text-white">
                    {level}
                  </span>
                  {i < copy.structure.levels.length - 1 && <span className="text-neutral-400">→</span>}
                </div>
              ))}
            </div>

            <div className="mx-auto mt-12 max-w-3xl rounded-sf-lg border border-neutral-200 bg-white p-8">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                {copy.structure.sampleTitle}
              </h3>
              {!sample || !sample.grade ? (
                <p className="text-sm text-neutral-500">{copy.structure.sampleUnavailable}</p>
              ) : (
                <div className="space-y-1 text-sm text-neutral-700">
                  <p>
                    <strong className="text-navy-900">{isAr ? sample.curriculum.nameAr : sample.curriculum.nameEn}</strong>
                    {" → "}
                    {isAr ? sample.grade.nameAr : sample.grade.nameEn}
                    {" → "}
                    {sample.subject && (isAr ? sample.subject.nameAr : sample.subject.nameEn)}
                    {" → "}
                    {sample.unit && (isAr ? sample.unit.nameAr : sample.unit.nameEn)}
                  </p>
                  <ul className="mt-4 list-inside list-disc space-y-2">
                    {sample.topics.map((t) => (
                      <li key={isAr ? t.nameAr : t.nameEn}>
                        {isAr ? t.nameAr : t.nameEn}
                        {t.lessons.length > 0 && (
                          <ul className="ms-6 mt-1 list-inside list-[circle] text-neutral-500">
                            {t.lessons.map((l) => (
                              <li key={isAr ? l.nameAr : l.nameEn}>{isAr ? l.nameAr : l.nameEn}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </SmartifyContainer>
        </section>

        {catalog.length > 0 && <CurriculumExplorer locale={locale} copy={copy.discovery} catalog={catalog} />}

        <section className="bg-ai-gradient py-20 text-center text-white">
          <SmartifyContainer>
            <h2 className="text-3xl font-bold">{copy.cta.title}</h2>
            <p className="mx-auto mt-4 max-w-xl text-white/90">{copy.cta.body}</p>
            <Link href={`/${locale}/onboarding/profile`} className="mt-8 inline-block">
              <SmartifyButton variant="secondary">{copy.cta.buttonLabel}</SmartifyButton>
            </Link>
          </SmartifyContainer>
        </section>
      </main>
      <Footer locale={locale} copy={nav} />
    </>
  );
}
