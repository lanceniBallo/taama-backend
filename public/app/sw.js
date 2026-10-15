// Taama — service worker
// Permet l'installation sur téléphone/ordinateur et garde l'écran de l'app en cache.
// Les données (réservations, offres…) viennent toujours du serveur, jamais du cache.
const CACHE = "taama-client-v2";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Uniquement les fichiers de l'app ; les appels API passent directement au serveur.
  if (e.request.method !== "GET" || !url.pathname.startsWith("/app/")) return;
  // Réseau d'abord (toujours la dernière version), cache si pas de connexion.
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});

// Notifications : réservation validée / refusée par le partenaire
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || "Taama — Mise à jour de votre réservation";
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || "Ouvrez l'application pour voir le détail.",
    icon: "/app/icon-192.png",
    badge: "/app/icon-192.png",
    tag: data.tag || "taama-booking",
    vibrate: [200, 100, 200],
    data: { url: data.url || "/app/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/app/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes("/app/") && "navigate" in c) return c.navigate(url).then((w) => w && w.focus()); }
    return self.clients.openWindow(url);
  }));
});
