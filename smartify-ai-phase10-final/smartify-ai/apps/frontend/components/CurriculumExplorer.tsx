"use client";

import { useMemo, useState } from "react";
import { SmartifyContainer } from "@smartify/ui";
import type { CurriculaPageCopy } from "@/content/curricula-page";
import type { Locale } from "@/content/marketing";

interface Subject {
  id: string;
  nameEn: string;
  nameAr: string;
  icon: string | null;
}
interface Grade {
  id: string;
  nameEn: string;
  nameAr: string;
  level: number;
  subjects: Subject[];
}
export interface CurriculumCatalogEntry {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  country: string | null;
  grades: Grade[];
}

export function CurriculumExplorer({
  locale,
  copy,
  catalog,
}: {
  locale: Locale;
  copy: CurriculaPageCopy["discovery"];
  catalog: CurriculumCatalogEntry[];
}) {
  const isAr = locale === "ar";
  const [curriculumId, setCurriculumId] = useState(catalog[0]?.id ?? "");
  const selectedCurriculum = useMemo(
    () => catalog.find((c) => c.id === curriculumId) ?? catalog[0],
    [catalog, curriculumId],
  );
  const [gradeId, setGradeId] = useState(selectedCurriculum?.grades[0]?.id ?? "");

  const grades = selectedCurriculum?.grades ?? [];
  const selectedGrade = grades.find((g) => g.id === gradeId) ?? grades[0];

  function handleCurriculumChange(id: string) {
    setCurriculumId(id);
    const next = catalog.find((c) => c.id === id);
    setGradeId(next?.grades[0]?.id ?? "");
  }

  return (
    <section className="py-20">
      <SmartifyContainer>
        <div className="text-center">
          <h2 className="text-3xl font-bold text-navy-900">{copy.title}</h2>
          <p className="mx-auto mt-4 max-w-2xl text-neutral-600">{copy.body}</p>
        </div>

        <div className="mx-auto mt-10 max-w-3xl rounded-sf-xl border border-neutral-200 bg-white p-8">
          <div className="grid gap-6 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.selectCurriculumLabel}</span>
              <select
                value={selectedCurriculum?.id}
                onChange={(e) => handleCurriculumChange(e.target.value)}
                className="w-full rounded-sf border border-neutral-300 bg-white px-4 py-2 text-navy-900"
              >
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {isAr ? c.nameAr : c.nameEn}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-700">{copy.selectGradeLabel}</span>
              <select
                value={selectedGrade?.id ?? ""}
                onChange={(e) => setGradeId(e.target.value)}
                disabled={grades.length === 0}
                className="w-full rounded-sf border border-neutral-300 bg-white px-4 py-2 text-navy-900 disabled:bg-neutral-100"
              >
                {grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {isAr ? g.nameAr : g.nameEn}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-8">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              {copy.subjectsLabel}
            </h3>
            {!selectedGrade || selectedGrade.subjects.length === 0 ? (
              <p className="text-sm text-neutral-500">{copy.noGrades}</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {selectedGrade.subjects.map((s) => (
                  <span
                    key={s.id}
                    className="rounded-full bg-[--sf-bg-subtle] px-4 py-2 text-sm font-medium text-navy-900"
                  >
                    {isAr ? s.nameAr : s.nameEn}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </SmartifyContainer>
    </section>
  );
}
