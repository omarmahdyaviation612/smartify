"use client";
import { useState } from "react";
import { SmartifyButton } from "@smartify/ui";
import { useApiClient } from "@/lib/api-client";

export function StudentLinkCodeCard({ isAr }: { isAr: boolean }) {
  const { apiFetch } = useApiClient();
  const [code, setCode] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    try {
      const result = await apiFetch<{ code: string }>("/student/link-code", { method: "POST" });
      setCode(result.code);
      setLink(`${window.location.origin}/${isAr ? "ar" : "en"}/parent?code=${encodeURIComponent(result.code)}`);
      setError("");
    }
    catch (e: any) { setError(e.message); }
  }
  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e: any) {
      setError(e?.message ?? (isAr ? "تعذر نسخ الرابط." : "Could not copy the link."));
    }
  }
  async function shareLink() {
    if (!link) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: isAr ? "رابط ربط ولي الأمر" : "Parent linking invitation",
          text: isAr ? "افتح الرابط لإتمام ربط حساب ولي الأمر بحساب الطالب." : "Open this link to connect your parent account to the student.",
          url: link,
        });
        return;
      }
      await copyLink();
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message ?? (isAr ? "تعذرت مشاركة الرابط." : "Could not share the link."));
    }
  }
  return <div className="rounded-sf-lg border border-neutral-200 bg-white p-6">
    <h2 className="font-semibold text-navy-900">{isAr ? "ربط ولي الأمر" : "Link a parent"}</h2>
    <p className="my-2 text-sm text-neutral-600">{isAr ? "أنشئ رابطًا وشاركه مع ولي أمرك لإتمام الربط." : "Create a link and share it with your parent to connect accounts."}</p>
    <p className="mb-3 text-xs text-neutral-500">{isAr
      ? "ميزة ولي الأمر قيد الطرح حاليًا. يحتاج والدك/والدتك إلى تفعيل وصول ولي الأمر على حسابه في سمارتيفاي قبل أن يتمكن من استخدام هذا الرابط."
      : "Parent access is currently being rolled out. Your parent will need Parent access enabled on their Smartify account before they can use this link."}</p>
    {code ? <>
      <p className="mb-3 rounded bg-neutral-100 p-3 text-center text-xl font-bold tracking-widest">{code}</p>
      <div className="flex flex-wrap gap-2">
        <SmartifyButton onClick={copyLink} variant="secondary">{copied ? (isAr ? "تم النسخ" : "Copied") : (isAr ? "نسخ الرابط" : "Copy link")}</SmartifyButton>
        <SmartifyButton onClick={shareLink}>{isAr ? "مشاركة الرابط" : "Share link"}</SmartifyButton>
      </div>
      <p className="mt-2 break-all text-xs text-neutral-500" dir="ltr">{link}</p>
    </> : <SmartifyButton onClick={create}>{isAr ? "إنشاء رابط لولي الأمر" : "Create parent link"}</SmartifyButton>}
    {error && <p className="mt-2 text-sm text-error-500">{error}</p>}
  </div>;
}
