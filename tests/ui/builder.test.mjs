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

let server, browser, lastContext;

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
  await lastContext?.close();     // one page at a time: the suite is long
  lastContext = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await lastContext.newPage();
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
/** Add an item through a list's "+ Add …" picker, then close it. */
async function pick(page, uid, list, value) {
  await page.click(`[data-act="m-pick"][data-uid="${uid}"][data-list="${list}"]`);
  await page.click(`dialog.bd-picker[open] .bd-picker-row[data-value="${value}"]`);
  await page.waitForTimeout(150);
  await page.click('dialog.bd-picker [data-pk="close"].primary');
}
const text = async (page, sel) => ((await page.textContent(sel)) || "").replace(/\s+/g, " ").trim();

test("an imported link shows its models, cost and warnings", async () => {
  const { page, errors } = await open();
  await importLink(page);
  assert.equal(await page.locator(".bd-model").count(), 6);
  const side = await text(page, ".bd-ghead");
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

  await pick(page, "m3", "armour", "armour|armours/heavy-armour");
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
  assert.equal(await page.inputValue(".bd-gname"), "The Faithful of Bone");
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
  // Every step of the seven: its crumb is current and it has something to do.
  const crumbs = await page.locator(".bd-crumbs li button").allTextContents();
  assert.equal(crumbs.length, 8);                              // Battle + the seven steps (p.65)
  for (let step = 3; step <= 7; step++) {
    await page.click('[data-act="ab-step"][data-by="1"]');
    assert.equal(await text(page, '.bd-crumbs [aria-current="step"]'), crumbs[step].trim());
    assert.ok((await text(page, ".bd-step")).length > 10, `step ${step} is empty`);
  }
  assert.ok(await page.isVisible('[data-act="ab-finish"]'));   // the last step finishes
  for (let step = 7; step > 0; step--) {                        // and Back walks them all again
    await page.click('[data-act="ab-step"][data-by="-1"]');
    assert.equal(await text(page, '.bd-crumbs [aria-current="step"]'), crumbs[step - 1].trim());
  }
  for (let step = 0; step < 7; step++) await page.click('[data-act="ab-step"][data-by="1"]');
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
  // Language and Theme are themed dropdowns: focus lands on their triggers.
  const focusedSelect = () => page.evaluate(() => document.activeElement.closest(".nc-select")?.querySelector("select")?.id);
  await page.keyboard.press("Tab");
  assert.equal(await focusedSelect(), "lang-select");
  await page.keyboard.press("Tab");
  assert.equal(await focusedSelect(), "nc-theme-select");
  // Choosing from the list (a portal in <body>) keeps Settings open.
  await page.keyboard.press("ArrowDown");
  await page.click('.nc-select-pop .nc-select-option:has-text("Slate")');
  assert.equal(await isOpen(), true);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ncPalette), "slate");
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

/* ---- the "+ Add" picker, the gear stash, treasures and ambitions -------- */

/** The working copy (draft, or the saved gathering) from the browser. */
const working = (page) => page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem("necropolis-builder-gatherings-v1"));
  const id = saved.current;
  const drafts = JSON.parse(localStorage.getItem("necropolis-builder-drafts-v1") || "{}");
  return drafts[id] || saved.items?.[id] || saved.gatherings?.[id] || Object.values(saved).find(v => v?.id === id);
});
const modelOf = async (page, uid) => (await working(page)).models.find(m => m.uid === uid);

test("each list has its own Add button, and the picker explains what breaks a rule", async () => {
  const { page, errors } = await open();
  await importLink(page);
  const lists = (uid) => page.$$eval(`#bd-model-${uid} [data-act="m-pick"]`, bs => bs.map(b => b.dataset.list));
  assert.deepEqual(await lists("m1"), ["traits", "spells", "weapons", "armour", "equipment"]);   // the leader
  assert.deepEqual(await lists("m3"), ["traits", "weapons", "armour", "equipment"]);             // a minion
  assert.equal(await page.locator('#bd-model-m3 .bd-none').count(), 3);                          // traits, armour, equipment

  // Search, arrows and Enter add; the dialog stays open for more.
  await page.click('[data-act="m-pick"][data-uid="m3"][data-list="armour"]');
  assert.equal(await text(page, "#bd-picker-title"), "Add armour to Aberrant Husk");
  assert.ok(await page.evaluate(() => document.activeElement.matches(".bd-picker-search")));
  await page.keyboard.type("HEAVY");
  assert.deepEqual(await page.locator(".bd-picker-row .bd-pk-name").allTextContents(), ["Heavy Armour"]);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  assert.match(await text(page, ".bd-picker-status"), /Added Heavy Armour/);
  assert.ok(await page.isVisible("dialog.bd-picker[open]"));
  // A second suit of armour breaks a rule: the row says why, and still adds.
  await page.fill(".bd-picker-search", "");
  const why = page.locator('.bd-picker-row[data-value="armour|armours/light-armour"] .bd-pk-why');
  assert.equal(await why.getAttribute("data-reason"), "Only one suit of armour.");
  assert.equal(await page.locator('.bd-picker-row[data-value="armour|armours/shield"] .bd-pk-why').count(), 0);
  await page.keyboard.press("Escape");
  assert.equal(await page.isVisible("dialog.bd-picker[open]"), false);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.fid), "m3-add-armour");   // focus back
  assert.deepEqual((await modelOf(page, "m3")).armour, ["armours/heavy-armour"]);

  // Weapons are grouped, with chips to show one kind.
  await page.click('[data-act="m-pick"][data-uid="m3"][data-list="weapons"]');
  await page.click('[data-pk="chip"][data-chip="ranged-weapons"]');
  const names = await page.locator(".bd-picker-row .bd-pk-name").allTextContents();
  assert.deepEqual(names, ["Sling", "Bow", "Crossbow"]);
  await page.click('dialog.bd-picker [data-pk="close"].primary');
  assert.deepEqual(errors, []);
});

