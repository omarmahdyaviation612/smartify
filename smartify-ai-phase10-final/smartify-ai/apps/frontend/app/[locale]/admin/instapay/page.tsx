"use client";

import { useEffect, useState } from "react";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { useApiClient } from "@/lib/api-client";

interface Submission {
  id: string;
  kind: "SUBSCRIPTION" | "QUESTION_PACK";
  referenceId: string;
  expectedAmountEGP: string;
  submittedAmountEGP: string;
  senderName: string | null;
  note: string | null;
  status: "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED";
  createdAt: string;
  verifiedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  student: { id: string; fullName: string; user: { email: string } };
}

function ReceiptViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const { apiFetchBlob } = useApiClient();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    apiFetchBlob(`/admin/instapay/submissions/${id}/receipt`).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="max-h-[85vh] max-w-2xl overflow-auto rounded-sf-lg bg-white p-4" onClick={(e) => e.stopPropagation()}>
        {url ? <img src={url} alt="Payment receipt" className="max-w-full" /> : <p className="p-8 text-sm text-neutral-500">Loading receipt...</p>}
        <button type="button" onClick={onClose} className="mt-3 w-full rounded-sf border border-neutral-300 py-2 text-sm">Close</button>
      </div>
    </div>
  );
}

function SubmissionRow({ submission, onAction }: { submission: Submission; onAction?: (action: "confirm" | "reject", reason?: string) => Promise<void> }) {
  const { apiFetch } = useApiClient();
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(action: "confirm" | "reject") {
    if (!onAction) return;
    let reason: string | undefined;
    if (action === "reject") {
      reason = window.prompt("Optional rejection reason:") ?? undefined;
    }
    setBusy(true);
    setMessage("");
    try {
      await onAction(action, reason);
    } catch (err: any) {
      setMessage(err?.message ?? "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-neutral-100 text-sm">
      <td className="py-2 pr-4 font-mono text-xs">{submission.referenceId}</td>
      <td className="py-2 pr-4">{submission.student.fullName}<br /><span className="text-xs text-neutral-400">{submission.student.user.email}</span></td>
      <td className="py-2 pr-4">{submission.kind === "SUBSCRIPTION" ? "Subscription" : "Question pack"}</td>
      <td className="py-2 pr-4">{submission.expectedAmountEGP} EGP</td>
      <td className="py-2 pr-4">{submission.submittedAmountEGP} EGP{submission.senderName ? ` — ${submission.senderName}` : ""}</td>
      <td className="py-2 pr-4">{new Date(submission.createdAt).toLocaleString()}</td>
      <td className="py-2 pr-4">
        <button type="button" className="text-sf-blue-500 underline" onClick={() => setReceiptId(submission.id)}>View receipt</button>
        {receiptId && <ReceiptViewer id={receiptId} onClose={() => setReceiptId(null)} />}
      </td>
      <td className="py-2 pr-4">
        {onAction ? (
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => run("confirm")} className="rounded-sf bg-sf-blue-500 px-3 py-1 text-xs text-white disabled:opacity-50">Confirm</button>
            <button type="button" disabled={busy} onClick={() => run("reject")} className="rounded-sf border border-error-300 px-3 py-1 text-xs text-error-600 disabled:opacity-50">Reject</button>
          </div>
        ) : (
          <span className={submission.status === "VERIFIED" ? "text-sf-blue-500" : "text-error-500"}>
            {submission.status === "VERIFIED" ? "Verified" : `Rejected${submission.rejectionReason ? `: ${submission.rejectionReason}` : ""}`}
          </span>
        )}
        {message && <p className="mt-1 text-xs text-error-500">{message}</p>}
      </td>
    </tr>
  );
}

export default function AdminInstapayPage() {
  const { apiFetch } = useApiClient();
  const [pending, setPending] = useState<Submission[] | null>(null);
  const [history, setHistory] = useState<Submission[] | null>(null);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [error, setError] = useState("");

  function load() {
    apiFetch<Submission[]>("/admin/instapay/pending").then(setPending).catch(() => setError("Could not load pending payments."));
    apiFetch<Submission[]>("/admin/instapay/history").then(setHistory).catch(() => {});
  }

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAction(id: string, action: "confirm" | "reject", reason?: string) {
    await apiFetch(`/admin/instapay/submissions/${id}/${action}`, {
      method: "POST",
      body: action === "reject" ? JSON.stringify({ reason }) : undefined,
    });
    load();
  }

  return (
    <AdminGuard allowedRoles={["SUPER_ADMIN", "ADMIN"]}>
      <main className="py-12">
        <SmartifyContainer>
          <h1 className="text-2xl font-bold text-navy-900">InstaPay Payments</h1>
          <p className="mt-1 text-sm text-neutral-500">Manual payment submissions awaiting confirmation. Only your confirmation grants entitlement — the receipt image is not treated as proof by itself.</p>

          <div className="mt-6 flex gap-4 border-b border-neutral-200">
            <button type="button" onClick={() => setTab("pending")} className={`pb-2 text-sm font-medium ${tab === "pending" ? "border-b-2 border-sf-blue-500 text-navy-900" : "text-neutral-400"}`}>
              Pending {pending ? `(${pending.length})` : ""}
            </button>
            <button type="button" onClick={() => setTab("history")} className={`pb-2 text-sm font-medium ${tab === "history" ? "border-b-2 border-sf-blue-500 text-navy-900" : "text-neutral-400"}`}>
              Confirmed / Rejected
            </button>
          </div>

          {error && <p className="mt-4 text-sm text-error-500">{error}</p>}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-400">
                  <th className="py-2 pr-4">Reference</th>
                  <th className="py-2 pr-4">Student</th>
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4">Expected</th>
                  <th className="py-2 pr-4">Submitted</th>
                  <th className="py-2 pr-4">Submitted at</th>
                  <th className="py-2 pr-4">Receipt</th>
                  <th className="py-2 pr-4">{tab === "pending" ? "Action" : "Result"}</th>
                </tr>
              </thead>
              <tbody>
                {tab === "pending"
                  ? (pending ?? []).map((s) => (
                      <SubmissionRow key={s.id} submission={s} onAction={(action, reason) => handleAction(s.id, action, reason)} />
                    ))
                  : (history ?? []).map((s) => <SubmissionRow key={s.id} submission={s} />)}
              </tbody>
            </table>
            {tab === "pending" && pending?.length === 0 && <p className="py-6 text-center text-sm text-neutral-400">No pending InstaPay payments.</p>}
            {tab === "history" && history?.length === 0 && <p className="py-6 text-center text-sm text-neutral-400">No resolved InstaPay payments yet.</p>}
          </div>
        </SmartifyContainer>
      </main>
    </AdminGuard>
  );
}
