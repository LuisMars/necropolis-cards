/*
 * KILL SWITCH. If a bad service worker ever ships, publish this file as
 * sw.js (same path, same name). Browsers fetch sw.js on every visit, install
 * this one, and it deletes the app's caches and unregisters itself. Open tabs
 * reload once (the page reloads when a new worker takes over); after that
 * every load comes straight from the network. It does not navigate tabs
 * itself: pages register sw.js on each visit, so that would loop. (A page
 * that registers again leaves this idle stub registered: it has no fetch
 * handler and no cache, so it does nothing.)
 * See "Retiring the service worker" in web/README.md.
 */
const PREFIX = "necropolis-cards-";

self.addEventListener("install", () => self.skipWaiting());

// The page sends this when the player presses Update, in case the browser has not activated this worker yet.
self.addEventListener("message", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX)) await caches.delete(key);
    }
    await self.registration.unregister();
  })());
});

