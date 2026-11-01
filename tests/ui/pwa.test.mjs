/**
 * Installable, offline-capable app: manifest, versioned service worker, the
 * update flow (notice, never a surprise reload, one reload on Update), the
 * Settings "Check for updates" button, the sync server never cached, and the
 * kill switch. Real Chromium on localhost (service workers are allowed there).
 *
 * The update tests serve a temporary copy of web/, change a file and
 * regenerate sw.js with that copy's own bundle.py, like a deploy would.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEB = join(ROOT, "web");
const COUCH = "https://couch.luismars.com";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff2": "font/woff2" };

/** A tiny static server we can stop (for the offline test). */
function serve(dir, port) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = join(dir, normalize(p));
    if (!file.startsWith(dir) || !existsSync(file)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(readFileSync(file));
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({
    url: `http://localhost:${port}/`,
    stop: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }),
  })));
}

const copyWeb = () => {
  const dir = mkdtempSync(join(tmpdir(), "necropolis-pwa-"));
  cpSync(WEB, dir, { recursive: true });
  return dir;
};
const bundleSw = (dir) => execFileSync("python3", [join(dir, "bundle.py"), "--sw-only"], { encoding: "utf8" }).trim();
const swVersion = (dir) => readFileSync(join(dir, "sw.js"), "utf8").match(/const VERSION = "(\w+)"/)[1];

let browser;
const temps = [];
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); for (const d of temps) rmSync(d, { recursive: true, force: true }); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = (page) => page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
const openSettings = (page) => page.evaluate(() => { const d = document.getElementById("settings-sheet"); if (!d.open) d.showModal(); });
const cacheKeys = (page) => page.evaluate(() => caches.keys());

/* ---- manifest ------------------------------------------------------------ */

test("the manifest is linked, valid, and its icons load", async () => {
  const srv = await serve(WEB, 8781);
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(srv.url);
    const href = await page.getAttribute('link[rel="manifest"]', "href");
    const res = await ctx.request.get(new URL(href, srv.url).href);
    assert.equal(res.status(), 200);
    const m = await res.json();
    assert.ok(m.name && m.short_name);
    assert.equal(m.display, "standalone");
    assert.equal(m.start_url, "./");
    assert.equal(m.scope, "./");
    assert.equal(m.theme_color, "#101011");
    assert.equal(m.background_color, "#101011");
    const purposes = m.icons.map((i) => `${i.sizes}/${i.purpose}`).sort();
    assert.deepEqual(purposes, ["192x192/any", "512x512/any", "512x512/maskable"]);
    for (const icon of m.icons) {
      const r = await ctx.request.get(new URL(icon.src, srv.url).href);
      assert.equal(r.status(), 200);
      assert.equal(r.headers()["content-type"], "image/png");
      const [w] = icon.sizes.split("x").map(Number);
      const buf = await r.body();
      assert.equal(buf.readUInt32BE(16), w, `${icon.src} width`);   // PNG IHDR
    }
  } finally { await ctx.close(); await srv.stop(); }
});

/* ---- first install, offline ---------------------------------------------- */

test("first install does not reload; after it the app works fully offline", async () => {
  const srv = await serve(WEB, 8782);
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    let navs = 0;
    page.on("load", () => { navs++; });
    await page.goto(srv.url);
    await page.evaluate(() => { window.__marker = 1; });
    await ready(page);
    await sleep(800);
    assert.equal(await page.evaluate(() => window.__marker), 1, "page was reloaded by the first install");
    assert.equal(navs, 1);

    await page.reload();                                   // now under the worker's control
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller));
    await page.waitForFunction(() => document.querySelector("#bd-body > *"));

    await srv.stop();                                      // the server is gone
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#bd-body > *"));

    const lib = await ctx.newPage();                       // deep hash route: the library
    await lib.goto(`${srv.url}#cards`);
    await lib.waitForSelector(".lib-tile");
    assert.ok(await lib.locator(".lib-tile").count() > 20);
    await lib.click(".lib-tile");                          // queue a card, then show the print queue
    await lib.goto(`${srv.url}#cards/queue`);
    await lib.reload();
    await lib.waitForSelector("#queue-list .edit-btn");
    await lib.waitForFunction(() => {                      // the card art (templates, images, fonts) rendered
      const svg = document.querySelector("#queue-list svg, .sheets-wrap svg");
      return !!svg && svg.getBoundingClientRect().width > 0;
    });
    assert.equal(await lib.textContent("#queue-count"), "1");

    await ctx.setOffline(true);                            // and with the browser flagged offline
    await lib.reload();
    await lib.waitForSelector("#queue-list .edit-btn");
    await ctx.setOffline(false);
  } finally { await ctx.close(); await srv.stop(); }
});

