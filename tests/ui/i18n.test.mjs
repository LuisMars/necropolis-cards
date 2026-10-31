/**
 * Language: with Spanish chosen in Settings, the Library, the Import panel
 * and the print queue show no English interface text.
 *
 * Card names, previews and the sheets themselves are card data (they fall
 * back to English where a row has no translation), so they are left out; what
 * is checked is the app's own chrome: text, placeholders, titles and labels.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 8768;
const URL_ = `http://localhost:${PORT}/`;
const EXPORT = readFileSync(new URL("../fixtures/companion-export.json", import.meta.url), "utf8");

// English interface strings that must not survive the switch (whole words).
const ENGLISH = [
  "Filter by name", "All categories", "Add all in view", "Printed inventory", "Export file",
  "Copy JSON", "Import file", "Paste JSON", "Paste an exported", "queued", "printed", "Add",
  "need", "cards", "in the queue", "Library", "Print queue",
  "Paste a JSON", "Load gathering", "Load warband", "Load and add", "Load sample", "Close",
  "share link", "BUILDER", "SUMMARY", "matched", "fuzzy", "unmatched", "Show each card",
  "Saved as", "not in the card library",
  "Add gap", "Print card backs", "Only what I still need", "Mark this run", "Clear queue",
  "sheet", "sheets", "Click to rename", "Edit fields", "Move up", "Move down", "Remove",
  "The queue is empty", "print preview", "Skip cards",
  "Covenants", "Minions", "Spells", "Sellswords",
];

let server, browser, page;

before(async () => {
  server = spawn("python3", ["web/serve.py", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(URL_)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch();
  page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("dialog", d => d.accept());
  await page.goto(URL_ + "#cards");
  await page.waitForFunction(() => document.querySelectorAll(".lib-tile").length > 0);
  await page.click("#nav-settings > summary");
  await page.selectOption("#lang-select", "es");
  await page.click("#nav-settings > summary");
});
after(async () => { await browser?.close(); server?.kill(); });

/** The chrome of `selector`: visible text plus placeholders, titles and
 *  aria-labels, with card data (names, previews, sheets, the pasted JSON)
 *  taken out. */
const chrome = (selector) => page.evaluate((sel) => {
  const root = document.querySelector(sel).cloneNode(true);
  root.querySelectorAll(".name, .preview, .sheets-wrap, .match-row .source, .match-row .target, textarea, svg")
    .forEach(el => el.remove());
  const attrs = [...root.querySelectorAll("[placeholder], [title], [aria-label]")]
    .flatMap(el => ["placeholder", "title", "aria-label"].map(a => el.getAttribute(a) || ""));
  const placeholders = [...document.querySelector(sel).querySelectorAll("textarea[placeholder]")].map(t => t.placeholder);
  return [root.textContent, ...attrs, ...placeholders].join(" \n ");
}, selector);

const leftovers = (text) => ENGLISH.filter(w => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "u").test(text));

test("the Library has no English interface text in Spanish", async () => {
  await page.click(".lib-tile");                  // one card queued and printed-stepper shown
  const text = await chrome('section.tab[data-tab="library"]');
  assert.match(text, /Biblioteca/);
  assert.deepEqual(leftovers(text), []);
});

test("the Import panel has no English interface text in Spanish", async () => {
  await page.click('nav.tabs a[data-dest="gatherings"]');
  await page.locator('#bd-import:visible, #bd-body [data-act="import"]').first().click();
  await page.fill("#json-in", EXPORT);
  await page.click("#parse-btn");
  await page.waitForTimeout(500);
  if (await page.isHidden("#bd-import-panel")) await page.click("#bd-import");
  const text = await chrome("#bd-import-panel");
  assert.match(text, /Cargar Séquito/);
  assert.deepEqual(leftovers(text), []);
});

test("the print queue has no English interface text in Spanish", async () => {
  await page.click("#nav-queue-link");
  await page.waitForTimeout(500);
  await page.click("#queue-list .edit-btn");      // the per-card field editor too
  const text = await chrome('section.tab[data-tab="print"]');
  assert.match(text, /Cola de impresión/);
  assert.deepEqual(leftovers(text), []);
});

test("the page title and footer follow the language", async () => {
  assert.equal(await page.title(), "Necropolis: impresión de cartas");
  const foot = await page.textContent("footer.app-foot");
  assert.match(foot, /hecha por fans/);
  assert.doesNotMatch(foot, /Not affiliated/);
});
