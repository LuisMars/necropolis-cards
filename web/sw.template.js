/*
 * Necropolis Cards service worker. GENERATED into web/sw.js by web/bundle.py:
 * do not edit sw.js, edit this template. The version is a hash of every
 * precached file, so any changed asset changes the bytes of sw.js, which is
 * what makes the browser install a new worker.
 *
 * - Install precaches the whole app, all or nothing.
 * - A new worker waits; it only takes over when the page sends SKIP_WAITING
 *   (the Update button), so nobody loses work mid-edit.
 * - Same-origin GET only. Cross-origin traffic (the sync server) is never
 *   touched. Anything not precached goes to the network and is not stored.
 */
const VERSION = "__VERSION__";
const PREFIX = "necropolis-cards-";
const CACHE = PREFIX + VERSION;
const FILES = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await Promise.all(FILES.map(async (file) => {
        const res = await fetch(new Request(file, { cache: "reload" }));
        if (!res.ok) throw new Error(`precache ${file}: HTTP ${res.status}`);
        await cache.put(file, res);
      }));
    } catch (err) {
      await caches.delete(CACHE);   // leave nothing half-installed; the old version keeps running
      throw err;
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "SKIP_WAITING") self.skipWaiting();
  else if (msg.type === "GET_VERSION" && event.ports[0]) event.ports[0].postMessage(VERSION);
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") {
      const page = await cache.match("index.html");
      if (page) return page;
    }
    return fetch(req);
  })());
});