/* ---- update flow ---------------------------------------------------------- */

test("an update waits behind a notice, keeps typed data, and Update reloads once", async () => {
  const dir = copyWeb(); temps.push(dir);
  const srv = await serve(dir, 8783);
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    let navs = 0;
    page.on("load", () => { navs++; });
    await page.goto(srv.url);
    await ready(page);
    await page.reload();                                   // controlled
    await page.waitForFunction(() => document.querySelector("#bd-body > *"));
    const oldVersion = swVersion(dir);
    await page.waitForFunction(() => document.getElementById("pwa-version").textContent.includes("Version"));
    assert.match(await page.textContent("#pwa-version"), new RegExp(oldVersion));
    assert.ok(await page.locator("#nc-update").isHidden());

    await openSettings(page);
    await page.fill("#sync-email", "typed@example.com");
    await page.evaluate(() => { window.__marker = 1; });

    appendFileSync(join(dir, "styles.css"), "\n/* new version */\n");
    const newVersion = bundleSw(dir);
    assert.notEqual(newVersion, oldVersion);

    // The tab coming back to the foreground checks for an update.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // The sheet is open: its App section offers Update, and the floating notice stays away (no double notice).
    await page.waitForSelector("#pwa-update-btn", { state: "visible" });
    assert.equal(await page.locator("#nc-update").isHidden(), true);
    assert.equal((await page.textContent("#pwa-ready-text")).trim(), "A new version is available.");
    await page.evaluate(() => document.getElementById("settings-sheet").close());
    await page.waitForSelector("#nc-update:not([hidden])");
    await openSettings(page);
    assert.equal(await page.getAttribute("#nc-update", "role"), "status");
    assert.equal((await page.textContent("#nc-update-text")).trim(), "A new version is available.");
    await sleep(1000);
    assert.equal(await page.evaluate(() => window.__marker), 1, "reloaded by itself");
    assert.equal(await page.inputValue("#sync-email"), "typed@example.com");
    assert.equal(navs, 2);                                 // goto + reload, nothing more

    // A tab opened now finds the new worker already waiting.
    const other = await ctx.newPage();
    await other.goto(srv.url);
    await other.waitForSelector("#nc-update:not([hidden])");
    await other.close();

    const before = navs;
    await page.keyboard.press("Escape");
    await page.click("#nc-update-btn");
    await page.waitForFunction(() => !window.__marker);    // reloaded
    await page.waitForFunction(() => document.querySelector("#bd-body > *"));
    await sleep(1500);
    assert.equal(navs, before + 1, "should reload exactly once");
    assert.ok(await page.locator("#nc-update").isHidden());
    await page.waitForFunction((v) => document.getElementById("pwa-version").textContent.includes(v), newVersion);
    const keys = await cacheKeys(page);
    assert.deepEqual(keys, [`necropolis-cards-${newVersion}`]);   // old cache gone
    assert.match(await page.evaluate(() => fetch("styles.css").then((r) => r.text())), /new version/);
  } finally { await ctx.close(); await srv.stop(); }
});