test("campaign gear: buy, keep in the stash, take back free, sell for half", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  await page.fill('[data-act="treasury"]', "100");
  await page.press('[data-act="treasury"]', "Tab");
  await page.click('[data-act="view"][data-view="gathering"]');
  const treasury = async () => Number((await working(page)).treasury);

  // Buying from the Markets costs its price.
  await page.click('[data-act="m-pick"][data-uid="m3"][data-list="weapons"]');
  assert.equal(await text(page, ".bd-picker-sec-title"), "Buy at the Markets");
  await page.click('.bd-picker-row[data-value="weapons|melee-weapons/axe"]');
  await page.waitForTimeout(150);
  await page.click('dialog.bd-picker [data-pk="close"].primary');
  assert.equal(await treasury(), 90);

  // Taking the Blade off asks: sell, or keep it in the stash.
  const blade = (await modelOf(page, "m3")).weapons.indexOf("melee-weapons/blade");
  await page.click(`#bd-model-m3 [data-act="m-del-item"][data-list="weapons"][data-i="${blade}"]`);
  assert.match(await text(page, "#bd-picker-title"), /Remove Blade from Aberrant Husk/);
  await page.click('[data-pk="rm"][data-how="stash"]');
  await page.waitForTimeout(150);
  assert.equal(await treasury(), 90);
  assert.deepEqual((await working(page)).gearStash, [{ key: "melee-weapons/blade", list: "weapons" }]);

  // Another model takes it from the stash, free.
  await page.click('[data-act="m-pick"][data-uid="m4"][data-list="weapons"]');
  assert.deepEqual(await page.locator(".bd-picker-sec-title").allTextContents(), ["From the stash (free)", "Buy at the Markets"]);
  await page.click('.bd-picker-row[data-value="stash|0"]');
  await page.waitForTimeout(150);
  await page.click('dialog.bd-picker [data-pk="close"].primary');
  assert.ok((await modelOf(page, "m4")).weapons.includes("melee-weapons/blade"));
  assert.deepEqual((await working(page)).gearStash, []);
  assert.equal(await treasury(), 90);

  // Selling the Axe brings back half its price (p.72).
  const axe = (await modelOf(page, "m3")).weapons.indexOf("melee-weapons/axe");
  await page.click(`#bd-model-m3 [data-act="m-del-item"][data-list="weapons"][data-i="${axe}"]`);
  await page.click('[data-pk="rm"][data-how="sell"]');
  await page.waitForTimeout(150);
  assert.equal(await treasury(), 95);
  assert.deepEqual(errors, []);
});

test("a greater treasure rolled by hand doesn't use up one owed from ambitions", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  const claimed = async () => (await working(page)).ambitions?.greaterClaimed || 0;
  const before = await claimed();
  await page.click('[data-act="t-roll"][data-kind="greater"][data-manual]');
  await page.selectOption("#t-to-0", "m1");                      // give it to the leader
  const key = await page.getAttribute('[data-act="t-take"][data-take="0"]', "data-key");
  assert.match(key, /^greater-treasures\//);
  await page.click('[data-act="t-take"][data-take="0"]');
  await page.waitForTimeout(150);
  assert.ok((await modelOf(page, "m1")).treasures.includes(key));
  assert.equal(await claimed(), before);
  assert.equal(await page.locator(".bd-owed").count(), 0);       // nothing owed, nothing claimed
  assert.deepEqual(errors, []);
});

test("Master Abyssal Artillery gives a chosen spell +1 channelling", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  const key = "ambitions/master-abyssal-artillery";
  await page.selectOption('[data-act="amb-add"]', key);
  for (let i = 0; i < 3; i++) await page.click(`[data-act="amb-tick"][data-key="${key}"][data-step="1"]`);
  assert.ok(await page.isDisabled(`[data-act="amb-complete"][data-key="${key}"]`));     // a spell first
  const spells = await page.$$eval(`[data-act="amb-target"][data-key="${key}"] option`, os => os.map(o => o.value).filter(Boolean));
  assert.ok(spells.includes("spells/wither"));
  await page.selectOption(`[data-act="amb-target"][data-key="${key}"]`, "spells/wither");
  await page.click(`[data-act="amb-complete"][data-key="${key}"]`);
  await page.click('[data-act="view"][data-view="gathering"]');
  const chip = page.locator('#bd-model-m1 .bd-item', { hasText: "Wither" });
  assert.match(await chip.textContent(), /\+1 channelling/);
  assert.deepEqual(errors, []);
});

test("the app's own interface uses icons, not emoji", async () => {
  const { page } = await open();
  await importLink(page);
  const scan = () => page.evaluate(() => {
    // Pictographs and dingbats; typographic arrows in prose (→) are fine,
    // and the cards and the roster sheet keep their own glyphs.
    const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}\u{2191}\u{2193}-\u{21FF}\u{25A0}-\u{25FF}]/u;
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) {
      if (n.parentElement.closest(".sheet, .wb-page, svg, script, style")) continue;
      if (re.test(n.nodeValue)) out.push(n.nodeValue.trim().slice(0, 40));
    }
    return out;
  });
  assert.deepEqual(await scan(), []);
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  assert.deepEqual(await scan(), []);
  await page.click('[data-act="ab-open"]');
  for (let i = 0; i < 7; i++) {
    assert.deepEqual(await scan(), [], `after-battle step ${i}`);
    await page.click('[data-act="ab-step"][data-by="1"]');
  }
  await go(page, "cards");
  assert.deepEqual(await scan(), []);
});

