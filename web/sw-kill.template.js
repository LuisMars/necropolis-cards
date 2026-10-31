/*
 * KILL SWITCH. If a bad service worker ever ships, publish this file as
 * sw.js (same path, same name). Browsers fetch sw.js on every visit, install
 * this one, and it deletes the app's caches, unregisters itself and reloads
 * open tabs, so the next load comes straight from the network.
 * See "Retiring the service worker" in web/README.md.
 */
const PREFIX = "necropolis-cards-";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX)) await caches.delete(key);
    }
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) {
      try { await client.navigate(client.url); } catch {}
    }
  })());
});
