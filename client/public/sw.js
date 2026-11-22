// Service worker Dog's Planet: cache dell'app shell e degli asset statici, rete per le API, notifiche push.
const VERSION = "dp-v1";
const SHELL = ["/", "/manifest.webmanifest", "/brand/logo.webp", "/brand/logo.png", "/icons/icon-192.png", "/offline.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return; // sempre dalla rete
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put("/", copy)); return r; })
      .catch(() => caches.match("/").then((r) => r || caches.match("/offline.html"))));
    return;
  }
  if (/\.(js|css|png|webp|jpg|svg|ico|woff2?)$/.test(url.pathname) || url.pathname.startsWith("/files/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return r;
    })));
  }
});

self.addEventListener("push", (e) => {
  let data = { title: "Dog's Planet", body: "", url: "/" };
  try { data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icons/icon-192.png", badge: "/icons/favicon.png", data: { url: data.url } }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
