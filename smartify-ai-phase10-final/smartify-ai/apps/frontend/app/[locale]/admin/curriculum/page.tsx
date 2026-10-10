"use client";

import { useEffect, useState, type FormEvent } from "react";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { ApiError, useApiClient } from "@/lib/api-client";
import { useCurrentUser } from "@/lib/use-current-user";

// Curricula whose Arabic / Social Studies may reuse Egyptian MOE content (mirrors backend shared-content-subject.util.ts).
const SHARED_TARGET_CURRICULUM_CODES = ["BRITISH_INTL", "AMERICAN_INTL", "EG_LANGUAGE"];

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

// Read-only curriculum content status dashboard (2026-09-20) — mirrors
// AdminCurriculumService.getCurriculumStatus()'s response shape exactly.
// Note the intentionally NOT-null-checked-alone generationSource: a Topic
// with teachingStepsJson set but generationSource null was published
// through the old, pre-2026-09-19 human-reviewed pipeline, which never
// wrote that field — the backend already resolves this into `status`, so
// the frontend never re-derives it.
type TopicDisplayStatus = "NEVER_GENERATED" | "TEXTBOOK_GROUNDED" | "LEGACY_TITLE_ONLY" | "HISTORICAL_GENERATED";
interface TopicStatus {
  id: string;
  nameEn: string;
  nameAr: string;
  order: number;
  hasTeachingSteps: boolean;
  generationSource: string | null;
  groundingVersionUsed: number | null;
  generationPromptVersion: string | null;
  contentGeneratedAt: string | null;
  status: TopicDisplayStatus;
}
interface UnitStatus {
  id: string;
  nameEn: string;
  nameAr: string;
  order: number;
  term: "TERM_1" | "TERM_2" | null;
  sourcePageStart: number | null;
  sourcePageEnd: number | null;
  // English Extra Book / Story support V1 (2026-09-20) — true when this
  // Unit's real content comes from a different PDF than the Subject's
  // main textbook (see Unit.sourceFileOverride). Subtle indicator only —
  // never exposes the actual object key.
  usesExtraSource: boolean;
  grounded: boolean;
  groundingGeneratedAt: string | null;
  groundingVersion: number | null;
  groundingModel: string | null;
  groundingPromptVersion: string | null;
  topics: TopicStatus[];
}
interface SubjectStatus {
  id: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  sourceFile: string | null;
  sharedContentSubjectId: string | null;
  sharedContentSubject: { id: string; nameEn: string; nameAr: string } | null;
  shareEligible: boolean;
  textbookMapped: boolean;
  priceEGP: number | null;
  units: UnitStatus[];
}
interface GradeStatus {
  id: string;
  nameEn: string;
  nameAr: string;
  level: number;
  isActive: boolean;
  subjects: SubjectStatus[];
}
interface CurriculumStatus {
  id: string;
  nameEn: string;
  nameAr: string;
  code: string;
  isActive: boolean;
  grades: GradeStatus[];
}
interface StatusSummary {
  subjects: number;
  units: number;
  groundedUnits: number;
  topics: number;
  generatedTopics: number;
  textbookGroundedTopics: number;
}
interface CurriculumStatusResponse {
  summary: StatusSummary;
  curricula: CurriculumStatus[];
}

const TOPIC_STATUS_META: Record<TopicDisplayStatus, { label: string; className: string }> = {
  TEXTBOOK_GROUNDED: { label: "Textbook grounded", className: "bg-green-100 text-green-700" },
  LEGACY_TITLE_ONLY: { label: "Legacy title-only", className: "bg-amber-100 text-amber-700" },
  HISTORICAL_GENERATED: { label: "Historical generated", className: "bg-sf-blue-100 text-sf-blue-700" },
  NEVER_GENERATED: { label: "Never generated", className: "bg-neutral-100 text-neutral-500" },
};

function TopicStatusBadge({ status }: { status: TopicDisplayStatus }) {
  const meta = TOPIC_STATUS_META[status];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>;
}

// Admin textbook upload, Step 1 (2026-09-20) — FIRST-TIME upload only, for
// a Subject with textbookMapped === false. There is deliberately no
// replace/force control anywhere here — a Subject that already has a
// textbook shows its sourceFile as plain text only (see StatusSection
// below); Step 2 will design replacement separately.
function TextbookUploadControl({ subjectId, onUploaded }: { subjectId: string; onUploaded: () => void }) {
  const { apiFetch } = useApiClient();
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleFile(file: File) {
    if (file.type !== "application/pdf") {
      setStatus("error");
      setMessage("Only PDF files are supported.");
      return;
    }
    setStatus("uploading");
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      await apiFetch(`/admin/curriculum/subjects/${subjectId}/textbook`, { method: "POST", body: form });
      setStatus("success");
      setMessage("Textbook uploaded.");
      onUploaded();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof ApiError ? err.message : "Upload failed. Please try again.");
    }
  }

  return (
    <div className="mt-1 pl-2">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-sf border border-neutral-300 px-2 py-1 text-xs text-navy-900 hover:border-sf-blue-500">
        {status === "uploading" ? "Uploading…" : "Upload textbook"}
        <input
          type="file"
          accept=".pdf,application/pdf"
          disabled={status === "uploading"}
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>
      {status === "success" && <p className="mt-1 text-xs text-green-700">{message}</p>}
      {status === "error" && <p className="mt-1 text-xs text-error-500">{message}</p>}
    </div>
  );
}

// Subject-based pricing (2026-09-20) — every Subject now has its own
// independent monthlyPriceEGP, editable inline right here; there is no
// "3 subjects bundled" concept anymore for new purchases (see billing.ts).
// A null price means the subject is not yet available for students to
// purchase — the checkout page hides/disables it until an admin sets one.
function SubjectPriceEditor({ subjectId, priceEGP, onSaved }: { subjectId: string; priceEGP: number | null; onSaved: (price: number) => void }) {
  const { apiFetch } = useApiClient();
  const [value, setValue] = useState(priceEGP != null ? String(priceEGP) : "");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");

  async function save() {
    const parsed = Number(value);
    if (!value.trim() || !Number.isFinite(parsed) || parsed < 0) {
      setStatus("error");
      setMessage("Enter a valid non-negative price.");
      return;
    }
    setStatus("saving");
    setMessage("");
    try {
      await apiFetch(`/admin/curriculum/subjects/${subjectId}`, { method: "PATCH", body: JSON.stringify({ priceEGP: parsed }) });
      setStatus("idle");
      onSaved(parsed);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof ApiError ? err.message : "Could not save the price.");
    }
  }

  return (
    <div className="mt-1 flex items-center gap-2 pl-2">
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Not priced"
        className="w-24 rounded-sf border border-neutral-300 px-2 py-1 text-xs"
        disabled={status === "saving"}
      />
      <span className="text-xs text-neutral-400">EGP / mo</span>
      <button onClick={save} disabled={status === "saving"} className="rounded-sf border border-neutral-300 px-2 py-1 text-xs text-navy-900 hover:border-sf-blue-500 disabled:opacity-50">
        {status === "saving" ? "Saving…" : "Save price"}
      </button>
      {status === "error" && <p className="text-xs text-error-500">{message}</p>}
    </div>
  );
}