/* ---- focus, checks before applying, and what the audit found ---------------- */

/** The focused control, described by what it acts on. */
const focusOf = (page) => page.evaluate(() => {
  const a = document.activeElement;
  const s = a?.closest?.(".nc-select")?.querySelector(":scope > select") || a;
  return { tag: s?.tagName, act: s?.dataset?.act || null, uid: s?.dataset?.uid || null, card: s?.closest?.(".bd-model")?.id || null };
});
/** Press a button with the pointer held a moment, as a person does. */
async function slowPress(page, selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(150);
}
/** Into the after-battle sequence, on step `n`. */
async function afterBattle(page, n = 0) {
  await importLink(page);
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  await page.click('[data-act="ab-open"]');
  for (let i = 0; i < n; i++) await page.click('.bd-wizard-nav [data-act="ab-step"][data-by="1"]');
}

test("focus stays on a model's up button when it moves", async () => {
  const { page, errors } = await open();
  await importLink(page);
  const order = async () => (await working(page)).models.map(m => m.uid);
  const before = await order();
  await page.focus('[data-act="m-up"][data-uid="m5"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  assert.notDeepEqual(await order(), before);                    // it did move
  assert.deepEqual(await focusOf(page), { tag: "BUTTON", act: "m-up", uid: "m5", card: "bd-model-m5" });
  // And again, from the same place on the keyboard.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  assert.equal((await focusOf(page)).act, "m-up");
  assert.equal((await focusOf(page)).uid, "m5");
  assert.deepEqual(errors, []);
});

test("focus stays near a control that goes away", async () => {
  const { page, errors } = await open();
  await importLink(page);
  // Moved to the top, its up button is disabled: focus stays on that card.
  await page.focus('[data-act="m-up"][data-uid="m2"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  assert.ok(await page.isDisabled('[data-act="m-up"][data-uid="m2"]'));
  assert.deepEqual(await focusOf(page), { tag: "BUTTON", act: "m-down", uid: "m2", card: "bd-model-m2" });
  // A removed chip: focus stays in its card.
  await page.focus('#bd-model-m4 [data-act="m-del-item"][data-list="armour"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  assert.equal((await focusOf(page)).card, "bd-model-m4");
  // A removed model: focus moves to a neighbouring card, not the page top.
  await page.focus('[data-act="m-remove"][data-uid="m5"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => document.activeElement.closest(".bd-model")?.id);
  assert.match(after, /^bd-model-m/);
  assert.notEqual(after, "bd-model-m5");
  assert.deepEqual(errors, []);
});

test("focus survives a redraw on campaign and after-battle controls", async () => {
  const { page, errors } = await open();
  await afterBattle(page, 7);
  // A roll button, then a themed dropdown found again by its id.
  await page.focus('[data-act="ab-roll-scn"][data-part="missions"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  assert.equal((await focusOf(page)).act, "ab-roll-scn");
  await page.focus('#ab-next-environments + .nc-select-trigger');
  await page.selectOption("#ab-next-environments", { index: 1 });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.activeElement.closest(".nc-select")?.querySelector("select")?.id), "ab-next-environments");
  // The step buttons keep it too.
  await page.focus('.bd-wizard-nav [data-act="ab-step"][data-by="-1"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  assert.equal((await focusOf(page)).act, "ab-step");
  assert.deepEqual(errors, []);
});

test("a click isn't lost to the redraw a blur causes", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.fill('[data-act="m-name"][data-uid="m4"]', "Bob");  // still focused
  await slowPress(page, '[data-act="m-remove"][data-uid="m5"]');
  const g = await working(page);
  assert.equal(g.models.some(m => m.uid === "m5"), false, "the Remove click landed");
  assert.equal(g.models.find(m => m.uid === "m4").name, "Bob");
  // In the print queue: leaving a name unchanged redraws nothing.
  await page.click('[data-act="cards"]');
  await page.waitForTimeout(200);
  await page.goto(`${URL_}#cards/queue`);
  await page.waitForFunction(() => document.querySelectorAll("#queue-list .queue-item").length > 1);
  const count = () => page.locator("#queue-list .queue-item").count();
  const n = await count();
  await page.focus("#queue-list .queue-item:nth-child(1) .name");
  await page.locator("#queue-list .queue-item-wrap").nth(0).locator(".name").focus();
  await slowPress(page, '#queue-list .queue-item-wrap:nth-child(2) button[aria-label="Remove"]');
  assert.equal(await count(), n - 1, "unchanged name: the Remove click landed");
  // A real rename still applies, and the click that ended it still lands.
  const name = page.locator("#queue-list .queue-item-wrap").nth(0).locator(".name");
  await name.fill("Renamed");
  await slowPress(page, '#queue-list .queue-item-wrap:nth-child(2) button[aria-label="Remove"]');
  assert.equal(await count(), n - 2, "rename: the Remove click landed");
  assert.equal(await text(page, "#queue-list .queue-item-wrap:nth-child(1) .name"), "Renamed");
  assert.deepEqual(errors, []);
});

test("dice: Apply waits for whole numbers from 1 to 10", async () => {
  const { page, errors } = await open();
  await afterBattle(page, 2);
  const apply = '[data-act="ab-apply-rewards"]';
  assert.ok(await page.isDisabled(apply));                       // blank
  await page.fill("#ab-d1", "3");
  assert.ok(await page.isDisabled(apply));                       // one die
  for (const bad of ["0", "11", "2.5", "-1"]) {
    await page.fill("#ab-d2", bad);
    assert.ok(await page.isDisabled(apply), `die ${bad}`);
  }
  await page.fill("#ab-d2", "10");
  assert.ok(await page.isEnabled(apply));
  await page.fill("#ab-d2", "");
  assert.ok(await page.isDisabled(apply));                       // and back
  // The Roll button fills them in, so Apply is ready.
  await page.click('[data-act="ab-roll-rewards"]');
  await page.waitForTimeout(150);
  assert.ok(await page.isEnabled(apply));
  await page.click(apply);
  await page.waitForTimeout(150);
  assert.ok((await working(page)).campaign.afterBattle.done.rewards.dice.every(n => n >= 1 && n <= 10));
  assert.deepEqual(errors, []);
});

test("an action that fails says why, and changes nothing", async () => {
  const { page, errors } = await open();
  await afterBattle(page, 2);
  // Past the disabled button (a stale page, a script): the check still holds.
  await page.evaluate(() => {
    const b = document.querySelector('[data-act="ab-apply-rewards"]');
    b.disabled = false;
    b.click();
  });
  await page.waitForTimeout(150);
  assert.match(await text(page, ".bd-step .bd-notice"), /whole number from 1 to 10/);
  assert.equal((await working(page)).campaign.afterBattle.done.rewards, undefined);
  assert.equal(await page.getAttribute(".bd-notice", "role"), "alert");
  // The next action that works clears it.
  await page.fill("#ab-d1", "3");
  await page.fill("#ab-d2", "4");
  await page.click('[data-act="ab-apply-rewards"]');
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".bd-notice").count(), 0);
  assert.equal((await working(page)).campaign.afterBattle.done.rewards.obols, 37);
  assert.deepEqual(errors, []);
});

test("an error from the rules engine reads in the player's words", async () => {
  const { page } = await open();
  const words = (act, err) => page.evaluate(([a, e]) =>
    import("/js/builder-campaign.js").then(m => m.failText(a, e)), [act, err]);
  // An error code with a label uses the label: any label, so this holds
  // whichever codes the engine has.
  assert.match(await words("ab-income", { code: "diceInvalid" }), /whole number from 1 to 10/);
  // A code with no label falls back on what the action was.
  assert.match(await words("ab-income", { code: "no-such-code" }), /whole number from 1 to 10/);
  assert.match(await words("other", { code: "no-such-code", message: "boom" }), /didn't work: boom/);
});

test("a malady that asks for a stat can't be applied without one", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  await page.click('[data-act="ab-open"]');
  await page.check('[data-field="leaderShattered"]');
  await page.waitForTimeout(100);
  await page.click('.bd-wizard-nav [data-act="ab-step"][data-by="1"]');
  await page.fill('[data-act="ab-malady-roll"]', "2");           // Cursed Form
  await page.press('[data-act="ab-malady-roll"]', "Tab");
  await page.waitForTimeout(150);
  const apply = '[data-act="ab-apply-malady"]';
  assert.ok(await page.isDisabled(apply));
  await page.selectOption("#ab-mal-stat", "move");
  assert.ok(await page.isEnabled(apply));                        // no redraw needed
  await page.click(apply);
  await page.waitForTimeout(150);
  assert.equal((await working(page)).campaign.afterBattle.done.maladies.stat, "move");
  assert.deepEqual(errors, []);
});

test("withdrawing agreement on the omen withdraws the omen", async () => {
  const { page, errors } = await open();
  await afterBattle(page, 7);
  await page.check('[data-act="ab-omen-agree"]');
  await page.waitForTimeout(100);
  await page.click('[data-act="ab-roll-scn"][data-part="dread-omens"]');
  await page.waitForTimeout(100);
  assert.ok((await working(page)).campaign.afterBattle.next["dread-omens"]);
  await page.uncheck('[data-act="ab-omen-agree"]');
  await page.waitForTimeout(100);
  assert.equal((await working(page)).campaign.afterBattle.next["dread-omens"], null);
  await page.click('[data-act="ab-finish"]');
  await page.waitForTimeout(100);
  assert.equal((await working(page)).campaign.nextScenario.omen, null);
  assert.deepEqual(errors, []);
});

test("an agreed omen still carries over", async () => {
  const { page, errors } = await open();
  await afterBattle(page, 7);
  await page.check('[data-act="ab-omen-agree"]');
  await page.waitForTimeout(100);
  await page.click('[data-act="ab-roll-scn"][data-part="dread-omens"]');
  await page.waitForTimeout(100);
  const omen = (await working(page)).campaign.afterBattle.next["dread-omens"];
  await page.click('[data-act="ab-finish"]');
  await page.waitForTimeout(100);
  assert.equal((await working(page)).campaign.nextScenario.omen, omen);
  assert.deepEqual(errors, []);
});

test("a reward's pick stops counting when the model is gone", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  const key = "ambitions/a-favoured-familiar";
  const complete = `[data-act="amb-complete"][data-key="${key}"]`;
  await page.selectOption('[data-act="amb-add"]', key);
  await page.click(`[data-act="amb-tick"][data-key="${key}"][data-step="1"]`);
  assert.ok(await page.isDisabled(complete));
  await page.selectOption(`[data-act="amb-target"][data-key="${key}"]`, "m2");
  await page.waitForTimeout(100);
  assert.ok(await page.isEnabled(complete));
  await page.click('[data-act="view"][data-view="gathering"]');
  await page.click('[data-act="m-remove"][data-uid="m2"]');
  await page.waitForTimeout(100);
  await page.click('[data-act="view"][data-view="campaign"]');
  assert.ok(await page.isDisabled(complete));
  assert.deepEqual(errors, []);
});

