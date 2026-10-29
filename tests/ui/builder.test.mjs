/**
 * Browser tests for the Builder: the page as a player uses it, in headless
 * Chromium, against the real site served by web/serve.py.
 *
 *   python3 web/bundle.py && npm install && npx playwright install chromium
 *   npm run test:ui
 *
 * Each test starts from an empty browser profile.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 8765;
const URL_ = `http://localhost:${PORT}/`;
const LINK = "c1;pl0,a1,tc2,tb6,sn0,sn3,sn1,sb3,sb1;pm4,a1,ewm8;pm3,a1,ewm1;pm1,a1,ewm4,ea0;pm1,a1,ewm4,ea0;pm5,a1,twu8,ewm8";

let server, browser;

before(async () => {
  server = spawn("python3", ["web/serve.py", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(URL_)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.kill(); });

/** A fresh page on the site; collects page errors, accepts confirm dialogs. */
async function open() {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto(URL_);
  await ready(page);
  return { page, errors };
}
/** The data is in and the Builder has drawn (it draws on every route). */
const ready = (page) => page.waitForFunction(() => document.querySelector("#bd-body > *"));
/** Follow a header destination link: "gatherings" or "cards". */
const go = (page, dest) => page.click(`nav.tabs a[data-dest="${dest}"]`);
/** Open the Import panel on the Gatherings page (unless it's open). */
async function openImport(page) {
  await go(page, "gatherings");
  if (await page.isHidden("#bd-import-panel")) {
    await page.locator('#bd-import:visible, #bd-body [data-act="import"]').first().click();
  }
}
async function importLink(page) {
  await openImport(page);
  await page.fill("#json-in", LINK);
  await page.click("#load-warband-btn");
  await page.waitForTimeout(300);
}
const text = async (page, sel) => ((await page.textContent(sel)) || "").replace(/\s+/g, " ").trim();

test("an imported link shows its models, cost and warnings", async () => {
  const { page, errors } = await open();
  await importLink(page);
  assert.equal(await page.locator(".bd-model").count(), 6);
  const side = await text(page, ".bd-side");
  assert.match(side, /345 of 300/);
  assert.match(side, /345 obols spent of the 300 for the first build/);
  assert.match(await text(page, "#bd-model-m1 .bd-warn"), /Mana points split: 0 of 4/);
  assert.deepEqual(errors, []);
});

test("importing the same warband again opens it instead of copying it", async () => {
  const { page } = await open();
  await importLink(page);
  await importLink(page);
  assert.equal(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("necropolis-builder-gatherings-v1")).order.length), 1);
  assert.ok(await page.isVisible("#bd-import-panel"));
  assert.match(await text(page, "#match-list"), /Already saved as/);
});

test("drafts: changes wait for Save, Discard puts them back", async () => {
  const { page } = await open();
  await importLink(page);
  assert.equal(await page.isVisible(".bd-draft"), false);         // an import is saved already

  await page.selectOption('[data-act="m-add"][data-uid="m3"]', "armour|armours/heavy-armour");
  await page.waitForTimeout(100);
  assert.ok(await page.isVisible(".bd-draft"));
  assert.match(await text(page, "#bd-model-m3 .bd-lists"), /Heavy Armour/);
  await page.click('[data-act="discard"]');
  await page.waitForTimeout(100);
  assert.doesNotMatch(await text(page, "#bd-model-m3 .bd-lists"), /Heavy Armour/);

  await page.fill('[data-act="name"]', "The Faithful of Bone");
  await page.press('[data-act="name"]', "Tab");
  await page.waitForTimeout(100);
  await page.click('[data-act="save"]');
  await page.reload();
  await ready(page);
  await go(page, "gatherings");
  assert.equal(await text(page, ".bd-gname"), "The Faithful of Bone");
  assert.equal(await page.isVisible(".bd-draft"), false);
});

