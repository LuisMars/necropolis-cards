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
  await page.waitForFunction(() => document.querySelectorAll(".lib-tile").length > 0);
  return { page, errors };
}
const tab = (page, t) => page.click(`nav.tabs button[data-tab="${t}"]`);
async function importLink(page) {
  await tab(page, "import");
  await page.fill("#json-in", LINK);
  await page.click("#load-warband-btn");
  await page.waitForTimeout(300);
  await tab(page, "builder");
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
  await tab(page, "import");
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
  await page.waitForFunction(() => document.querySelectorAll(".lib-tile").length > 0);
  await tab(page, "builder");
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