test("a tab opened on the first install still reloads when Update is pressed later", async () => {
  const dir = copyWeb(); temps.push(dir);
  bundleSw(dir);
  const srv = await serve(dir, 8786);
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    let loads = 0;
    page.on("load", () => loads++);
    await page.goto(srv.url);
    await ready(page);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await sleep(300);
    assert.equal(loads, 1, "the first install does not reload");
    const v1 = swVersion(dir);
    appendFileSync(join(dir, "styles.css"), "\n/* v2 */\n");
    bundleSw(dir);
    assert.notEqual(swVersion(dir), v1);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForSelector("#nc-update:not([hidden])");
    await page.click("#nc-update-btn");
    await page.waitForFunction(() => document.readyState === "complete" && document.getElementById("nc-update")?.hidden, null, { timeout: 15000 });
    await sleep(500);
    assert.equal(loads, 2, "Update reloads exactly once");
  } finally { await ctx.close(); await srv.stop(); }
});

test("other pages are not replaced by the app, and fall back to it only offline", async () => {
  const srv = await serve(WEB, 8787);
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(srv.url);
    await ready(page);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const ref = await page.goto(new URL("design-reference.html", srv.url).href);
    assert.equal(ref.status(), 200);
    assert.equal(await page.locator("#nav-settings").count(), 0, "design reference, not the app");
    const missing = await page.goto(new URL("no-such-page", srv.url).href);
    assert.equal(missing.status(), 404);
    await page.goto(srv.url);
    await srv.stop();    // the worker's own fetches must fail, as they do offline
    await page.goto(new URL("no-such-page", srv.url).href);
    assert.equal(await page.locator("#nav-settings").count(), 1, "offline fallback is the app");
  } finally { await ctx.close(); await srv.stop(); }
});

test("Settings > Check for updates reports checking, up to date, available and offline", async () => {
  const dir = copyWeb(); temps.push(dir);
  const srv = await serve(dir, 8784);
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(srv.url);
    await ready(page);
    await page.reload();
    await page.waitForFunction(() => document.getElementById("pwa-version").textContent.includes("Version"));
    await openSettings(page);
    assert.equal(await page.locator("header.app :is(.primary, .print-btn)").count(), 1);
    assert.equal(await page.locator("#pwa-check.primary, #nc-update-btn.primary").count(), 0);
    const status = () => page.textContent("#pwa-status");

    await page.click("#pwa-check");
    await page.waitForFunction(() => /latest version/.test(document.getElementById("pwa-status").textContent));
    assert.ok(await page.locator("#nc-update").isHidden());

    appendFileSync(join(dir, "styles.css"), "\n/* v2 */\n");
    bundleSw(dir);
    await page.click("#pwa-check");
    await page.waitForFunction(() => /new version is available/.test(document.getElementById("pwa-status").textContent));
    // The open sheet covers the floating notice: the action moves into the App section.
    assert.ok(await page.locator("#nc-update").isHidden());
    assert.ok(await page.locator("#pwa-update-btn").isVisible());
    assert.equal(await page.locator("#pwa-update-btn").evaluate((b) => b.getBoundingClientRect().height >= 44), true);
    await page.evaluate(() => document.getElementById("settings-sheet").close());
    assert.ok(await page.locator("#nc-update").isVisible());
    assert.ok(await page.locator("#pwa-ready").isHidden());
    await openSettings(page);

    await ctx.setOffline(true);
    await page.click("#pwa-check");
    await page.waitForFunction(() => /Could not check/.test(document.getElementById("pwa-status").textContent));
    assert.match(await status(), /offline/);
    await ctx.setOffline(false);

    await srv.stop();                                      // server down while "online"
    await page.click("#pwa-check");
    await page.waitForFunction(() => /Could not check/.test(document.getElementById("pwa-status").textContent));

    await page.selectOption("#lang-select", "es");         // Spanish
    assert.equal(await page.textContent("#pwa-check"), "Buscar actualizaciones");
    assert.equal(await page.textContent("#nc-update-btn"), "Actualizar");
  } finally { await ctx.close(); await srv.stop(); }
});

/* ---- sync server ---------------------------------------------------------- */