test("campaign: an undone ambition takes its treasure back", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  await page.selectOption('[data-act="amb-add"]', "ambitions/scour-the-lands");
  for (let i = 0; i < 2; i++) await page.click('[data-act="amb-tick"][data-key="ambitions/scour-the-lands"][data-step="1"]');
  await page.click('[data-act="amb-complete"]');
  await page.selectOption('[data-act="t-pick"]', "minor-treasures/mana-bottle");
  await page.click('[data-act="t-take"]');
  await page.waitForTimeout(100);
  const chips = () => page.locator('details[data-fold="treasures"] .bd-item').allTextContents();
  assert.match((await chips()).join(" "), /Mana Bottle/);

  await page.click('details[data-fold="history"] > summary');
  await page.click('[data-act="amb-undo"]');
  await page.waitForTimeout(100);
  assert.deepEqual(await chips(), []);
  assert.deepEqual(errors, []);
});

test("after-battle sequence: rewards and the log entry", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  await page.click('[data-act="ab-open"]');
  await page.selectOption('[data-field="result"]', "loss");
  await page.click('[data-act="ab-step"][data-by="1"]');     // maladies: leader not Shattered
  await page.click('[data-act="ab-step"][data-by="1"]');     // victory rewards
  await page.fill("#ab-d1", "3");
  await page.fill("#ab-d2", "4");
  await page.click('[data-act="ab-apply-rewards"]');
  await page.waitForTimeout(100);
  assert.match(await text(page, ".bd-step"), /\+27 obols added \(20 \+ 3 \+ 4\)/);
  for (let i = 0; i < 5; i++) await page.click('[data-act="ab-step"][data-by="1"]');
  await page.click('[data-act="ab-finish"]');
  await page.waitForTimeout(100);
  assert.equal(await page.isVisible(".bd-wizard"), false);
  const row = await page.locator('details[data-fold="log"] tr').nth(1).locator("td").allTextContents();
  assert.deepEqual([row[4], row[5]], ["Loss", "27"]);
  assert.match(await text(page, ".bd-figs"), /Treasury\s*27 obols/);
  assert.deepEqual(errors, []);
});

test("the roster shows the gathering", async () => {
  const { page } = await open();
  await importLink(page);
  await page.click('[data-act="roster"]');
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".wb-member").count(), 6);
});