test("a treasure waiting to be given out stays with its gathering", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  const first = (await working(page)).id;
  await page.click('[data-act="t-roll"][data-kind="greater"][data-manual]');
  await page.waitForTimeout(100);
  assert.ok(await page.locator('[data-act="t-take"]').count() > 0);
  // A second gathering, its campaign started, has nothing waiting.
  await page.click("#bd-new");
  await page.waitForTimeout(100);
  await page.click('[data-act="view"][data-view="campaign"]');
  await page.click('[data-act="start"]');
  await page.waitForTimeout(100);
  assert.notEqual((await working(page)).id, first);
  assert.equal(await page.locator('[data-act="t-take"]').count(), 0);
  // Back on the first, it's still there.
  await page.selectOption("#bd-pick", first);
  await page.waitForTimeout(100);
  assert.ok(await page.locator('[data-act="t-take"]').count() > 0);
  assert.deepEqual(errors, []);
});

test("restoring a backup replaces that gathering's unsaved draft", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.fill(".bd-gname", "Saved name");
  await page.press(".bd-gname", "Tab");
  await page.waitForTimeout(100);
  await page.click('[data-act="save"]');
  await page.waitForTimeout(100);
  const backup = JSON.stringify(await working(page));
  await page.fill(".bd-gname", "Unsaved name");
  await page.press(".bd-gname", "Tab");
  await page.waitForTimeout(100);
  await openImport(page);
  await page.fill("#json-in", backup);
  await page.click("#load-warband-btn");
  await page.waitForTimeout(300);
  assert.equal(await page.inputValue(".bd-gname"), "Saved name");
  assert.equal(await page.isVisible(".bd-draft"), false);
  assert.match(await text(page, "#match-list"), /unsaved changes on this device were replaced/);
  assert.deepEqual(errors, []);
});

