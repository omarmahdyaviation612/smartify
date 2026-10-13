"use client";

import { useEffect, useState } from "react";
import { useApiClient } from "@/lib/api-client";

type Status = "hidden" | "loading" | "unsupported" | "ios-install" | "disabled-server" | "denied" | "off" | "on";

interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
  devices: number;
}

const SW_URL = "/admin-push-sw.js";

function vapidKeyToBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/**
 * Admin push (2026-10-13): turns on pop-up notifications on this device for
 * new InstaPay receipts. Works with the site closed on Android, Windows and
 * Mac; on iPhone only after "Add to Home Screen".
 */
export function AdminPushToggle({ locale }: { locale: string }) {
  const ar = locale !== "en";
  const { apiFetch } = useApiClient();
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [config, setConfig] = useState<PushConfig | null>(null);

  async function refresh() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setStatus(isIos() && !isStandalone() ? "ios-install" : "unsupported");
      return;
    }
    const cfg = await apiFetch<PushConfig>("/admin/push/config").catch(() => null);
    if (!cfg) { setStatus("hidden"); return; } // not a Super Admin / Admin
    setConfig(cfg);
    if (!cfg.enabled || !cfg.publicKey) { setStatus("disabled-server"); return; }
    if (Notification.permission === "denied") { setStatus("denied"); return; }
    const registration = await navigator.serviceWorker.getRegistration(SW_URL);
    const subscription = await registration?.pushManager.getSubscription();
    setStatus(subscription ? "on" : "off");
  }

  useEffect(() => {
    refresh().catch(() => setStatus("unsupported"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enable() {
    if (!config?.publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus(permission === "denied" ? "denied" : "off"); return; }
      const registration = await navigator.serviceWorker.register(SW_URL);
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyToBuffer(config.publicKey) }));
      await apiFetch("/admin/push/subscribe", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
      await apiFetch("/admin/push/test", { method: "POST" }).catch(() => undefined);
      setStatus("on");
      setMessage(ar ? "تم التفعيل — وصلك إشعار تجربة؟" : "Enabled — did a test notification arrive?");
    } catch {
      setMessage(ar ? "مقدرناش نفعّل الإشعارات على الجهاز ده." : "Couldn't enable notifications on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration(SW_URL);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await apiFetch("/admin/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiFetch<{ sent: number; total: number }>("/admin/push/test", { method: "POST" });
      setMessage(result.sent ? (ar ? "اتبعت إشعار تجربة." : "Test notification sent.") : (ar ? "مفيش جهاز مفعّل يستقبل." : "No enabled device received it."));
    } catch {
      setMessage(ar ? "فشل إرسال التجربة." : "Test failed.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "hidden") return null;

  const text: Record<Exclude<Status, "hidden">, string> = {
    loading: ar ? "جاري التحقق…" : "Checking…",
    unsupported: ar ? "المتصفح ده مش بيدعم الإشعارات. جرّب Chrome." : "This browser doesn't support notifications. Try Chrome.",
    "ios-install": ar ? "على الآيفون: افتح الموقع من Safari ← مشاركة ← «إضافة إلى الشاشة الرئيسية»، وافتحه من الأيقونة وفعّل من هنا." : "On iPhone: Safari → Share → “Add to Home Screen”, open it from the icon, then enable here.",
    "disabled-server": ar ? "الإشعارات لسه مش متفعّلة على السيرفر." : "Push isn't configured on the server yet.",
    denied: ar ? "الإشعارات مقفولة للموقع ده من إعدادات المتصفح. افتحها من إعدادات الموقع وارجع." : "Notifications are blocked for this site in browser settings.",
    off: ar ? "فعّل إشعار فوري على الجهاز ده أول ما عميل يبعت إيصال InstaPay." : "Get an instant pop-up on this device when a customer submits an InstaPay receipt.",
    on: ar ? "الإشعارات شغالة على الجهاز ده." : "Notifications are on for this device.",
  };

  return (
    <div className="rounded-sf-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-navy-900">🔔 {ar ? "إشعارات الدفع" : "Payment notifications"}</p>
          <p className="mt-1 text-sm text-neutral-600">{text[status]}</p>
          {config && config.devices > 0 && <p className="mt-1 text-xs text-neutral-400">{ar ? `أجهزة مفعّلة لحسابك: ${config.devices}` : `Devices enabled for your account: ${config.devices}`}</p>}
        </div>
        <div className="flex gap-2">
          {status === "off" && (
            <button type="button" disabled={busy} onClick={enable} className="rounded-sf bg-sf-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {ar ? "فعّل الإشعارات" : "Enable"}
            </button>
          )}
          {status === "on" && (
            <>
              <button type="button" disabled={busy} onClick={test} className="rounded-sf border border-neutral-300 px-3 py-2 text-sm disabled:opacity-50">{ar ? "إشعار تجربة" : "Send test"}</button>
              <button type="button" disabled={busy} onClick={disable} className="rounded-sf border border-neutral-300 px-3 py-2 text-sm text-error-500 disabled:opacity-50">{ar ? "إيقاف" : "Turn off"}</button>
            </>
          )}
        </div>
      </div>
      {message && <p role="status" className="mt-2 text-sm text-neutral-700">{message}</p>}
    </div>
  );
}
