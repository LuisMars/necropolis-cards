/**
 * Settings > Sync in headless Chromium, with the network mocked: every
 * request to the sync server is answered by the in-memory fake CouchDB
 * (tests/fake-couch.js). Nothing ever reaches a real server.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createFakeCouch } from "../fake-couch.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 8770;
const URL_ = `http://localhost:${PORT}/`;
const SERVER = "https://couch.luismars.com";
const PW = "a long password";
const EVIL = "<img src=x onerror=\"window.__pwn=1\">Evil";
const GKEY = "necropolis-builder-gatherings-v1";

let server, browser, page, fake, hits = 0, offline = false;
const gathering = (name) => ({ format: "necropolis-gathering", version: 1, id: "gtest1", name, covenant: null, models: [], stash: [], history: [] });

before(async () => {
  server = spawn("python3", ["web/serve.py", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(URL_)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch();
  fake = createFakeCouch(SERVER);
  const doFetch = fake.fetchFor();
  const cors = { "access-control-allow-origin": `http://localhost:${PORT}`, "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type,accept", "access-control-allow-methods": "GET,PUT,POST,DELETE" };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(`${SERVER}/**`, async (route) => {
    hits++;
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (offline) return route.abort();
    const res = await doFetch(req.url(), { method: req.method(), body: req.postData() || undefined, credentials: "include" });
    await route.fulfill({ status: res.status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(await res.json()) });
  });
  page = await ctx.newPage();
  page.on("dialog", d => d.accept());
  await page.goto(URL_);
  await page.waitForFunction(() => document.querySelector("#bd-body > *"));
});
after(async () => { await browser?.close(); server?.kill(); });

const open = () => page.evaluate(() => { document.getElementById("nav-settings").open = true; });
const status = () => page.textContent("#sync-status");

test("signed out: the section is there, labelled, and nothing was sent", async () => {
  await open();
  assert.equal(hits, 0);
  assert.equal(await page.textContent("#sync-title"), "Sync");
  assert.match(await page.textContent("#sync-note"), /couch\.luismars\.com/);
  assert.equal(await page.getAttribute("#sync-email", "autocomplete"), "username");
  assert.equal(await page.getAttribute("#sync-password", "autocomplete"), "current-password");
  assert.equal(await page.locator('label[for="sync-email"]').count(), 1);
  assert.match(await status(), /Sync is off/);
  assert.equal(await page.getAttribute("#sync-status", "aria-live"), "polite");
  assert.equal(await page.isVisible("#sync-now"), false);
});

test("a bad email is an inline error, not a dialog, and sends nothing", async () => {
  await page.fill("#sync-email", "nope");
  await page.click("#sync-signin");
  await page.waitForSelector("#sync-error:not([hidden])");
  assert.match(await page.textContent("#sync-error"), /valid email/);
  assert.equal(await page.getAttribute("#sync-email", "aria-invalid"), "true");
  assert.equal(await page.evaluate(() => document.activeElement.id), "sync-email");
  assert.equal(hits, 0);
});

test("creating an account uploads local data and keeps no password", async () => {
  await page.evaluate(([k, g]) => { localStorage.setItem(k, JSON.stringify({ gatherings: { [g.id]: g }, order: [g.id], current: g.id })); }, [GKEY, gathering("Mine")]);
  await page.fill("#sync-email", "Player@Example.com");
  await page.fill("#sync-password", "short");
  await page.click("#sync-signup");
  assert.match(await page.textContent("#sync-error"), /at least 8/);
  await page.fill("#sync-password", PW);
  await page.click("#sync-signup");
  await page.waitForSelector("#sync-account:not([hidden])");
  await page.waitForFunction(() => /Synced\./.test(document.getElementById("sync-status").textContent));
  assert.match(await page.textContent("#sync-user"), /player@example\.com/);
  assert.match(await page.textContent("#sync-last"), /Last synced/);
  assert.equal(await page.inputValue("#sync-password"), "");
  assert.ok(fake.docs("player@example.com").has("necropolis-gathering:gtest1"));
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  assert.ok(!stored.includes(PW));
});

test("a conflict shows the choices, escapes server text, and nothing is lost", async () => {
  // The same gathering changed on the server and here.
  const docs = fake.docs("player@example.com");
  const cur = docs.get("necropolis-gathering:gtest1");
  docs.set(cur._id, { ...cur, _rev: "9-aaaa", gathering: gathering(EVIL), updatedAt: Date.now() });
  await page.evaluate(([k, g]) => {
    localStorage.setItem(k, JSON.stringify({ gatherings: { [g.id]: g }, order: [g.id], current: g.id }));
  }, [GKEY, gathering("Mine, edited here")]);
  await page.click("#sync-now");
  await page.waitForSelector("#sync-conflicts button[data-choice]");
  assert.equal(await page.locator("#sync-conflicts button").count(), 3);
  assert.match(await status(), /needs your decision/);
  assert.match(await page.textContent("#sync-conflicts"), /<img src=x/);       // shown as text
  assert.equal(await page.locator("#sync-conflicts img, #sync-section img").count(), 0);
  assert.equal(await page.evaluate(() => window.__pwn), undefined);
  const local = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).gatherings.gtest1.name, GKEY);
  assert.equal(local, "Mine, edited here");                                       // untouched until chosen
  await page.click('#sync-conflicts button[data-choice="both"]');
  await page.waitForFunction(() => !document.querySelector("#sync-conflicts button"));
  const names = await page.evaluate((k) => Object.values(JSON.parse(localStorage.getItem(k)).gatherings).map(g => g.name).sort(), GKEY);
  assert.equal(names.length, 2);
  assert.ok(names.includes("Mine, edited here"));
});

test("a server that is down shows a visible message and local data is untouched", async () => {
  offline = true;
  const before = await page.evaluate((k) => localStorage.getItem(k), GKEY);
  await page.click("#sync-now");
  await page.waitForSelector("#sync-account-error:not([hidden])");
  assert.match(await page.textContent("#sync-account-error"), /Can't reach the sync server/);
  assert.match(await status(), /Can't reach/);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), GKEY), before);
  offline = false;
  await page.click("#sync-now");
  await page.waitForFunction(() => /Synced\./.test(document.getElementById("sync-status").textContent));
});

test("the section follows the language", async () => {
  await page.selectOption("#lang-select", "es");
  assert.equal(await page.textContent("#sync-title"), "Sincronizar");
  assert.equal(await page.textContent("#sync-now"), "Sincronizar ahora");
  assert.match(await page.textContent("#sync-user"), /Sesión iniciada como/);
  await page.selectOption("#lang-select", "en");
});

test("sign out returns to the form and keeps the data", async () => {
  await page.click("#sync-signout");
  await page.waitForSelector("#sync-form:not([hidden])");
  assert.match(await status(), /Sync is off/);
  const n = hits;
  await page.evaluate(() => document.getElementById("nav-settings").open = false);
  await page.waitForTimeout(300);
  assert.equal(hits, n);
  assert.equal(await page.evaluate((k) => Object.keys(JSON.parse(localStorage.getItem(k)).gatherings).length, GKEY), 2);
});