test("the importer turns away JSON that isn't an object", async () => {
  await lastContext?.close();
  lastContext = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await lastContext.newPage();
  const errors = [], alerts = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => { alerts.push(d.message()); d.accept(); });
  await page.goto(URL_);
  await ready(page);
  await openImport(page);
  for (const bad of ["null", "3", '"text"', "[]"]) {
    await page.fill("#json-in", bad);
    await page.click("#load-warband-btn");
    await page.waitForTimeout(100);
  }
  assert.equal(alerts.length, 4);
  assert.ok(alerts.every(a => /isn't a gathering/.test(a)));
  assert.deepEqual(errors, []);
});

test("closing Import with no gathering open keeps focus on Import", async () => {
  const { page } = await open();
  await openImport(page);
  await page.click("#bd-import-close");
  await page.waitForTimeout(100);
  assert.equal(await page.isHidden("#bd-import-panel"), true);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.act), "import");
});

test("the reason Print is unavailable can be reached and read", async () => {
  const { page } = await open();
  await page.evaluate(() => { window.printed = 0; window.print = () => { window.printed++; }; });
  const reason = page.locator("#print-reason");
  assert.equal(await reason.evaluate(el => el.hidden), false);
  assert.match(await reason.textContent(), /queue is empty/);
  // The keyboard reaches it, it describes the button, and it does nothing.
  await page.focus("#global-print-btn");
  assert.equal(await page.evaluate(() => document.activeElement.id), "global-print-btn");
  assert.equal(await page.getAttribute("#global-print-btn", "aria-disabled"), "true");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.printed), 0);
  assert.equal(page.url().endsWith("#cards/queue"), false);
  // With something to print the reason goes and the button works.
  await importLink(page);
  assert.equal(await reason.evaluate(el => el.hidden), true);
  assert.equal(await page.getAttribute("#global-print-btn", "aria-disabled"), null);
  await page.click("#global-print-btn");
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.printed), 1);
});

test("the empty Gatherings page has no blank picker, and its buttons work", async () => {
  for (const width of [1360, 390]) {
    await lastContext?.close();
    lastContext = await browser.newContext({ viewport: { width, height: 860 } });
    const page = await lastContext.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${URL_}#gatherings`);
    await page.waitForSelector(".bd-empty");
    assert.equal(await page.locator('section[data-tab="builder"] .bd-toolbar select:visible, section[data-tab="builder"] .bd-toolbar .nc-select-trigger:visible').count(), 0);
    assert.equal(await page.isVisible(".bd-toolbar"), false);
    // Import opens its panel, with its toggle back in the toolbar.
    await page.click('#bd-body [data-act="import"]');
    assert.ok(await page.isVisible("#bd-import-panel"));
    assert.ok(await page.isVisible("#bd-import"));
    await page.click("#bd-import-close");
    assert.equal(await page.isVisible(".bd-toolbar"), false);
    // New gathering opens one; with only one there's still no picker.
    await page.click('#bd-body [data-act="new"]');
    await page.waitForSelector(".bd-ghead");
    assert.ok(await page.isVisible("#bd-new"));
    assert.equal(await page.locator(".bd-toolbar .nc-select-trigger:visible").count(), 0);
    // A second one brings the picker.
    await page.click("#bd-new");
    await page.waitForTimeout(150);
    const picker = page.locator(".bd-toolbar .nc-select-trigger:visible");
    assert.equal(await picker.count(), 1);
    assert.deepEqual(errors, []);
  }
});

test("a dropdown's filter text follows the language", async () => {
  const { page } = await open();
  await go(page, "cards");
  // A select the page keeps across a language switch: redrawn ones start over.
  const trigger = "#lib-category + .nc-select-trigger";
  await page.click(trigger);
  assert.equal(await page.getAttribute(".nc-select-filter-input", "placeholder"), "Type to filter…");
  await page.fill(".nc-select-filter-input", "zzzz");
  assert.equal(await text(page, ".nc-select-empty"), "No matches");
  await page.keyboard.press("Escape");
  await page.click("#nav-settings > summary");
  await page.selectOption("#lang-select", "es");
  await page.waitForTimeout(150);
  await page.click("#nav-settings > summary");
  await page.click(trigger);
  assert.equal(await page.getAttribute(".nc-select-filter-input", "placeholder"), "Escribe para filtrar…");
  await page.fill(".nc-select-filter-input", "zzzz");
  assert.equal(await text(page, ".nc-select-empty"), "Sin resultados");
});

