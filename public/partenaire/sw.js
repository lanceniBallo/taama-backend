// Taama Partenaire — service worker
// Permet l'installation sur téléphone/ordinateur et garde l'écran de l'app en cache.
// Les données (réservations, offres…) viennent toujours du serveur, jamais du cache.
const CACHE = "taama-partenaire-v1";
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
  if (e.request.method !== "GET" || !url.pathname.startsWith("/partenaire/")) return;
  // Réseau d'abord (toujours la dernière version), cache si pas de connexion.
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});
