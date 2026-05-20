const CACHE_NAME = "songbook-v6";
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "backup.js",
  "chord-utils.js",
  "db.js",
  "library-model.js",
  "song-model.js",
  "song-renderer.js",
  "song-sync.js",
  "manifest.webmanifest",
  "icon.svg",
  "themes/analog.css",
  "themes/editorial.css",
  "themes/stage.css",
  "themes/vintage.css",
  "themes/zine.css"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || Response.error()))
  );
});
