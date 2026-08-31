"use client";

import { useEffect, useState } from "react";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { useApiClient } from "@/lib/api-client";
import { useCurrentUser } from "@/lib/use-current-user";

interface Curriculum {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
}
interface Grade {
  id: string;
  nameEn: string;
  nameAr: string;
  level: number;
  isActive: boolean;
}
interface PricingPlan {
  id: string;
  levelCodeEn: string;
  monthlyPriceEGP: string;
  includedSubjects: number;
  additionalSubjectPriceEGP: string;
  isActive: boolean;
  curriculum: { nameEn: string };
}

function CurriculaSection() {
  const { apiFetch } = useApiClient();
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [grades, setGrades] = useState<Grade[]>([]);

  useEffect(() => {
    apiFetch<Curriculum[]>("/admin/curriculum/curricula").then((data) => {
      setCurricula(data);
      if (data[0]) setSelectedId(data[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    apiFetch<Grade[]>(`/admin/curriculum/grades?curriculumId=${selectedId}`).then(setGrades);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleCurriculumActive(c: Curriculum) {
    await apiFetch(`/admin/curriculum/curricula/${c.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !c.isActive }) });
    setCurricula((prev) => prev.map((x) => (x.id === c.id ? { ...x, isActive: !x.isActive } : x)));
  }

  async function toggleGradeActive(g: Grade) {
    await apiFetch(`/admin/curriculum/grades/${g.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !g.isActive }) });
    setGrades((prev) => prev.map((x) => (x.id === g.id ? { ...x, isActive: !x.isActive } : x)));
  }

  return (
    <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 font-semibold text-navy-900">Curricula</h2>
      <div className="flex flex-wrap gap-2">
        {curricula.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className={`rounded-full border px-4 py-2 text-sm ${
              selectedId === c.id ? "border-sf-blue-500 bg-[--sf-bg-subtle]" : "border-neutral-200"
            }`}
          >
            {c.nameEn} {!c.isActive && "(inactive)"}
          </button>
        ))}
      </div>

      {curricula.length > 0 && (
        <button
          onClick={() => toggleCurriculumActive(curricula.find((c) => c.id === selectedId)!)}
          className="mt-3 text-xs text-neutral-500 underline"
        >
          Toggle active for selected curriculum
        </button>
      )}

      <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-neutral-500">Grades</h3>
      <ul className="space-y-2 text-sm">
        {grades.map((g) => (
          <li key={g.id} className="flex items-center justify-between rounded-sf border border-neutral-100 px-4 py-2">
            <span className="text-neutral-700">
              {g.nameEn} (level {g.level})
            </span>
            <button onClick={() => toggleGradeActive(g)} className="text-xs text-neutral-500 underline">
              {g.isActive ? "Deactivate" : "Activate"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PricingSection() {
  const { apiFetch } = useApiClient();
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});

  useEffect(() => {
    apiFetch<PricingPlan[]>("/admin/curriculum/pricing-plans").then(setPlans);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function savePrice(planId: string) {
    const value = editing[planId];
    if (!value) return;
    await apiFetch(`/admin/curriculum/pricing-plans/${planId}`, {
      method: "PATCH",
      body: JSON.stringify({ monthlyPriceEGP: Number(value) }),
    });
    setPlans((prev) => prev.map((p) => (p.id === planId ? { ...p, monthlyPriceEGP: value } : p)));
  }

  return (
    <div className="mt-6 rounded-sf-lg border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 font-semibold text-navy-900">EGP Pricing Plans</h2>
      <div className="space-y-3">
        {plans.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-sf border border-neutral-100 px-4 py-3 text-sm">
            <div>
              <p className="font-medium text-navy-900">
                {p.curriculum.nameEn} — {p.levelCodeEn}
              </p>
              <p className="text-neutral-500">
                Includes {p.includedSubjects} subjects, {p.additionalSubjectPriceEGP} EGP/extra
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                defaultValue={p.monthlyPriceEGP}
                onChange={(e) => setEditing((prev) => ({ ...prev, [p.id]: e.target.value }))}
                className="w-24 rounded-sf border border-neutral-300 px-2 py-1"
              />
              <span className="text-neutral-500">EGP</span>
              <button onClick={() => savePrice(p.id)} className="rounded-sf bg-sf-blue-500 px-3 py-1 text-xs text-white">
                Save
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminCurriculumPage() {
  const { user } = useCurrentUser();
  const canSeePricing = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN", "CONTENT_MANAGER"]}>
      <main className="py-12">
        <SmartifyContainer className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-bold text-navy-900">Curriculum & Pricing</h1>
          <div className="mt-6">
            <CurriculaSection />
          </div>
          {canSeePricing && <PricingSection />}
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