test("every after-battle and campaign field has a name", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  const unnamed = () => page.evaluate(() =>
    [...document.querySelectorAll(".bd-campaign select, .bd-campaign input:not([type=hidden])")]
      .filter(f => !f.getAttribute("aria-label") && !f.labels?.length)
      .map(f => f.id || f.dataset.act || f.outerHTML.slice(0, 60)));
  await page.evaluate(() => document.querySelectorAll("details.bd-fold").forEach(d => { d.open = true; }));
  await page.click('[data-act="t-roll"][data-kind="minor"][data-manual]');
  await page.waitForTimeout(100);
  assert.deepEqual(await unnamed(), []);
  await page.click('[data-act="t-cancel"]');
  await page.waitForTimeout(100);
  await page.click('[data-act="ab-open"]');
  await page.check('[data-field="leaderShattered"]');
  for (let step = 0; step < 8; step++) {
    assert.deepEqual(await unnamed(), [], `step ${step}`);
    if (step === 7) break;
    await page.click('.bd-wizard-nav [data-act="ab-step"][data-by="1"]');
    await page.waitForTimeout(50);
    if (step === 5) {    // the Bazaar: the Tomb Robber's second dropdown
      await page.click('[data-act="ab-tomb-roll"]');
      await page.waitForTimeout(100);
    }
  }
  assert.deepEqual(errors, []);
});

test("one primary action per area", async () => {
  const { page } = await open();
  await importLink(page);
  // Print leads in the header; the gathering's own buttons are secondary.
  assert.equal(await page.locator('[data-act="roster"].primary').count(), 0);
  assert.equal(await page.locator('[data-act="roster"].secondary').count(), 1);
  assert.equal(await page.locator(".bd-actions .primary").count(), 0);
  // An unsaved draft has Save as the header card's one primary.
  await page.fill(".bd-gname", "Changed");
  await page.press(".bd-gname", "Tab");
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".bd-ghead .primary").count(), 1);
  assert.equal(await page.locator('.bd-ghead [data-act="save"].primary').count(), 1);
  // The wizard: Next on the way, Finish on the last step, never both.
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  await page.click('[data-act="ab-open"]');
  for (let step = 0; step <= 7; step++) {
    assert.equal(await page.locator(".bd-wizard .primary").count(), 1, `step ${step}`);
    if (step < 7) await page.click('.bd-wizard-nav [data-act="ab-step"][data-by="1"]');
  }
});

test("the step line says where you are, and moves between steps", async () => {
  const { page, errors } = await open();
  await afterBattle(page);
  const now = () => text(page, ".bd-stepper-now");
  assert.equal(await now(), "Battle");
  const prev = '.bd-stepper [data-by="-1"]', next = '.bd-stepper [data-by="1"]';
  assert.ok(await page.isDisabled(prev));
  // dispatchEvent: the line only shows on phones, and this page is wide.
  await page.locator(next).dispatchEvent("click");
  await page.waitForTimeout(100);
  assert.equal(await now(), "Step 1 of 7: Reconstitution Maladies");
  for (let i = 0; i < 6; i++) { await page.locator(next).dispatchEvent("click"); await page.waitForTimeout(50); }
  assert.match(await now(), /^Step 7 of 7: /);
  assert.ok(await page.isDisabled(next));
  await page.locator(prev).dispatchEvent("click");
  await page.waitForTimeout(100);
  assert.match(await now(), /^Step 6 of 7: /);
  assert.equal(await page.locator(".bd-crumbs li button").count(), 8);  // the full list is still there
  assert.deepEqual(errors, []);
});

test("the picker's cursor stays in place after taking from the stash", async () => {
  const { page, errors } = await open();
  await importLink(page);
  await page.click('[data-act="start-built"]');
  // Two weapons in the stash, from m3 and m4.
  for (const uid of ["m3", "m4"]) {
    await page.click(`#bd-model-${uid} [data-act="m-del-item"][data-list="weapons"]`);
    await page.click('[data-pk="rm"][data-how="stash"]');
    await page.waitForTimeout(150);
  }
  assert.equal((await working(page)).gearStash.length, 2);
  const active = () => page.getAttribute(".bd-picker-row.is-active", "data-value");
  await page.click('[data-act="m-pick"][data-uid="m5"][data-list="weapons"]');
  // Take the second (last) stash row: the row now in its place is next.
  await page.click('.bd-picker-row[data-value="stash|1"]');
  await page.waitForTimeout(150);
  assert.equal((await working(page)).gearStash.length, 1);
  const rows = await page.$$eval(".bd-picker-row", rs => rs.map(r => r.dataset.value));
  assert.equal(await active(), rows[1]);
  assert.notEqual(await active(), rows[0]);
  assert.deepEqual(errors, []);
});

/* ---- the user's rules decisions (beasts' weapons, selling, sellswords, traits) --- */