test("sync server requests are never answered from the cache or stored", async () => {
  const srv = await serve(WEB, 8785);
  const ctx = await browser.newContext();
  let hits = 0;
  await ctx.route(`${COUCH}/**`, (route) => {
    hits++;
    route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ n: hits }) });
  });
  try {
    const page = await ctx.newPage();
    await page.goto(srv.url);
    await ready(page);
    await page.reload();
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller));
    const get = () => page.evaluate((u) => fetch(u).then((r) => r.json()), `${COUCH}/_session`);
    assert.deepEqual(await get(), { n: 1 });
    assert.deepEqual(await get(), { n: 2 });               // a fresh answer, not a cached one
    assert.equal(hits, 2);
    const stored = await page.evaluate(async () => {
      const urls = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(r.url);
      return urls;
    });
    assert.ok(stored.length > 50);
    assert.equal(stored.filter((u) => u.includes("couch.luismars.com")).length, 0);
  } finally { await ctx.close(); await srv.stop(); }
});

/* ---- version hash and generated worker ----------------------------------- */

test("sw.js lists what the app needs offline and its version tracks every precached file", () => {
  const dir = copyWeb(); temps.push(dir);
  const v0 = bundleSw(dir);
  const sw = readFileSync(join(dir, "sw.js"), "utf8");
  const files = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1]);
  for (const need of ["index.html", "data.json", "manifest.webmanifest", "icon-192.png", "icon-512-maskable.png",
    "favicon.svg", "js/main.js", "js/pwa.js", "fonts/JBLACK.TTF", "templates/leader.svg", "styles.css"]) {
    assert.ok(files.includes(need), `${need} missing from the precache`);
  }
  assert.ok(files.some((f) => f.startsWith("images/")), "no images");
  for (const f of files) {
    assert.ok(!/\.py$/.test(f) && !f.startsWith(".") && !f.includes("/."), f);
    assert.ok(!["sw.js", "sw.template.js", "sw-kill.template.js", "README.md", "CNAME", "design-reference.html", "select-demo.html"].includes(f), f);
  }
  assert.equal(bundleSw(dir), v0, "same files, same version");

  // Excluded files do not change it ...
  appendFileSync(join(dir, "README.md"), "\nnotes\n");
  appendFileSync(join(dir, "design-reference.html"), "<!-- x -->");
  assert.equal(bundleSw(dir), v0);
  // ... any precached one does: code, data, an image, a font, and the worker template.
  let prev = v0;
  for (const f of ["js/main.js", "data.json", "icon-192.png", "fonts/JBLACK.TTF", "templates/leader.svg"]) {
    appendFileSync(join(dir, f), f.endsWith(".js") ? "\n// x\n" : "x");
    const v = bundleSw(dir);
    assert.notEqual(v, prev, `${f} did not change the version`);
    prev = v;
  }
  assert.ok(readFileSync(join(dir, "sw.js"), "utf8").includes(`"${prev}"`));
  // A change to the worker's own code changes sw.js bytes (what triggers a browser update).
  const before = readFileSync(join(dir, "sw.js"), "utf8");
  appendFileSync(join(dir, "sw.template.js"), "\n// tweak\n");
  bundleSw(dir);
  assert.notEqual(readFileSync(join(dir, "sw.js"), "utf8"), before);
});

/* ---- failure safety and kill switch --------------------------------------- */

test("without sw.js the app still runs with no errors", async () => {
  const dir = copyWeb(); temps.push(dir);
  rmSync(join(dir, "sw.js"));
  const srv = await serve(dir, 8786);
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(srv.url);
    await page.waitForFunction(() => document.querySelector("#bd-body > *"));
    await sleep(500);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)), 0);
  } finally { await ctx.close(); await srv.stop(); }
});

