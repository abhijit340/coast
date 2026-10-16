// Service worker: makes the app installable and lets it open with no signal.
//
// The app's own files are fetched from the network first, so updates show up
// immediately; a copy is kept and used when the network fails, or when it hasn't
// answered within a few seconds (a weak signal, where waiting could take minutes).
// The handful of files the page needs are saved at install, so it works offline
// from the second visit on even if some were never re-requested.
const CACHE = "coast-fire-v3"; // bump whenever SHELL changes (see README)
const WAIT_MS = 3000; // how long to wait for the network before using the saved copy
const SHELL = [
  "./", "index.html", "style.css", "calc.js", "app.js", "privacy.html", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Best effort: a missing file must not stop the worker from installing.
  event.waitUntil(caches.open(CACHE).then((cache) =>
    Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})))));
});
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  const fresh = fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
  // ignoreSearch: "/?anything" still finds the saved page. (The #scenario part never reaches here.)
  const saved = () => caches.match(request, { ignoreSearch: true });
  const tooSlow = new Promise((resolve) => setTimeout(resolve, WAIT_MS));

  event.respondWith(
    // Whichever comes first: the network's answer, or nothing (it failed or was too slow).
    Promise.race([fresh.catch(() => undefined), tooSlow])
      // Nothing: use the saved copy, or with no saved copy keep waiting for the network.
      .then((response) => response || saved().then((copy) => copy || fresh))
  );
  // Even when the saved copy was shown, let the download finish so the next open is up to date.
  event.waitUntil(fresh.catch(() => {}));
});
