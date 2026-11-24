// Service worker Dog's Planet: cache dell'app shell e degli asset statici, rete per le API, notifiche push.
const VERSION = "dp-v6-updates";
const SHELL = ["/", "/manifest.webmanifest", "/brand/logo.webp", "/brand/logo.png", "/icons/icon-192.png", "/icons/icon-512.png", "/offline.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then(async (c) => {
    await c.addAll(SHELL);
    const html = await (await c.match("/")).text();
    const bundles = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map(match => match[1]);
    if (bundles.length) await c.addAll([...new Set(bundles)]);
  }).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("dp-") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function remember(e, key, response) {
  if (response.ok) {
    const copy = response.clone();
    e.waitUntil(caches.open(VERSION).then((c) => c.put(key, copy)));
  }
  return response;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (/^\/(?:api|admin|account)(?:\/|$)/.test(url.pathname)) return; // dati e aree riservate sempre dalla rete
  // Nessun modulo Vite di sviluppo in cache: l'anteprima deve riflettere il codice.
  if (/^\/(?:src|@[^/]*|node_modules)(?:\/|$)/.test(url.pathname) || /\.(?:tsx?|jsx)$/.test(url.pathname)) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req, { cache: "no-cache" }).then((r) => remember(e, "/", r))
      .catch(async () => {
        const shell = await caches.match("/");
        // In sviluppo i moduli Vite non sono archiviati: mostra la vera pagina
        // offline, non uno schermo vuoto che tenta di avviare moduli mancanti.
        if (shell && !(await shell.clone().text()).includes("/@vite/client")) return shell;
        return (await caches.match("/offline.html")) || Response.error();
      }));
    return;
  }
  if (/\.(js|css|png|webp|jpg|svg|ico|woff2?)$/.test(url.pathname) || url.pathname.startsWith("/files/")) {
    const hashed = /^\/assets\/.+-[\w-]{8,}\.(?:js|css)$/.test(url.pathname);
    if (hashed) {
      // I file con hash cambiano URL a ogni compilazione: cache-first è sicuro.
      e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => remember(e, req, r))));
    } else {
      // Foto, derivati e fogli non versionati: aggiorna dalla rete, usa la cache solo offline.
      e.respondWith(fetch(req, { cache: "no-cache" }).then((r) => remember(e, req, r))
        .catch(async () => (await caches.match(req)) || Response.error()));
    }
  }
});

self.addEventListener("push", (e) => {
  let data = { title: "Dog's Planet", body: "", url: "/" };
  try { data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icons/icon-192.png", badge: "/icons/favicon.png", data: { url: data.url } }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  let url = location.origin + "/";
  try {
    const requested = new URL((e.notification.data && e.notification.data.url) || "/", location.origin);
    if (requested.origin === location.origin) url = requested.href;
  } catch { /* Payload non valido: apri solo la home di Dog's Planet. */ }
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