// ============================================================
// Admin New Subject + Textbook Ingestion V1 (2026-09-20)
// ============================================================
// Add New Subject -> upload textbook -> Analyze Textbook (AI, textbook-
// grounded, billed to the platform content-authoring actor, never a
// student) -> editable preview -> Confirm & Create Curriculum Structure
// (server-side re-validated, atomic, idempotent). The created Subject
// stays inactive (invisible to students) until deliberately published via
// the "Publish subject" button on the final step, which is just the
// existing PATCH /admin/curriculum/subjects/:id isActive toggle — no new
// publish mechanism. After confirmation, ordinary lazy grounding/
// generation takes over exactly as for any other Subject; this flow never
// triggers grounding, lesson generation, or question generation itself.

interface DraftTopic {
  nameEn: string;
  nameAr: string;
  sourcePageStart?: number;
  sourcePageEnd?: number;
}
interface DraftUnit {
  nameEn: string;
  nameAr: string;
  sourcePageStart: number;
  sourcePageEnd: number;
  term?: "TERM_1" | "TERM_2";
  topics: DraftTopic[];
}
interface AnalyzeResponse {
  units: DraftUnit[];
  pdfPageCount: number;
  pagesInspected: { start: number; end: number };
}

function moveItem<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const editorInputCls = "rounded border border-neutral-300 px-2 py-1 text-sm";

/**
 * The editable Unit/Topic preview — shared verbatim by the New Subject
 * flow (AI-extracted or from-scratch) and the English Extra Book / Story
 * flow (AI-extracted OR hand-typed "Enter Structure Manually"), per the
 * spec's "do not duplicate this UI" instruction. Pure controlled
 * component — the caller owns the `units` state and gets every edit back
 * through `onChange`.
 */
