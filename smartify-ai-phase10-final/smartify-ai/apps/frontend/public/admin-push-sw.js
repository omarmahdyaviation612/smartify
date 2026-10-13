/* Smartify admin push (2026-10-13): shows a pop-up when a customer submits
 * an InstaPay receipt, even when the site is closed. Tapping it opens (or
 * focuses) the receipts review page. Registered only from admin pages. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Smartify", {
      body: data.body || "",
      tag: data.tag || "smartify-admin",
      renotify: true,
      requireInteraction: true,
      icon: "/brand/icon-192.png",
      dir: "rtl",
      lang: "ar",
      vibrate: [200, 100, 200],
      data: { url: data.url || "/ar/admin/instapay" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/ar/admin/instapay", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "navigate" in client) {
          await client.focus();
          return client.navigate(target);
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
