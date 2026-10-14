"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SmartifyContainer } from "@smartify/ui";
import { AdminGuard } from "@/components/AdminGuard";
import { AdminDashboardLink } from "@/components/AdminDashboardLink";
import { useApiClient } from "@/lib/api-client";

interface Group { revenueEGP: number; studentCount: number; governorate?: string; area?: string; name?: string; ageGroup?: string; id?: string; nameEn?: string; nameAr?: string }
interface RevenueAnalytics {
  activeSubscriptionCount: number;
  monthlyRecurringRevenueEGP: number;
  byArea: Group[];
  byCurriculum: Group[];
  byAgeGroup: Group[];
  bySubject: Group[];
  unattributedSubjectRevenueEGP: number;
  notes: string[];
}

function formatEGP(value: number) {
  return `${new Intl.NumberFormat("en-EG", { maximumFractionDigits: 2 }).format(value)} EGP`;
}

function RevenueTable({ title, rows, label, empty }: { title: string; rows: Group[]; label: (row: Group) => string; empty: string }) {
  return (
    <section className="rounded-sf-lg border border-neutral-200 bg-white p-5">
      <h2 className="mb-4 text-lg font-semibold text-navy-900">{title}</h2>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b text-start text-neutral-500"><th className="py-2 text-start">Group</th><th className="py-2 text-end">Monthly revenue</th><th className="py-2 text-end">Students</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={`${label(row)}-${index}`} className="border-b border-neutral-100 last:border-0"><td className="py-3 text-navy-900">{label(row)}</td><td className="py-3 text-end font-medium">{formatEGP(row.revenueEGP)}</td><td className="py-3 text-end text-neutral-600">{row.studentCount}</td></tr>)}</tbody>
      </table></div> : <p className="text-sm text-neutral-500">{empty}</p>}
    </section>
  );
}

function AnalyticsDashboard() {
  const { locale } = useParams<{ locale: string }>();
  const isAr = locale === "ar";
  const { apiFetch } = useApiClient();
  const [report, setReport] = useState<RevenueAnalytics | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    apiFetch<RevenueAnalytics>("/admin/revenue/analytics").then(setReport).catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const t = (ar: string, en: string) => isAr ? ar : en;
  const commonEmpty = t("لا توجد بيانات في الاشتراكات النشطة حاليًا.", "No active subscription data is available.");
  return (
    <>
      <AdminDashboardLink />
      <main className="py-12">
        <SmartifyContainer>
          <h1 className="text-2xl font-bold text-navy-900">{t("تحليل الإيرادات", "Revenue analytics")}</h1>
          <p className="mt-2 text-sm text-neutral-600">{t("مقارنة قيمة الاشتراكات النشطة حسب المنطقة والمنهج والمادة والفئة العمرية.", "Compare active subscription value by area, curriculum, subject, and student age group.")}</p>
          {error && <p role="alert" className="mt-6 text-sm text-error-500">{t("تعذر تحميل التحليلات.", "Could not load analytics.")}</p>}
          {!report && !error && <p className="mt-6 text-neutral-500">{t("جارٍ التحميل…", "Loading…")}</p>}
          {report && <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-sf-lg border border-neutral-200 bg-white p-6"><p className="text-sm text-neutral-500">{t("الإيراد الشهري المتكرر", "Monthly recurring revenue")}</p><p className="mt-2 text-2xl font-bold text-navy-900">{formatEGP(report.monthlyRecurringRevenueEGP)}</p></div>
              <div className="rounded-sf-lg border border-neutral-200 bg-white p-6"><p className="text-sm text-neutral-500">{t("الاشتراكات النشطة", "Active subscriptions")}</p><p className="mt-2 text-2xl font-bold text-navy-900">{report.activeSubscriptionCount}</p></div>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <RevenueTable title={t("الإيرادات حسب المحافظة والمنطقة", "Revenue by governorate and area")} rows={report.byArea} label={(row) => `${row.governorate} / ${row.area}`} empty={commonEmpty} />
              <RevenueTable title={t("الإيرادات حسب المنهج", "Revenue by curriculum")} rows={report.byCurriculum} label={(row) => row.name || "—"} empty={commonEmpty} />
              <RevenueTable title={t("الإيرادات حسب المادة", "Revenue by subject")} rows={report.bySubject} label={(row) => isAr ? row.nameAr || row.nameEn || "—" : row.nameEn || row.nameAr || "—"} empty={commonEmpty} />
              <RevenueTable title={t("الإيرادات حسب عمر الطالب", "Revenue by student age group")} rows={report.byAgeGroup} label={(row) => row.ageGroup || "—"} empty={commonEmpty} />
            </div>
            <aside className="mt-6 rounded-sf-lg bg-amber-50 p-5 text-sm text-neutral-700">
              <h2 className="font-semibold">{t("ملاحظات على الأرقام", "How to read these figures")}</h2>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {report.notes.map((note, index) => <li key={index}>{isAr && index === 0 ? "هذه قيمة الاشتراكات النشطة حاليًا، وليست إجمالي المدفوعات المحصلة خلال فترة." : isAr && index === 1 ? "المحافظة والمنطقة بيانات اختيارية يكتبها الطالب؛ Unknown تعني أن البيانات غير متاحة." : isAr && index === 2 ? "توزيع المادة تقديري؛ يعتمد على الأسعار الحالية لتوزيع قيمة كل اشتراك بين مواده." : note}</li>)}
                <li>{t("إيراد المواد غير المنسوب بسبب بيانات اشتراك قديمة أو ناقصة:", "Subject revenue without a reliable subject allocation:")} {formatEGP(report.unattributedSubjectRevenueEGP)}</li>
                <li>{t("المنطقة هنا هي المنطقة المدخلة في الملف الشخصي وليست تقسيمًا رسميًا لمناطق وزارة التعليم.", "Area comes from the student profile; it is not an official education-district classification.")}</li>
              </ul>
            </aside>
          </>}
        </SmartifyContainer>
      </main>
    </>
  );
}

export default function AdminAnalyticsPage() {
  return <AdminGuard allowedRoles={["SUPER_ADMIN"]}><AnalyticsDashboard /></AdminGuard>;
}
