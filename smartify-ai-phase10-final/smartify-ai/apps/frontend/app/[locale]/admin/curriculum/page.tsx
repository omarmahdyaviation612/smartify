"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { useApiClient } from "@/lib/api-client";
import { useCurrentUser } from "@/lib/use-current-user";
import { API_URL } from "@/lib/api";

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
interface Topic { id: string; nameEn: string; nameAr: string; unit: { nameEn: string } }
interface Material { id: string; originalName: string; sizeBytes: number; createdAt: string }

function MaterialsSection() {
  const { apiFetch } = useApiClient();
  const { getToken } = useAuth();
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [subjects, setSubjects] = useState<{ id: string; nameEn: string }[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [curriculumId, setCurriculumId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => { apiFetch<Curriculum[]>("/admin/curriculum/curricula").then(setCurricula); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setGrades([]); setGradeId(""); setSubjects([]); setSubjectId(""); setTopics([]); setTopicId("");
    if (curriculumId) apiFetch<Grade[]>(`/admin/curriculum/grades?curriculumId=${curriculumId}`).then(setGrades);
  }, [curriculumId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSubjects([]); setSubjectId(""); setTopics([]); setTopicId("");
    if (gradeId) apiFetch<{ id: string; nameEn: string }[]>(`/admin/curriculum/subjects?gradeId=${gradeId}`).then(setSubjects);
  }, [gradeId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (subjectId) apiFetch<Topic[]>(`/admin/curriculum/topics?subjectId=${subjectId}`).then(setTopics); }, [subjectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (topicId) apiFetch<Material[]>(`/admin/curriculum/materials?topicId=${topicId}`).then(setMaterials); }, [topicId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(file: File) {
    if (!curriculumId || !gradeId || !subjectId || !topicId) return setMessage("Choose a curriculum, grade, subject, and topic first.");
    const form = new FormData(); form.append("file", file); form.append("topicId", topicId);
    const token = await getToken();
    const response = await fetch(`${API_URL}/admin/curriculum/materials`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
    if (!response.ok) { const body = await response.json().catch(() => ({})); return setMessage(body.message ?? "Upload failed."); }
    setMessage("Material uploaded."); setMaterials(await apiFetch<Material[]>(`/admin/curriculum/materials?topicId=${topicId}`));
  }
  return <div className="mt-6 rounded-sf-lg border border-neutral-200 bg-white p-6">
    <h2 className="font-semibold text-navy-900">Upload text materials</h2>
    <p className="mt-1 text-sm text-neutral-500">TXT, Markdown, or JSON only. Images are never extracted or shown.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <select className="rounded-sf border p-2" value={curriculumId} onChange={e => setCurriculumId(e.target.value)}>
        <option value="">Choose curriculum</option>{curricula.map(c => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
      </select>
      <select className="rounded-sf border p-2" value={gradeId} onChange={e => setGradeId(e.target.value)} disabled={!curriculumId}>
        <option value="">Choose grade</option>{grades.map(g => <option key={g.id} value={g.id}>{g.nameEn}</option>)}
      </select>
      <select className="rounded-sf border p-2" value={subjectId} onChange={e => { setSubjectId(e.target.value); setTopicId(""); }} disabled={!gradeId}>
        <option value="">Choose subject</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
      </select>
      <select className="rounded-sf border p-2" value={topicId} onChange={e => setTopicId(e.target.value)} disabled={!subjectId}>
        <option value="">Choose topic</option>{topics.map(t => <option key={t.id} value={t.id}>{t.unit.nameEn} — {t.nameEn}</option>)}
      </select>
    </div>
    <input className="mt-4" type="file" accept=".txt,.md,.json,text/plain,text/markdown,application/json" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
    {message && <p className="mt-2 text-sm text-neutral-600">{message}</p>}
    <ul className="mt-4 space-y-2 text-sm">{materials.map(m => <li key={m.id} className="rounded border p-2">{m.originalName} ({Math.ceil(m.sizeBytes / 1024)} KB)</li>)}</ul>
  </div>;
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
          <MaterialsSection />
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