function UnitsTopicsEditor({ units, onChange }: { units: DraftUnit[]; onChange: (units: DraftUnit[]) => void }) {
  function updateUnit(index: number, patch: Partial<DraftUnit>) {
    onChange(units.map((u, i) => (i === index ? { ...u, ...patch } : u)));
  }
  function removeUnit(index: number) {
    onChange(units.filter((_, i) => i !== index));
  }
  function addUnit() {
    onChange([...units, { nameEn: "New unit", nameAr: "وحدة جديدة", sourcePageStart: 1, sourcePageEnd: 1, term: "TERM_1", topics: [{ nameEn: "New topic", nameAr: "موضوع جديد" }] }]);
  }
  function moveUnit(index: number, direction: -1 | 1) {
    onChange(moveItem(units, index, direction));
  }
  function updateTopic(unitIndex: number, topicIndex: number, patch: Partial<DraftTopic>) {
    onChange(units.map((u, i) => (i !== unitIndex ? u : { ...u, topics: u.topics.map((t, j) => (j === topicIndex ? { ...t, ...patch } : t)) })));
  }
  function removeTopic(unitIndex: number, topicIndex: number) {
    onChange(units.map((u, i) => (i !== unitIndex ? u : { ...u, topics: u.topics.filter((_, j) => j !== topicIndex) })));
  }
  function addTopic(unitIndex: number) {
    onChange(units.map((u, i) => (i !== unitIndex ? u : { ...u, topics: [...u.topics, { nameEn: "New topic", nameAr: "موضوع جديد" }] })));
  }
  function moveTopic(unitIndex: number, topicIndex: number, direction: -1 | 1) {
    onChange(units.map((u, i) => (i !== unitIndex ? u : { ...u, topics: moveItem(u.topics, topicIndex, direction) })));
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {units.map((unit, uIndex) => (
          <div key={uIndex} className="rounded-sf border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input className={editorInputCls} value={unit.nameEn} onChange={(e) => updateUnit(uIndex, { nameEn: e.target.value })} placeholder="Unit name (English)" />
              <input className={editorInputCls} value={unit.nameAr} onChange={(e) => updateUnit(uIndex, { nameAr: e.target.value })} placeholder="اسم الوحدة" dir="rtl" />
              <select aria-label="Unit term" className={editorInputCls} value={unit.term ?? "TERM_1"} onChange={(e) => updateUnit(uIndex, { term: e.target.value as "TERM_1" | "TERM_2" })}>
                <option value="TERM_1">Term 1</option>
                <option value="TERM_2">Term 2</option>
              </select>
              <div dir="ltr" className="flex items-center gap-2">
                <span className="text-xs text-neutral-400">pages</span>
                <input type="number" aria-label="Unit start page" className={`${editorInputCls} w-20`} value={unit.sourcePageStart} onChange={(e) => updateUnit(uIndex, { sourcePageStart: Number(e.target.value) })} />
                <span className="text-xs text-neutral-400">→</span>
                <input type="number" aria-label="Unit end page" className={`${editorInputCls} w-20`} value={unit.sourcePageEnd} onChange={(e) => updateUnit(uIndex, { sourcePageEnd: Number(e.target.value) })} />
              </div>
              <button onClick={() => moveUnit(uIndex, -1)} disabled={uIndex === 0} className="text-xs text-neutral-500 disabled:opacity-30">
                ↑
              </button>
              <button onClick={() => moveUnit(uIndex, 1)} disabled={uIndex === units.length - 1} className="text-xs text-neutral-500 disabled:opacity-30">
                ↓
              </button>
              <button onClick={() => removeUnit(uIndex)} className="text-xs text-error-500 underline">
                Remove unit
              </button>
            </div>
            <div className="mt-3 space-y-2 pl-4">
              {unit.topics.map((topic, tIndex) => (
                <div key={tIndex} className="flex flex-wrap items-center gap-2">
                  <input className={editorInputCls} value={topic.nameEn} onChange={(e) => updateTopic(uIndex, tIndex, { nameEn: e.target.value })} placeholder="Topic name (English)" />
                  <input className={editorInputCls} value={topic.nameAr} onChange={(e) => updateTopic(uIndex, tIndex, { nameAr: e.target.value })} placeholder="اسم الموضوع" dir="rtl" />
                  <button onClick={() => moveTopic(uIndex, tIndex, -1)} disabled={tIndex === 0} className="text-xs text-neutral-500 disabled:opacity-30">
                    ↑
                  </button>
                  <button onClick={() => moveTopic(uIndex, tIndex, 1)} disabled={tIndex === unit.topics.length - 1} className="text-xs text-neutral-500 disabled:opacity-30">
                    ↓
                  </button>
                  <button onClick={() => removeTopic(uIndex, tIndex)} className="text-xs text-error-500 underline">
                    Remove topic
                  </button>
                </div>
              ))}
              <button onClick={() => addTopic(uIndex)} className="text-xs text-sf-blue-500 underline">
                + Add topic
              </button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addUnit} className="text-sm text-sf-blue-500 underline">
        + Add unit
      </button>
    </div>
  );
}

function AddSubjectWizard({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { apiFetch } = useApiClient();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [curriculumId, setCurriculumId] = useState("");
  const [grades, setGrades] = useState<Grade[]>([]);
  const [gradeId, setGradeId] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");

  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [textbookFilename, setTextbookFilename] = useState<string | null>(null);

  const [units, setUnits] = useState<DraftUnit[]>([]);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pagesInspected, setPagesInspected] = useState<{ start: number; end: number } | null>(null);

  const [result, setResult] = useState<{ unitsCreated: number; topicsCreated: number } | null>(null);
  const [published, setPublished] = useState(false);

  useEffect(() => {
    apiFetch<Curriculum[]>("/admin/curriculum/curricula").then((data) => {
      setCurricula(data);
      if (data[0]) setCurriculumId(data[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!curriculumId) return;
    apiFetch<Grade[]>(`/admin/curriculum/grades?curriculumId=${curriculumId}`).then((data) => {
      setGrades(data);
      setGradeId(data[0]?.id ?? "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curriculumId]);

  function errMessage(e: unknown, fallback: string) {
    return e instanceof ApiError ? e.message : fallback;
  }

  async function createDraftSubject() {
    if (!gradeId || !nameEn.trim() || !nameAr.trim()) {
      setError("Choose a curriculum/grade and enter both names.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const subject = await apiFetch<{ id: string }>("/admin/curriculum/subjects", {
        method: "POST",
        body: JSON.stringify({ gradeId, nameEn: nameEn.trim(), nameAr: nameAr.trim(), isActive: false }),
      });
      setSubjectId(subject.id);
      setStep(2);
    } catch (e) {
      setError(errMessage(e, "Could not create the subject."));
    } finally {
      setBusy(false);
    }
  }

  async function uploadTextbook(file: File) {
    if (file.type !== "application/pdf") {
      setError("Only PDF files are supported.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      await apiFetch(`/admin/curriculum/subjects/${subjectId}/textbook`, { method: "POST", body: form });
      setTextbookFilename(file.name);
      setStep(3);
    } catch (e) {
      setError(errMessage(e, "Upload failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    setBusy(true);
    setError("");
    try {
      const r = await apiFetch<AnalyzeResponse>(`/admin/curriculum/subjects/${subjectId}/analyze-textbook`, { method: "POST" });
      setUnits(r.units);
      setPdfPageCount(r.pdfPageCount);
      setPagesInspected(r.pagesInspected);
      setStep(4);
    } catch (e) {
      setError(errMessage(e, "Could not analyze this textbook. You can try again."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmStructure() {
    setBusy(true);
    setError("");
    try {
      const r = await apiFetch<{ subjectId: string; unitsCreated: number; topicsCreated: number }>(
        `/admin/curriculum/subjects/${subjectId}/confirm-structure`,
        { method: "POST", body: JSON.stringify({ curriculumId, gradeId, units: units.map((u) => ({ nameEn: u.nameEn, nameAr: u.nameAr, term: u.term ?? "TERM_1", sourcePageStart: u.sourcePageStart, sourcePageEnd: u.sourcePageEnd, topics: u.topics.map((t) => ({ nameEn: t.nameEn, nameAr: t.nameAr })) })) }) },
      );
      setResult(r);
      setStep(5);
      onCreated();
    } catch (e) {
      setError(errMessage(e, "Could not create the curriculum structure. Nothing was saved — you can try again."));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/admin/curriculum/subjects/${subjectId}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) });
      setPublished(true);
      onCreated();
    } catch (e) {
      setError(errMessage(e, "Could not publish the subject."));
    } finally {
      setBusy(false);
    }
  }

  const inputCls = editorInputCls;

  return (
    <div className="mt-6 rounded-sf-lg border border-sf-blue-200 bg-[--sf-bg-subtle] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-navy-900">Add New Subject — step {step} of 5</h2>
        {step < 5 && (
          <button onClick={onCancel} className="text-xs text-neutral-500 underline">
            Cancel
          </button>
        )}
      </div>

      {error && <p className="mb-3 rounded bg-error-50 px-3 py-2 text-sm text-error-500">{error}</p>}

      {step === 1 && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Curriculum</label>
            <select className={`${inputCls} w-full`} value={curriculumId} onChange={(e) => setCurriculumId(e.target.value)}>
              {curricula.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameEn}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Grade</label>
            <select className={`${inputCls} w-full`} value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nameEn}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Subject name (English)</label>
            <input className={`${inputCls} w-full`} value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="e.g. Science" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Subject name (Arabic)</label>
            <input className={`${inputCls} w-full`} value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="مثال: العلوم" dir="rtl" />
          </div>
          <button onClick={createDraftSubject} disabled={busy} className="rounded-sf bg-sf-blue-500 px-4 py-2 text-sm text-white disabled:opacity-50">
            {busy ? "Creating…" : "Create subject (stays hidden from students)"}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Subject <strong>{nameEn}</strong> created and hidden from students. Now upload its textbook PDF.
          </p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-sf border border-neutral-300 px-3 py-2 text-sm text-navy-900 hover:border-sf-blue-500">
            {busy ? "Uploading…" : "Upload textbook PDF"}
            <input type="file" accept=".pdf,application/pdf" disabled={busy} className="hidden" onChange={(e) => e.target.files?.[0] && uploadTextbook(e.target.files[0])} />
          </label>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Textbook <strong>{textbookFilename}</strong> stored privately. Now analyze it to propose a Unit/Topic structure — this reads only the
            beginning of the file (where a table of contents normally appears) and is billed to Smartify, never to a student.
          </p>
          <button onClick={analyze} disabled={busy} className="rounded-sf bg-sf-blue-500 px-4 py-2 text-sm text-white disabled:opacity-50">
            {busy ? "Analyzing…" : "Analyze Textbook"}
          </button>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">
            Scanned pages {pagesInspected?.start}–{pagesInspected?.end} of {pdfPageCount} for a table of contents. Review and edit before creating
            anything — nothing is saved yet.
          </p>
          <UnitsTopicsEditor units={units} onChange={setUnits} />
          <div>
            <button
              onClick={confirmStructure}
              disabled={busy || units.length === 0 || units.some((u) => u.topics.length === 0)}
              className="rounded-sf bg-sf-blue-500 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Creating…" : "Confirm & Create Curriculum Structure"}
            </button>
          </div>
        </div>
      )}

      {step === 5 && result && (
        <div className="space-y-3">
          <ul className="space-y-1 text-sm text-neutral-700">
            <li>✓ Subject structure created ({result.unitsCreated} units, {result.topicsCreated} topics)</li>
            <li>✓ Textbook stored</li>
            <li className="text-neutral-400">○ Ground the Subject before publishing to prepare every Unit now</li>
            <li className="text-neutral-400">○ Lessons will be generated when students open Topics</li>
          </ul>
          {subjectId && (
            <SubjectGroundingControl
              subjectId={subjectId}
              unitCount={result.unitsCreated}
              onDone={async () => { onCreated(); }}
            />
          )}
          {published ? (
            <p className="text-sm font-medium text-green-700">✓ Subject published — visible to students.</p>
          ) : (
            <>
              <p className="text-sm text-neutral-600">The subject remains hidden from students until you publish it.</p>
              <button onClick={publish} disabled={busy} className="rounded-sf bg-sf-blue-500 px-4 py-2 text-sm text-white disabled:opacity-50">
                {busy ? "Publishing…" : "Publish subject"}
              </button>
            </>
          )}
          <div>
            <button onClick={onCancel} className="text-xs text-neutral-500 underline">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sf-lg border border-neutral-200 bg-white p-4 text-center">
      <p className="text-2xl font-bold text-navy-900">{value}</p>
      <p className="mt-1 text-xs text-neutral-500">{label}</p>
    </div>
  );
}

// ============================================================
// English Extra Book / Story support V1 (2026-09-20)
// ============================================================
// Existing Subject -> Add Extra Book -> upload a SEPARATE PDF privately to
// R2 (never touches Subject.sourceFile) -> Analyze OR Enter Structure
// Manually -> the SAME editable preview as the New Subject flow -> Confirm
// -> new Units/Topics appended to this Subject, each stamped with the
// extra book's own source. Existing Units/Topics, Subject.sourceFile, and
// Subject.isActive are never touched. Reuses UnitsTopicsEditor and the
// AnalyzeResponse/DraftUnit/DraftTopic shapes already defined above.
function AddExtraBookWizard({ subjectId, subjectNameEn, onDone }: { subjectId: string; subjectNameEn: string; onDone: () => void }) {
  const { apiFetch } = useApiClient();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [noTocFound, setNoTocFound] = useState(false);

  const [bookLabel, setBookLabel] = useState("");
  const [units, setUnits] = useState<DraftUnit[]>([]);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pagesInspected, setPagesInspected] = useState<{ start: number; end: number } | null>(null);
  const [result, setResult] = useState<{ unitsCreated: number; topicsCreated: number } | null>(null);

  function errMessage(e: unknown, fallback: string) {
    return e instanceof ApiError ? e.message : fallback;
  }

  async function uploadBook(file: File) {
    if (!bookLabel.trim()) {
      setError("Enter a name for this book first.");
      return;
    }
    if (file.type !== "application/pdf") {
      setError("Only PDF files are supported.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("bookLabel", bookLabel.trim());
      await apiFetch(`/admin/curriculum/subjects/${subjectId}/extra-book`, { method: "POST", body: form });
      setStep(2);
    } catch (e) {
      setError(errMessage(e, "Upload failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    setBusy(true);
    setError("");
    setNoTocFound(false);
    try {
      const r = await apiFetch<AnalyzeResponse>(`/admin/curriculum/subjects/${subjectId}/extra-book/analyze`, {
        method: "POST",
        body: JSON.stringify({ bookLabel: bookLabel.trim() }),
      });
      setUnits(r.units);
      setPdfPageCount(r.pdfPageCount);
      setPagesInspected(r.pagesInspected);
      setStep(3);
    } catch (e) {
      // "No usable table of contents" is not a dead end — the Enter
      // Structure Manually option below stays available regardless.
      setNoTocFound(true);
      setError(errMessage(e, "Could not analyze this book."));
    } finally {
      setBusy(false);
    }
  }

  function enterManually() {
    const label = bookLabel.trim();
    setUnits([{ nameEn: `Story — ${label}`, nameAr: `قصة — ${label}`, sourcePageStart: 1, sourcePageEnd: 1, term: "TERM_1", topics: [{ nameEn: "Chapter 1", nameAr: "الفصل 1" }] }]);
    setPdfPageCount(null);
    setPagesInspected(null);
    setError("");
    setStep(3);
  }

  async function confirmStructure() {
    setBusy(true);
    setError("");
    try {
      const r = await apiFetch<{ subjectId: string; unitsCreated: number; topicsCreated: number }>(
        `/admin/curriculum/subjects/${subjectId}/extra-book/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            bookLabel: bookLabel.trim(),
            units: units.map((u) => ({ nameEn: u.nameEn, nameAr: u.nameAr, term: u.term ?? "TERM_1", sourcePageStart: u.sourcePageStart, sourcePageEnd: u.sourcePageEnd, topics: u.topics.map((t) => ({ nameEn: t.nameEn, nameAr: t.nameAr })) })),
          }),
        },
      );
      setResult(r);
      setStep(4);
      onDone();
    } catch (e) {
      setError(errMessage(e, "Could not add this book's structure. Nothing was saved — you can try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-sf border border-neutral-200 bg-neutral-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy-900">
          Add Extra Book to {subjectNameEn} — step {step} of 4
        </h3>
        {step < 4 && (
          <button onClick={onDone} className="text-xs text-neutral-500 underline">
            Cancel
          </button>
        )}
      </div>

      {error && <p className="mb-3 rounded bg-error-50 px-3 py-2 text-xs text-error-500">{error}</p>}

      {step === 1 && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Book name</label>
            <input className={`${editorInputCls} w-full`} value={bookLabel} onChange={(e) => setBookLabel(e.target.value)} placeholder="e.g. The Magic Garden" />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-sf border border-neutral-300 px-3 py-2 text-sm text-navy-900 hover:border-sf-blue-500">
            {busy ? "Uploading…" : "Upload PDF"}
            <input type="file" accept=".pdf,application/pdf" disabled={busy || !bookLabel.trim()} className="hidden" onChange={(e) => e.target.files?.[0] && uploadBook(e.target.files[0])} />
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Book <strong>{bookLabel}</strong> stored privately. Analyze it to propose a chapter structure, or enter one manually — a story book
            often has no formal table of contents, and that&apos;s fine.
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={analyze} disabled={busy} className="rounded-sf bg-sf-blue-500 px-4 py-2 text-sm text-white disabled:opacity-50">
              {busy ? "Analyzing…" : "Analyze Book"}
            </button>
            <button onClick={enterManually} disabled={busy} className="rounded-sf border border-neutral-300 px-4 py-2 text-sm text-navy-900 disabled:opacity-50">
              Enter Structure Manually
            </button>
          </div>
          {noTocFound && <p className="text-xs text-neutral-500">No table of contents was found automatically — use &quot;Enter Structure Manually&quot; above instead.</p>}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">
            {pagesInspected
              ? `Scanned pages ${pagesInspected.start}–${pagesInspected.end} of ${pdfPageCount} for a table of contents. `
              : ""}
            Review and edit before adding anything to {subjectNameEn} — nothing is saved yet. Page numbers are PDF page positions, which may differ
            from this book&apos;s own printed page numbers — check the real file if unsure.
          </p>
          <UnitsTopicsEditor units={units} onChange={setUnits} />
          <div>
            <button
              onClick={confirmStructure}
              disabled={busy || units.length === 0 || units.some((u) => u.topics.length === 0)}
              className="rounded-sf bg-sf-blue-500 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Adding…" : `Confirm & Add to ${subjectNameEn}`}
            </button>
          </div>
        </div>
      )}

      {step === 4 && result && (
        <div className="space-y-2">
          <ul className="space-y-1 text-sm text-neutral-700">
            <li>✓ Extra book stored privately</li>
            <li>
              ✓ Story Units added to {subjectNameEn} ({result.unitsCreated} units, {result.topicsCreated} topics)
            </li>
            <li className="text-neutral-400">○ Grounding will happen when needed</li>
            <li className="text-neutral-400">○ Lessons will generate when students open Topics</li>
          </ul>
          <button onClick={onDone} className="text-xs text-neutral-500 underline">
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function SharedContentEditor({
  subject,
  gradeLevel,
  curriculumCode,
  curricula,
  onSaved,
}: {
  subject: SubjectStatus;
  gradeLevel: number;
  curriculumCode: string;
  curricula: CurriculumStatus[];
  onSaved: () => void;
}) {
  const { apiFetch } = useApiClient();
  const [sourceId, setSourceId] = useState(subject.sharedContentSubjectId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sources = curricula
    .filter((curriculum) => curriculum.code === "EG_NATIONAL" && curriculum.isActive)
    .flatMap((curriculum) => curriculum.grades.filter((grade) => grade.isActive && grade.level === gradeLevel).flatMap((grade) => grade.subjects))
    .filter((candidate) => candidate.isActive && candidate.units.length > 0 && candidate.shareEligible && subjectKindForShare(candidate.nameEn, candidate.nameAr) === subjectKindForShare(subject.nameEn, subject.nameAr));

  if (!subject.shareEligible || !SHARED_TARGET_CURRICULUM_CODES.includes(curriculumCode)) return null;

  async function save() {
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/admin/curriculum/subjects/${subject.id}/shared-content`, {
        method: "PATCH",
        body: JSON.stringify({ sharedContentSubjectId: sourceId || null }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save shared content.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-sf border border-sf-blue-100 bg-sf-blue-50 p-3 text-xs">
      <p className="font-medium text-navy-900">Reuse Egyptian MOE content</p>
      <p className="mt-1 text-neutral-600">Shares the same textbook, topics, and grounding. It does not upload or regenerate content.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value={sourceId} onChange={(event) => setSourceId(event.target.value)} disabled={busy} className="max-w-full rounded-sf border border-neutral-300 bg-white px-2 py-1">
          <option value="">No shared source</option>
          {sources.map((source) => <option key={source.id} value={source.id}>{source.nameEn} · {source.nameAr}</option>)}
        </select>
        <button onClick={save} disabled={busy || sourceId === (subject.sharedContentSubjectId ?? "")} className="rounded-sf border border-neutral-300 px-2 py-1 text-navy-900 disabled:opacity-50">
          {busy ? "Saving…" : "Save sharing"}
        </button>
      </div>
      {subject.sharedContentSubject && <p className="mt-1 text-green-700">Using {subject.sharedContentSubject.nameEn} · {subject.sharedContentSubject.nameAr}</p>}
      {error && <p className="mt-1 text-error-500">{error}</p>}
    </div>
  );
}

function subjectKindForShare(nameEn: string, nameAr: string): "ARABIC" | "SOCIAL_STUDIES" | null {
  const value = `${nameEn} ${nameAr}`.toLocaleLowerCase();
  if (value.includes("arabic") || value.includes("عربي") || value.includes("العربية")) return "ARABIC";
  if ((value.includes("social") && value.includes("studies")) || value.includes("الدراسات الاجتماعية")) return "SOCIAL_STUDIES";
  return null;
}

function AddSharedSubjectControl({
  grade,
  curriculumCode,
  curricula,
  onCreated,
}: {
  grade: GradeStatus;
  curriculumCode: string;
  curricula: CurriculumStatus[];
  onCreated: () => void;
}) {
  const { apiFetch } = useApiClient();
  const [sourceId, setSourceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const eligibleSources = curricula
    .filter((curriculum) => curriculum.code === "EG_NATIONAL" && curriculum.isActive)
    .flatMap((curriculum) => curriculum.grades.filter((sourceGrade) => sourceGrade.isActive && sourceGrade.level === grade.level).flatMap((sourceGrade) => sourceGrade.subjects.filter((source) => source.isActive && source.units.length > 0 && source.shareEligible)))
    .filter((source) => !grade.subjects.some((current) => subjectKindForShare(current.nameEn, current.nameAr) === subjectKindForShare(source.nameEn, source.nameAr)));

  if (!grade.isActive || !SHARED_TARGET_CURRICULUM_CODES.includes(curriculumCode) || eligibleSources.length === 0) return null;

  async function create() {
    if (!sourceId) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch("/admin/curriculum/subjects/shared-content", {
        method: "POST",
        body: JSON.stringify({ targetGradeId: grade.id, sourceSubjectId: sourceId }),
      });
      setSourceId("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the shared subject.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-sf border border-dashed border-sf-blue-200 bg-sf-blue-50 p-3 text-xs">
      <p className="font-medium text-navy-900">Add Arabic or Social Studies from MOE</p>
      <p className="mt-1 text-neutral-600">Adds the catalog subject for this grade and points to its existing MOE content. No textbook upload or grounding runs.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value={sourceId} onChange={(event) => setSourceId(event.target.value)} disabled={busy} className="max-w-full rounded-sf border border-neutral-300 bg-white px-2 py-1">
          <option value="">Choose matching MOE subject</option>
          {eligibleSources.map((source) => <option key={source.id} value={source.id}>{source.nameEn} · {source.nameAr}</option>)}
        </select>
        <button onClick={create} disabled={busy || !sourceId} className="rounded-sf bg-sf-blue-500 px-3 py-1 text-white disabled:opacity-50">
          {busy ? "Adding…" : "Add shared subject"}
        </button>
      </div>
      {error && <p className="mt-1 text-error-500">{error}</p>}
    </div>
  );
}

type SharedRepairResult = {
  linked: number;
  created: number;
  activated: number;
  alreadyReady: number;
  missingSources: Array<{ gradeId: string; level: number; kind: string }>;
  conflicts: Array<{ gradeId: string; curriculumCode: string; kind: string; reason: string }>;
};

function StatusSection() {
  const { apiFetch } = useApiClient();
  const [data, setData] = useState<CurriculumStatusResponse | null>(null);
  const [error, setError] = useState("");
  const [extraBookSubjectId, setExtraBookSubjectId] = useState<string | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairResult, setRepairResult] = useState<SharedRepairResult | null>(null);
  const [repairError, setRepairError] = useState("");
  const [termAssignBusy, setTermAssignBusy] = useState(false);
  const [deletingSubjectId, setDeletingSubjectId] = useState<string | null>(null);

  function refetch() {
    return apiFetch<CurriculumStatusResponse>("/admin/curriculum/status")
      .then(setData)
      .catch(() => setError("Could not load curriculum status."));
  }

  async function repairSharedSubjects() {
    setRepairBusy(true);
    setRepairResult(null);
    setRepairError("");
    try {
      const result = await apiFetch<SharedRepairResult>("/admin/curriculum/shared-content/repair", { method: "POST" });
      setRepairResult(result);
      await refetch();
    } catch {
      setRepairError("Could not repair Arabic and Social Studies sharing. Refresh and try again.");
    } finally {
      setRepairBusy(false);
    }
  }

  async function assignUnassignedUnitsToTerm1() {
    if (!window.confirm("Set all Units that do not have a term yet to Term 1? Existing Term 1/Term 2 assignments will stay unchanged.")) return;
    setTermAssignBusy(true);
    try {
      const result = await apiFetch<{ updatedUnits: number }>("/admin/curriculum/units/unassigned-term", {
        method: "PATCH",
        body: JSON.stringify({ term: "TERM_1" }),
      });
      await refetch();
      setError("");
      window.alert(`${result.updatedUnits} Unit(s) assigned to Term 1.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not assign untagged Units to Term 1.");
    } finally {
      setTermAssignBusy(false);
    }
  }

  async function deleteSubject(subject: SubjectStatus) {
    const confirmed = window.confirm(`Permanently delete ${subject.nameEn} and its Units, Topics, generated lessons, and questions? Student access or learning history will block deletion. This cannot be undone.`);
    if (!confirmed) return;
    setDeletingSubjectId(subject.id);
    try {
      await apiFetch(`/admin/curriculum/subjects/${subject.id}`, { method: "DELETE" });
      setError("");
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not delete ${subject.nameEn}.`);
    } finally {
      setDeletingSubjectId(null);
    }
  }

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return <div className="mt-6 rounded-sf-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">{error}</div>;
  }
  if (!data) {
    return <div className="mt-6 rounded-sf-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-400">Loading curriculum status…</div>;
  }

  const { summary, curricula } = data;

  return (
    <div className="mt-6">
      <h2 className="font-semibold text-navy-900">Curriculum content status</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Review textbook mapping, Unit grounding, and Topic generation. Grounding starts only when you explicitly run it for a Subject.
      </p>

      <div className="mt-4 rounded-sf border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium text-navy-900">Arabic and Social Studies visibility</p>
            <p className="mt-1 text-sm text-neutral-500">Link same-grade MOE content to British and American curricula. This does not upload books, run grounding, or change prices.</p>
          </div>
          <button onClick={() => void repairSharedSubjects()} disabled={repairBusy} className="rounded-sf bg-sf-blue-500 px-4 py-2 text-sm text-white disabled:opacity-50">
            {repairBusy ? "Repairing…" : "Repair subject sharing"}
          </button>
        </div>
        {repairResult && <div className="mt-3 text-sm text-neutral-700" role="status">
          <p>Linked {repairResult.linked}, added {repairResult.created}, activated {repairResult.activated}, already ready {repairResult.alreadyReady}.</p>
          {repairResult.missingSources.length > 0 && <p className="mt-1 text-amber-700">MOE content unavailable for {repairResult.missingSources.length} grade/subject pair(s); no substitute material was created.</p>}
          {repairResult.conflicts.length > 0 && <p className="mt-1 text-amber-700">{repairResult.conflicts.length} existing subject(s) need review because they contain their own content or have conflicting links.</p>}
        </div>}
        {repairError && <p className="mt-3 text-sm text-error-500" role="alert">{repairError}</p>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryTile label="Subjects" value={summary.subjects} />
        <SummaryTile label="Units" value={summary.units} />
        <SummaryTile label="Grounded units" value={summary.groundedUnits} />
        <SummaryTile label="Topics" value={summary.topics} />
        <SummaryTile label="Generated topics" value={summary.generatedTopics} />
        <SummaryTile label="Textbook-grounded topics" value={summary.textbookGroundedTopics} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-sf border border-neutral-200 bg-white p-4">
        <div>
          <p className="font-medium text-navy-900">School terms</p>
          <p className="mt-1 text-sm text-neutral-500">Current unassigned Units can be marked as Term 1. New Units default to Term 1; change them to Term 2 when you add that material.</p>
        </div>
        <button type="button" onClick={() => void assignUnassignedUnitsToTerm1()} disabled={termAssignBusy} className="rounded-sf border border-sf-blue-300 px-4 py-2 text-sm text-sf-blue-700 disabled:opacity-50">
          {termAssignBusy ? "Saving…" : "Mark unassigned Units as Term 1"}
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {curricula.map((c) => (
          <details key={c.id} className="rounded-sf-lg border border-neutral-200 bg-white p-4">
            <summary className="cursor-pointer font-semibold text-navy-900">
              {c.nameEn} {!c.isActive && <span className="text-xs font-normal text-neutral-400">(inactive)</span>}
            </summary>
            <div className="mt-3 space-y-3 pl-4">
              {c.grades.map((g) => (
                <details key={g.id} className="rounded-sf border border-neutral-100 p-3">
                  <summary className="cursor-pointer font-medium text-navy-900">
                    {g.nameEn} {!g.isActive && <span className="text-xs font-normal text-neutral-400">(inactive)</span>}
                  </summary>
                  <div className="mt-2 space-y-2 pl-4">
                    <AddSharedSubjectControl grade={g} curriculumCode={c.code} curricula={curricula} onCreated={refetch} />
                    {g.subjects.map((s) => (
                      <details key={s.id} className="rounded-sf border border-neutral-100 p-3">
                        <summary className="cursor-pointer text-sm font-medium text-navy-900">
                          {s.nameEn}{" "}
                          {!s.isActive && <span className="text-xs font-normal text-amber-700">(inactive — hidden from students)</span>}{" "}
                          {s.sharedContentSubjectId ? (
                            <span className="text-xs font-normal text-green-700">✓ MOE content shared</span>
                          ) : s.textbookMapped ? (
                            <span className="text-xs font-normal text-green-700">✓ Textbook mapped</span>
                          ) : (
                            <span className="text-xs font-normal text-neutral-400">✗ No textbook mapped</span>
                          )}
                        </summary>
                        {!s.isActive && (s.units.length > 0 || s.sharedContentSubjectId) && <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(`Publish ${s.nameEn} for students?`)) return;
                            try {
                              await apiFetch(`/admin/curriculum/subjects/${s.id}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) });
                              await refetch();
                            } catch { setError(`Could not publish ${s.nameEn}.`); }
                          }}
                          className="ml-2 rounded border border-amber-300 px-2 py-1 text-xs text-amber-800"
                        >Publish subject</button>}
                        <SharedContentEditor subject={s} gradeLevel={g.level} curriculumCode={c.code} curricula={curricula} onSaved={refetch} />
                        <button
                          type="button"
                          onClick={() => void deleteSubject(s)}
                          disabled={deletingSubjectId === s.id}
                          className="ml-2 rounded border border-error-200 px-2 py-1 text-xs text-error-600 disabled:opacity-50"
                        >{deletingSubjectId === s.id ? "Deleting…" : "Delete subject"}</button>
                        {s.sharedContentSubjectId ? (
                          <p className="mt-1 pl-2 text-xs text-green-700">Textbook and grounding are managed by the linked Egyptian MOE subject. Do not upload or ground this subject again.</p>
                        ) : s.textbookMapped ? (
                          <div className="mt-1 pl-2">
                            <p className="text-xs text-neutral-500">Source: {s.sourceFile}</p>
                            <p className="mt-1 text-xs text-neutral-400">Textbook replacement will be available separately.</p>
                          </div>
                        ) : (
                          <TextbookUploadControl subjectId={s.id} onUploaded={refetch} />
                        )}

                        <div className="mt-1 flex items-center gap-2 pl-2 text-xs text-neutral-500">
                          <span>Price: {s.priceEGP != null ? `${s.priceEGP} EGP/mo` : "Not yet priced"}</span>
                        </div>
                        <SubjectPriceEditor subjectId={s.id} priceEGP={s.priceEGP} onSaved={() => refetch()} />

                        {!s.sharedContentSubjectId && <SubjectGroundingControl subjectId={s.id} units={s.units} onDone={refetch} />}

                        {/* English Extra Book / Story support V1 — clearly secondary to "Add New Subject" above: a small text link, not a button, and only ever appended (never replaces the main textbook or this Subject's existing Units). */}
                        {!s.sharedContentSubjectId && extraBookSubjectId === s.id ? (
                          <AddExtraBookWizard
                            subjectId={s.id}
                            subjectNameEn={s.nameEn}
                            onDone={() => {
                              setExtraBookSubjectId(null);
                              refetch();
                            }}
                          />
                        ) : !s.sharedContentSubjectId ? (
                          <button onClick={() => setExtraBookSubjectId(s.id)} className="mt-1 pl-2 text-xs text-neutral-400 underline hover:text-neutral-600">
                            + Add Extra Book
                          </button>
                        ) : null}
                        <div className="mt-2 space-y-2 pl-4">
                          {s.units.length === 0 && <p className="text-xs text-neutral-400">No units.</p>}
                          {s.units.map((u) => (
                            <details key={u.id} className="rounded-sf border border-neutral-100 p-3">
                              <summary className="cursor-pointer text-sm text-navy-900">
                                {u.nameEn}{" "}
                                <span className={`rounded-full px-2 py-0.5 text-xs ${u.term === "TERM_2" ? "bg-blue-50 text-blue-700" : u.term === "TERM_1" ? "bg-purple-50 text-purple-700" : "bg-neutral-100 text-neutral-500"}`}>
                                  {u.term === "TERM_2" ? "Term 2" : u.term === "TERM_1" ? "Term 1" : "Term not set"}
                                </span>{" "}
                                {u.sourcePageStart != null && u.sourcePageEnd != null && (
                                  <span className="text-xs text-neutral-400">
                                    (pages {u.sourcePageStart}–{u.sourcePageEnd})
                                  </span>
                                )}{" "}
                                {u.usesExtraSource && (
                                  <span className="text-xs text-neutral-400" title="This Unit's content comes from an extra/story book, not the Subject's main textbook">
                                    (extra source)
                                  </span>
                                )}{" "}
                                {u.grounded ? (
                                  <span className="text-xs font-medium text-green-700">✓ Grounded</span>
                                ) : (
                                  <span className="text-xs font-medium text-neutral-400">✗ Ungrounded</span>
                                )}
                              </summary>
                              <label className="mt-2 inline-flex items-center gap-2 pl-2 text-xs text-neutral-500">
                                Term
                                <select
                                  aria-label={`Term for ${u.nameEn}`}
                                  value={u.term ?? ""}
                                  onChange={async (event) => {
                                    if (!event.target.value) return;
                                    try {
                                      await apiFetch(`/admin/curriculum/units/${u.id}/term`, { method: "PATCH", body: JSON.stringify({ term: event.target.value }) });
                                      await refetch();
                                    } catch (err) {
                                      setError(err instanceof ApiError ? err.message : `Could not update the term for ${u.nameEn}.`);
                                    }
                                  }}
                                  className="rounded border border-neutral-300 bg-white px-2 py-1"
                                >
                                  <option value="">Term not set</option>
                                  <option value="TERM_1">Term 1</option>
                                  <option value="TERM_2">Term 2</option>
                                </select>
                              </label>
                              {u.grounded && (
                                <p className="mt-1 pl-2 text-xs text-neutral-500">
                                  Model: {u.groundingModel ?? "—"} · Grounded:{" "}
                                  {u.groundingGeneratedAt ? new Date(u.groundingGeneratedAt).toLocaleString() : "—"} · Version:{" "}
                                  {u.groundingVersion ?? "—"}
                                </p>
                              )}
                              <ul className="mt-2 space-y-1 pl-4">
                                {u.topics.map((t) => (
                                  <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                                    <span className="text-neutral-700">{t.nameEn}</span>
                                    <TopicStatusBadge status={t.status} />
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

type GroundingActionResult = {
  subjectId: string;
  status: "READY" | "UNIT_READY" | "PREPARING" | "RETRYABLE_FAILURE" | "CONFIGURATION_ERROR" | "PROVIDER_OUTAGE" | "NO_UNITS";
  unitId?: string;
  unitNameEn?: string;
  retryAfterMs?: number;
  reason?: string;
  groundedUnits: number;
  totalUnits: number;
};

function SubjectGroundingControl({ subjectId, units, unitCount, onDone }: { subjectId: string; units?: UnitStatus[]; unitCount?: number; onDone: () => Promise<void> }) {
  const { apiFetch } = useApiClient();
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [complete, setComplete] = useState(!!units && units.length > 0 && units.every((unit) => unit.grounded));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function run() {
    if (busy || totalUnits === 0 || complete || ungrounded === 0) return;
    if (!started && !window.confirm(`Start grounding this Subject? This uses the platform content-authoring AI budget. Each click processes one bounded page chunk, and progress can be resumed.`)) return;
    setBusy(true);
    setStarted(true);
    setError("");
    setMessage("Processing one grounding chunk…");
    try {
      const result = await apiFetch<GroundingActionResult>(`/admin/curriculum/subjects/${subjectId}/prepare-grounding`, { method: "POST" });
      setMessage(`${result.unitNameEn ? `${result.unitNameEn}: ` : ""}${result.groundedUnits}/${result.totalUnits} units complete.`);

      if (result.status === "READY") {
        setComplete(true);
        setMessage(`Grounding complete: ${result.groundedUnits}/${result.totalUnits} units.`);
      } else if (result.status === "NO_UNITS") {
        setMessage("Add Units before grounding this Subject.");
      } else if (result.status === "CONFIGURATION_ERROR" || result.status === "PROVIDER_OUTAGE") {
        setError(result.status === "PROVIDER_OUTAGE"
          ? "The AI provider is out of capacity. Progress is saved; try again later."
          : "Grounding is blocked by a source or page-range issue. Fix the Unit setup, then resume.");
        setMessage("");
      } else if (result.status === "RETRYABLE_FAILURE") {
        const seconds = Math.ceil((result.retryAfterMs ?? 5000) / 1000);
        setMessage(`Temporary grounding issue. Wait about ${seconds} second(s), then click Continue grounding to retry.`);
      } else if (result.status === "UNIT_READY") {
        setMessage(`${result.unitNameEn ?? "Unit"} is grounded. Click Continue grounding for the next Unit.`);
        await onDone();
      } else if (result.status === "PREPARING") {
        setMessage(`${result.unitNameEn ?? "Grounding"} is still in progress. Click Continue grounding shortly to resume.`);
      } else {
        setMessage("Click Continue grounding to process the next chunk.");
      }
      if (result.status !== "UNIT_READY") await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Grounding failed. Saved progress can be resumed.");
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  const totalUnits = units?.length ?? unitCount ?? 0;
  const ungrounded = units ? units.filter((unit) => !unit.grounded).length : (complete ? 0 : totalUnits);
  return (
    <div className="mt-2 pl-2">
      <button onClick={run} disabled={busy || totalUnits === 0 || complete || ungrounded === 0} className="rounded-sf border border-sf-blue-500 px-3 py-1.5 text-xs font-medium text-sf-blue-700 disabled:opacity-50">
        {busy ? "Grounding chunk…" : complete || (ungrounded === 0 && totalUnits > 0) ? "All units grounded" : started ? "Continue grounding" : "Ground this subject"}
      </button>
      <p className="mt-1 text-xs text-neutral-400">Uses the mapped textbook and each Unit’s page range. Each click processes one bounded chunk; progress is saved and can be resumed. This does not publish the Subject or generate lessons and questions.</p>
      {message && <p className="mt-1 text-xs text-neutral-600" role="status">{message}</p>}
      {error && <p className="mt-1 text-xs text-error-500" role="alert">{error}</p>}
    </div>
  );
}

// Admin "Add curriculum" (2026-10-10). New curricula are created hidden
// from students (backend sets isActive: false) so admins can add subjects
// first, then use "Show curriculum to students".
function AddCurriculumForm({ onCreated, onCancel }: { onCreated: (c: Curriculum) => void; onCancel: () => void }) {
  const { apiFetch } = useApiClient();
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [code, setCode] = useState("");
  const [gradeCount, setGradeCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!nameEn.trim() || !nameAr.trim()) {
      setError("English and Arabic names are both required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await apiFetch<Curriculum>("/admin/curriculum/curricula", {
        method: "POST",
        body: JSON.stringify({
          nameEn: nameEn.trim(),
          nameAr: nameAr.trim(),
          gradeCount,
          ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
        }),
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the curriculum.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "w-full rounded-sf border border-neutral-300 px-3 py-2 text-sm";
  return (
    <form onSubmit={submit} className="mb-5 space-y-3 rounded-sf border border-neutral-200 bg-[--sf-bg-subtle] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-neutral-700">
          Name (English)
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="Egyptian Languages Curriculum" className={inputClass} />
        </label>
        <label className="text-sm text-neutral-700">
          Name (Arabic)
          <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="منهج اللغات" dir="rtl" className={inputClass} />
        </label>
        <label className="text-sm text-neutral-700">
          Code (optional)
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="EG_LANGUAGES" className={`${inputClass} font-mono uppercase`} />
        </label>
        <label className="text-sm text-neutral-700">
          Create grades 1 to
          <input type="number" min={0} max={12} value={gradeCount} onChange={(e) => setGradeCount(Math.max(0, Math.min(12, Number(e.target.value) || 0)))} className={inputClass} />
        </label>
      </div>
      <p className="text-xs text-neutral-500">The curriculum starts hidden from students. Add its subjects, then click “Show curriculum to students”.</p>
      {error && <p className="text-sm text-error-600" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-sf bg-sf-blue-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Creating…" : "Create curriculum"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-sf border border-neutral-300 px-3 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

function CurriculaSection() {
  const { apiFetch } = useApiClient();
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [grades, setGrades] = useState<Grade[]>([]);
  const [curriculumActionBusy, setCurriculumActionBusy] = useState(false);
  const [curriculumActionError, setCurriculumActionError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

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
    if (c.isActive && !window.confirm(`Hide ${c.nameEn} from student curriculum choices? Existing student records and subscriptions will be kept.`)) return;
    setCurriculumActionBusy(true);
    setCurriculumActionError("");
    try {
      await apiFetch(`/admin/curriculum/curricula/${c.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !c.isActive }) });
      setCurricula((prev) => prev.map((x) => (x.id === c.id ? { ...x, isActive: !x.isActive } : x)));
    } catch (err) {
      setCurriculumActionError(err instanceof ApiError ? err.message : "Could not update this curriculum.");
    } finally {
      setCurriculumActionBusy(false);
    }
  }

  async function toggleGradeActive(g: Grade) {
    await apiFetch(`/admin/curriculum/grades/${g.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !g.isActive }) });
    setGrades((prev) => prev.map((x) => (x.id === g.id ? { ...x, isActive: !x.isActive } : x)));
  }

  function handleCurriculumCreated(created: Curriculum) {
    setCurricula((prev) => [...prev, created]);
    setSelectedId(created.id);
    setShowAddForm(false);
  }

  return (
    <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-navy-900">Curricula</h2>
        {!showAddForm && (
          <button onClick={() => setShowAddForm(true)} className="rounded-sf bg-sf-blue-500 px-3 py-2 text-sm font-medium text-white">
            + Add curriculum
          </button>
        )}
      </div>
      {showAddForm && <AddCurriculumForm onCreated={handleCurriculumCreated} onCancel={() => setShowAddForm(false)} />}
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
          disabled={curriculumActionBusy}
          className="mt-3 rounded-sf border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 disabled:opacity-50"
        >
          {curriculumActionBusy ? "Saving…" : curricula.find((c) => c.id === selectedId)?.isActive ? "Hide curriculum from students" : "Show curriculum to students"}
        </button>
      )}
      {curriculumActionError && <p className="mt-2 text-sm text-error-600" role="alert">{curriculumActionError}</p>}

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
  const [showWizard, setShowWizard] = useState(false);
  const [statusRefreshToken, setStatusRefreshToken] = useState(0);

  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN", "CONTENT_MANAGER"]}>
      <main className="py-12">
        <SmartifyContainer className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-bold text-navy-900">Curriculum & Pricing</h1>
          <div className="mt-6">
            <CurriculaSection />
          </div>
          {canSeePricing && <PricingSection />}

          <div className="mt-6 flex items-center justify-between">
            <h2 className="font-semibold text-navy-900">Subjects</h2>
            {!showWizard && (
              <button onClick={() => setShowWizard(true)} className="rounded-sf bg-sf-blue-500 px-4 py-2 text-sm text-white">
                Add New Subject
              </button>
            )}
          </div>
          {showWizard && (
            <AddSubjectWizard
              onCreated={() => setStatusRefreshToken((t) => t + 1)}
              onCancel={() => setShowWizard(false)}
            />
          )}

          <StatusSection key={statusRefreshToken} />
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
