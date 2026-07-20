// StayHQ service worker — Web Push only (no offline caching, to avoid ever
// serving a stale app). Receives push events and shows a notification; a tap
// focuses an existing tab or opens the linked page.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "StayHQ", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "StayHQ";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png", // small monochrome icon Android shows in the status bar
    tag: data.id || data.type || "stayhq",
    data: { link: data.link || "/dashboard" },
  };

  // App icon badge count (Home Screen icon) — set here so it updates even
  // while StayHQ isn't open. "navigator" is available in the service worker
  // scope too; feature-detect since not every platform supports it.
  const badgeCount = typeof data.badge === "number" ? data.badge : null;
  const setBadge =
    badgeCount != null && "setAppBadge" in self.navigator
      ? badgeCount > 0
        ? self.navigator.setAppBadge(badgeCount).catch(() => {})
        : self.navigator.clearAppBadge().catch(() => {})
      : Promise.resolve();

  event.waitUntil(Promise.all([self.registration.showNotification(title, options), setBadge]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus an already-open StayHQ tab and navigate it, if we can
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) client.navigate(link).catch(() => {});
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
});