test("an import lands in the Builder on the imported gathering", async () => {
  const { page } = await open();
  assert.match(page.url(), /#cards$/);                     // nothing saved yet: Cards first
  await importLink(page);
  assert.match(page.url(), /#gatherings$/);
  assert.equal(await page.getAttribute('[data-act="view"][data-view="gathering"]', "aria-pressed"), "true");
  assert.equal(await page.locator(".bd-model").count(), 6);
});

test("the address keeps the view: reload restores it, Back returns", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.click('[data-act="view"][data-view="campaign"]');
  assert.match(page.url(), /#gatherings\/campaign$/);
  await page.reload();
  await ready(page);
  assert.match(page.url(), /#gatherings\/campaign$/);
  assert.equal(await page.getAttribute('[data-act="view"][data-view="campaign"]', "aria-pressed"), "true");
  assert.equal(await page.getAttribute('nav.tabs a[data-dest="gatherings"]', "aria-current"), "page");

  await go(page, "cards");
  await page.click('[data-local="cards"] button[data-route="cards/queue"]');
  assert.ok(await page.isVisible('section.tab[data-tab="print"]'));
  await page.goBack();
  await page.waitForFunction(() => location.hash === "#cards");
  assert.ok(await page.isVisible('section.tab[data-tab="library"]'));
  await page.goBack();
  await page.waitForFunction(() => location.hash === "#gatherings/campaign");
  assert.equal(await page.getAttribute('[data-act="view"][data-view="campaign"]', "aria-pressed"), "true");
  await page.goBack();
  await page.waitForFunction(() => location.hash === "#gatherings");
  assert.equal(await page.getAttribute('[data-act="view"][data-view="gathering"]', "aria-pressed"), "true");

  // No address: the last place comes back.
  await page.goto(URL_);
  await ready(page);
  assert.match(page.url(), /#gatherings$/);
  assert.deepEqual(errors, []);
});

test("the roster follows the unsaved draft", async () => {
  const { page } = await open();
  await importLink(page);
  await page.fill('[data-act="m-name"][data-uid="m3"]', "Grimwald the Unsaved");
  await page.press('[data-act="m-name"][data-uid="m3"]', "Tab");
  await page.waitForTimeout(100);
  await page.click('[data-act="view"][data-view="roster"]');
  await page.waitForTimeout(300);
  assert.match(page.url(), /#gatherings\/roster$/);
  assert.ok(await page.isVisible(".bd-draft"));                     // still not saved
  assert.match(await text(page, "#wb-pages"), /Grimwald the Unsaved/);
  await page.click('[data-act="discard"]');
  await page.waitForTimeout(300);
  assert.doesNotMatch(await text(page, "#wb-pages"), /Grimwald the Unsaved/);
});

test("adding the roster's cards to the queue leads to the queue", async () => {
  const { page } = await open();
  await importLink(page);
  await page.click('[data-act="view"][data-view="roster"]');
  await page.click('.bd-roster-bar [data-act="cards"]');
  await page.waitForTimeout(200);
  const n = Number(await page.textContent("#queue-count"));
  assert.ok(n > 0);
  assert.equal(await page.getAttribute("#nav-queue-link", "aria-label"), `${n} cards in the print queue`);
  await page.click('.bd-roster-bar [data-act="open-queue"]');
  assert.match(page.url(), /#cards\/queue$/);
  assert.ok(await page.isVisible("#queue-list .queue-item"));
});

test("the Print button names what it prints, or why it can't", async () => {
  const { page } = await open();
  const btn = "#global-print-btn";
  const reason = () => page.evaluate(() => {
    const b = document.getElementById("global-print-btn");
    return document.getElementById(b.getAttribute("aria-describedby")).textContent;
  });
  // Cards, empty queue.
  assert.equal(await text(page, btn), "Print 0 cards");
  assert.ok(await page.isDisabled(btn));
  assert.match(await reason(), /queue is empty/);
  assert.equal(await page.getAttribute(btn, "title"), await reason());
  // Gatherings with nothing open.
  await go(page, "gatherings");
  assert.equal(await text(page, btn), "Print roster");
  assert.ok(await page.isDisabled(btn));
  await importLink(page);
  assert.equal(await text(page, btn), "Print roster");
  assert.ok(await page.isEnabled(btn));
  assert.equal(await reason(), "");
  await page.click('[data-act="view"][data-view="campaign"]');
  assert.equal(await text(page, btn), "Print roster");
  // Queue the cards, then Cards says how many.
  await page.click('[data-act="view"][data-view="gathering"]');
  await page.click('[data-act="cards"]');
  await page.waitForTimeout(200);
  const n = await page.textContent("#queue-count");
  await go(page, "cards");
  assert.equal(await text(page, btn), `Print ${n} cards`);
  assert.ok(await page.isEnabled(btn));
  // Only one primary action in the header.
  assert.equal(await page.locator("header.app :is(.primary, .print-btn)").count(), 1);
  // Spanish.
  await page.click("#nav-settings > summary");
  await page.selectOption("#lang-select", "es");
  assert.equal(await text(page, btn), `Imprimir ${n} cartas`);
  await go(page, "gatherings");
  assert.equal(await text(page, btn), "Imprimir lista");
});

test("the Settings menu works from the keyboard", async () => {
  const { page } = await open();
  const isOpen = () => page.evaluate(() => document.getElementById("nav-settings").open);
  await page.focus("#nav-settings > summary");
  await page.keyboard.press("Enter");
  assert.equal(await isOpen(), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "lang-select");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "nc-theme-select");
  await page.keyboard.press("Escape");
  assert.equal(await isOpen(), false);
  assert.ok(await page.evaluate(() => document.activeElement.matches("#nav-settings > summary")));
  await page.keyboard.press("Space");
  assert.equal(await isOpen(), true);
  // Language sets the card language, and the header follows it.
  await page.selectOption("#lang-select", "es");
  assert.equal(await text(page, 'nav.tabs a[data-dest="gatherings"]'), "Séquitos");
  assert.equal(await page.evaluate(() => localStorage.getItem("necropolis-card-printer-lang-v1")), "es");
  // Theme keeps its palette control.
  await page.selectOption("#nc-theme-select", "slate");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ncPalette), "slate");
  // A click outside closes it.
  await page.mouse.click(600, 600);
  assert.equal(await isOpen(), false);
});