test("the kill switch template removes the worker and its caches", async () => {
  const dir = copyWeb(); temps.push(dir);
  const srv = await serve(dir, 8787);
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(srv.url);
    await ready(page);
    await page.reload();
    assert.equal((await cacheKeys(page)).length, 1);

    // Retire it: publish the kill switch as sw.js. (Chromium defers a take-over that is requested while
    // the old worker is still busy with the page load; a real visit comes later than that.)
    await sleep(4000);
    writeFileSync(join(dir, "sw.js"), readFileSync(join(dir, "sw-kill.template.js")));
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update())).catch(() => {});
    let keys = 1, calm = 0;
    for (let i = 0; i < 75 && calm < 5; i++) {         // gone, and staying gone
      await sleep(200);
      try {
        keys = await page.evaluate(async () => (await caches.keys()).length);
        calm = keys ? 0 : calm + 1;
      } catch { calm = 0; /* the tab reloaded under us */ }
    }
    assert.equal(keys, 0, "caches left");
    // Whatever is left registered no longer answers requests: new content comes from the network.
    appendFileSync(join(dir, "styles.css"), "\n/* from the network */\n");
    assert.match(await page.evaluate(() => fetch("styles.css").then((r) => r.text())), /from the network/);
    await page.waitForFunction(() => document.querySelector("#bd-body > *"));   // still works from the network
  } finally { await ctx.close(); await srv.stop(); }
});

/* ---- install action in Settings ------------------------------------------- */

test("Settings offers Install app after a beforeinstallprompt and hides it once installed", async () => {
  const srv = await serve(WEB, 8789);
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(srv.url);
    await page.waitForFunction(() => document.querySelector("#bd-body > *"));
    await openSettings(page);
    // No prompt available (and not iOS): nothing to install.
    assert.ok(await page.locator("#pwa-install").isHidden());
    // A synthetic prompt event, as Chrome fires it.
    await page.evaluate(() => {
      window.__prompted = 0;
      const e = new Event("beforeinstallprompt", { cancelable: true });
      e.prompt = () => { window.__prompted++; return Promise.resolve(); };
      e.userChoice = Promise.resolve({ outcome: "accepted" });
      window.__defaultPrevented = !window.dispatchEvent(e);
    });
    assert.equal(await page.evaluate(() => window.__defaultPrevented), true, "the browser's own banner is suppressed");
    await page.waitForSelector("#pwa-install-btn:visible");
    assert.equal(await page.textContent("#pwa-install-btn"), "Install app");
    assert.ok(await page.locator("#pwa-ios-hint").isHidden());
    await page.click("#pwa-install-btn");
    assert.equal(await page.evaluate(() => window.__prompted), 1);
    await page.waitForSelector("#pwa-install", { state: "hidden" });   // accepted: gone
    // A second prompt, then the appinstalled event also hides it.
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true });
      e.prompt = () => Promise.resolve(); e.userChoice = Promise.resolve({ outcome: "dismissed" });
      window.dispatchEvent(e);
    });
    await page.waitForSelector("#pwa-install-btn:visible");
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await page.waitForSelector("#pwa-install", { state: "hidden" });
  } finally { await ctx.close(); await srv.stop(); }
});

test("iOS Safari gets a hint and no button; an installed app shows nothing", async () => {
  const srv = await serve(WEB, 8790);
  const ios = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
  try {
    const page = await ios.newPage();
    await page.goto(srv.url);
    await page.waitForFunction(() => document.querySelector("#bd-body > *"));
    await openSettings(page);
    await page.waitForSelector("#pwa-ios-hint:visible");
    assert.equal(await page.textContent("#pwa-ios-hint"), "Share, then Add to Home Screen");
    assert.ok(await page.locator("#pwa-install-btn").isHidden());
    // Standalone: nothing.
    await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#bd-body > *"));
    await openSettings(page);
    assert.ok(await page.locator("#pwa-install").isHidden());
  } finally { await ios.close(); await srv.stop(); }
});

test("with service workers blocked the app runs without errors and Settings still works", async () => {
  const srv = await serve(WEB, 8787);
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Some browsers hand back nothing from register() when workers are blocked.
    await page.addInitScript(() => {
      if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.resolve(undefined);
    });
    await page.goto(srv.url);
    await page.waitForFunction(() => document.querySelector("#bd-body > *"));
    await sleep(500);
    await openSettings(page);
    if (await page.isVisible("#pwa-check")) await page.click("#pwa-check");
    await sleep(300);
    assert.deepEqual(errors, []);
    assert.equal(await page.isHidden("#nc-update"), true);
  } finally { await ctx.close(); await srv.stop(); }
});