/** Set a dropdown (themed or not) the way a player's choice does. */
const choose = (page, sel, value) => page.$eval(sel, (el, v) => {
  el.value = v;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, value).then(() => page.waitForTimeout(150));
const CLAWS = "melee-weapons/claws-and-fangs";

/** The example gathering in a campaign with 200 obols, on the Campaign view. */
async function inCampaign(page) {
  await importLink(page);
  await page.click('[data-act="start-built"]');
  await page.click('[data-act="view"][data-view="campaign"]');
  await page.fill('[data-act="treasury"]', "200");
  await page.press('[data-act="treasury"]', "Tab");
  await page.waitForTimeout(150);
}
/** Hire a sellsword and field it for the next battle. */
async function fieldSellsword(page, key = "sellswords/blightblade-beast-hunter") {
  await choose(page, '[data-act="hire"]', key);
  const uid = (await working(page)).models.at(-1).uid;
  await page.click(`[data-act="field"][data-uid="${uid}"]`);
  await page.waitForTimeout(150);
  return uid;
}

test("a new beast starts with Claws and Fangs, keeps them, and swaps them when its type changes", async () => {
  const { page, errors } = await open();
  await go(page, "gatherings");
  await page.click('#bd-body [data-act="new"]');
  await page.waitForTimeout(150);
  await choose(page, '[data-act="add-model"]', "leaders/lich");
  await choose(page, '[data-act="add-model"]', "minions/small-beast");
  const { uid, weapons } = (await working(page)).models.at(-1);
  assert.deepEqual(weapons, [CLAWS]);
  const card = `#bd-model-${uid}`;
  assert.match(await text(page, `${card} .bd-model-cost`), /^65/);       // 60 + 5
  // The dropdown shows that total before it's picked.
  assert.match(await text(page, '[data-act="add-model"] option[value="minions/small-beast"]'), /\(65\)/);
  // Its only allowed weapon has no ✕.
  assert.equal(await page.locator(`${card} [data-act="m-del-item"][data-list="weapons"]`).count(), 0);
  assert.equal(await page.locator(`${card} .bd-item[title]`).count(), 1);
  // No warning about the weapon, unlike a linked beast on the free one.
  assert.ok(!(await text(page, card)).includes("can't use"));
  // A type with a free weapon takes that instead, and back again.
  await choose(page, `${card} [data-act="m-profile"]`, "minions/corpse-husk");
  assert.deepEqual((await modelOf(page, uid)).weapons, ["melee-weapons/improvised-weapon"]);
  await choose(page, `${card} [data-act="m-profile"]`, "minions/large-beast");
  assert.deepEqual((await modelOf(page, uid)).weapons, [CLAWS]);
  // A second weapon brings the ✕ back, so Large Claws can replace them.
  await pick(page, uid, "weapons", "weapons|melee-weapons/large-claws");
  await page.click(`${card} [data-act="m-del-item"][data-list="weapons"][data-i="0"]`);
  await page.waitForTimeout(150);
  assert.deepEqual((await modelOf(page, uid)).weapons, ["melee-weapons/large-claws"]);
  assert.equal(await page.locator(`${card} [data-act="m-del-item"][data-list="weapons"]`).count(), 0);
  assert.deepEqual(errors, []);
});

test("in a campaign a recruited beast pays for its weapon and can't sell or stash it", async () => {
  const { page, errors } = await open();
  await inCampaign(page);
  await page.click('[data-act="ab-open"]');
  await page.click('[data-act="ab-goto"][data-step="6"]');
  assert.match(await text(page, '#ab-recruit-key option[value="minions/small-beast"]'), /· 65$/);
  assert.match(await text(page, '#ab-recruit-key option[value="minions/corpse-husk"]'), /· 50$/);
  await choose(page, "#ab-recruit-key", "minions/small-beast");
  await page.click('[data-act="ab-recruit"]');
  await page.waitForTimeout(150);
  let g = await working(page);
  assert.equal(g.treasury, 135);
  const { uid, weapons } = g.models.at(-1);
  assert.deepEqual(weapons, [CLAWS]);
  // Not on offer in the Markets' sell list.
  assert.equal(await page.locator(`[data-act="ab-sell"][data-uid="${uid}"]`).count(), 0);
  // Nor on the card.
  await page.click('[data-act="view"][data-view="gathering"]');
  assert.equal(await page.locator(`#bd-model-${uid} [data-act="m-del-item"][data-list="weapons"]`).count(), 0);
  // A model on the free weapon that becomes a beast buys its Claws and Fangs.
  await choose(page, '[data-act="add-model"]', "minions/corpse-husk");
  g = await working(page);
  assert.equal(g.treasury, 85);
  const husk = g.models.at(-1).uid;
  await choose(page, `#bd-model-${husk} [data-act="m-profile"]`, "minions/familiar");
  assert.deepEqual((await modelOf(page, husk)).weapons, [CLAWS]);
  assert.equal((await working(page)).treasury, 80);
  assert.deepEqual(errors, []);
});

test("equipment and thrown weapons sell for half, from a model or the stash", async () => {
  const { page, errors } = await open();
  await inCampaign(page);
  await page.click('[data-act="view"][data-view="gathering"]');
  await pick(page, "m3", "equipment", "equipment|miscellaneous-equipment/banner");
  const treasury = async () => Number((await working(page)).treasury);
  assert.equal(await treasury(), 180);
  // The prompt offers the sale and the stash, and no discard for something with a cost.
  await page.click('#bd-model-m3 [data-act="m-del-item"][data-list="equipment"]');
  assert.match(await text(page, '[data-pk="rm"][data-how="sell"]'), /Sell for 10 obols/);
  assert.ok(await page.isVisible('[data-pk="rm"][data-how="stash"]'));
  assert.equal(await page.locator('[data-pk="rm"][data-how="discard"]').count(), 0);
  assert.match(await text(page, ".bd-picker-note"), /house rule/);
  await page.click('dialog.bd-picker [data-pk="close"]');   // Cancel changes nothing
  assert.deepEqual((await modelOf(page, "m3")).equipment, ["miscellaneous-equipment/banner"]);
  await page.click('#bd-model-m3 [data-act="m-del-item"][data-list="equipment"]');
  await page.click('[data-pk="rm"][data-how="sell"]');
  await page.waitForTimeout(150);
  assert.equal(await treasury(), 190);
  assert.deepEqual((await modelOf(page, "m3")).equipment, []);
  // A thrown weapon: kept in the stash, then sold from there (half of 5).
  await pick(page, "m3", "equipment", "equipment|thrown-weapons/wardart");
  assert.equal(await treasury(), 185);
  await page.click('#bd-model-m3 [data-act="m-del-item"][data-list="equipment"]');
  await page.click('[data-pk="rm"][data-how="stash"]');
  await page.waitForTimeout(150);
  await page.click('[data-act="view"][data-view="campaign"]');
  await page.click('[data-act="g-sell"][data-i="0"]');
  await page.waitForTimeout(150);
  assert.equal(await treasury(), 187);
  assert.deepEqual((await working(page)).gearStash, []);
  assert.deepEqual(errors, []);
});

test("removing a trait asks once the campaign has started (p.17), and not before", async () => {
  const { page, errors } = await open();
  await importLink(page);
  const traits = async () => (await modelOf(page, "m1")).traits;
  const before = await traits();
  // Before the campaign: straight off, no question.
  await page.click('#bd-model-m1 [data-act="m-del-item"][data-list="traits"][data-i="1"]');
  await page.waitForTimeout(150);
  assert.equal(await page.locator("dialog.bd-picker[open]").count(), 0);
  assert.equal((await traits()).length, before.length - 1);
  // Started: it cites p.17, Cancel keeps it, the other choice removes it.
  await page.click('[data-act="start-built"]');
  await page.waitForTimeout(150);
  await page.click('#bd-model-m1 [data-act="m-del-item"][data-list="traits"][data-i="0"]');
  assert.match(await text(page, ".bd-picker-note"), /cannot be removed or sold \(p\.17\)/);
  await page.click('dialog.bd-picker [data-pk="close"]');
  assert.equal((await traits()).length, before.length - 1);
  await page.click('#bd-model-m1 [data-act="m-del-item"][data-list="traits"][data-i="0"]');
  await page.click('[data-pk="choice"][data-how="remove"]');
  await page.waitForTimeout(150);
  assert.equal((await traits()).length, before.length - 2);
  assert.deepEqual(errors, []);
});

test("logging a battle asks whether to pay for a deployed sellsword (p.74)", async () => {
  const { page, errors } = await open();
  await inCampaign(page);
  const uid = await fieldSellsword(page);                         // 30 to the roster: 170
  const g0 = await working(page);
  assert.equal(g0.treasury, 170);
  assert.match(await text(page, ".bd-log-form ~ .bd-deploy-note"), /20 obols to deploy/);

  // Cancel: nothing logged, nothing charged.
  await page.click('[data-act="battle-add"]');
  assert.match(await text(page, '[data-pk="choice"][data-how="pay"]'), /Pay 20 obols to deploy/);
  await page.click('dialog.bd-picker [data-pk="close"]');
  await page.waitForTimeout(150);
  assert.equal((await working(page)).history.length, 0);
  assert.equal((await working(page)).treasury, 170);

  // Log without paying: logged, not charged.
  await page.click('[data-act="battle-add"]');
  await page.click('[data-pk="choice"][data-how="skip"]');
  await page.waitForTimeout(150);
  let g = await working(page);
  assert.equal(g.history.length, 1);
  assert.equal(g.treasury, 170);
  assert.ok(!g.history[0].transactions.some(t => t.type === "deploy"));

  // Pay: charged, and the transaction is in the battle's entry.
  await page.fill("#bl-obols", "7");
  await page.click('[data-act="battle-add"]');
  await page.click('[data-pk="choice"][data-how="pay"]');
  await page.waitForTimeout(150);
  g = await working(page);
  assert.equal(g.history.length, 2);
  assert.equal(g.treasury, 170 - 20 + 7);                         // the form's fields survived the prompt
  assert.deepEqual(g.history[1].transactions.map(t => [t.type, t.uid, t.obols]), [["deploy", uid, -20]]);

  // Waived by the opponent's limit: says so and doesn't ask.
  await page.click('[data-act="opp-higher"]');
  await page.waitForTimeout(150);
  assert.match(await text(page, ".bd-log-form ~ .bd-deploy-note"), /no cost to deploy.*100\+ higher \(p\.74\)/);
  await page.click('[data-act="battle-add"]');
  await page.waitForTimeout(150);
  assert.equal(await page.locator("dialog.bd-picker[open]").count(), 0);
  g = await working(page);
  assert.equal(g.history.length, 3);
  assert.equal(g.treasury, 157);
  assert.deepEqual(errors, []);
});

test("finishing the after-battle sequence asks the same, in Spanish too", async () => {
  const { page, errors } = await open();
  await choose(page, "#lang-select", "es");
  await page.waitForTimeout(200);
  await inCampaign(page);
  await fieldSellsword(page);
  await page.click('[data-act="ab-open"]');
  assert.match(await text(page, ".bd-step .bd-deploy-note"), /20 óbolos por desplegar/);
  await page.click('[data-act="ab-goto"][data-step="7"]');
  assert.match(await text(page, ".bd-step .bd-deploy-note"), /20 óbolos por desplegar/);
  await page.click('[data-act="ab-finish"]');
  assert.match(await text(page, '[data-pk="choice"][data-how="pay"]'), /Pagar 20 óbolos por desplegar/);
  await page.click('[data-pk="choice"][data-how="pay"]');
  await page.waitForTimeout(150);
  const g = await working(page);
  assert.equal(g.campaign.afterBattle, undefined);
  assert.equal(g.history.length, 1);
  assert.equal(g.treasury, 150);
  assert.deepEqual(g.history[0].transactions.map(t => t.type), ["hire", "deploy"]);
  assert.deepEqual(errors, []);
});
