/**
 * Print guard: the app's screen styling must never reach the printed cards
 * or the A4 roster. Those are the rulebook-derived material; the screen
 * design (styles.css, design-v5.css, palettes) is free to change.
 *
 * Checks what the printed output inherits rather than comparing pixels, so
 * it runs anywhere: the base font and figures under the card SVGs, the app
 * chrome hidden, and the sheets at their physical size.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = Number(process.env.NC_TEST_PORT) || 8766;
const URL_ = `http://localhost:${PORT}/`;
const EXPORT = readFileSync(new URL("../fixtures/companion-export.json", import.meta.url), "utf8");

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
  await page.goto(URL_);
  await page.waitForFunction(() => document.querySelectorAll(".lib-tile").length > 0);
  // Queue every card the sample warband matches, then open the print queue.
  await page.click('nav.tabs a[data-dest="gatherings"]');
  await page.locator('#bd-import:visible, #bd-body [data-act="import"]').first().click();
  await page.fill("#json-in", EXPORT);
  await page.click("#parse-btn");
  await page.waitForTimeout(500);
  await page.click("#nav-queue-link");
  await page.waitForTimeout(800);
  await page.emulateMedia({ media: "print" });
});
after(async () => { await browser?.close(); server?.kill(); });

test("printed cards inherit the original base font, not the app's", async () => {
  const base = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { family: cs.fontFamily, size: cs.fontSize, numeric: cs.fontVariantNumeric };
  });
  assert.match(base.family, /system-ui/);
  assert.equal(base.size, "15px");
  assert.equal(base.numeric, "normal");
  // Text inside the card SVGs keeps the template's own fonts and default figures.
  const svgText = await page.$$eval(".sheet svg text", els => els.slice(0, 40).map(el => getComputedStyle(el).fontVariantNumeric));
  assert.ok(svgText.length > 0, "cards rendered");
  assert.ok(svgText.every(v => v === "normal"), `figures: ${[...new Set(svgText)]}`);
});

test("only the sheets print: app chrome and the Builder are hidden", async () => {
  const shown = await page.evaluate(() =>
    ["header.app", 'section.tab[data-tab="builder"]', 'section.tab[data-tab="library"]', ".queue-list", "footer.app-foot"]
      .filter(sel => { const el = document.querySelector(sel); return el && getComputedStyle(el).display !== "none"; }));
  assert.deepEqual(shown, []);
});

test("sheets keep their physical A4 size", async () => {
  const sizes = await page.$$eval(".sheet", els => els.map(el => [el.offsetWidth, el.offsetHeight]));
  assert.ok(sizes.length > 0);
  // 210 × 297 mm at 96 dpi
  for (const [w, h] of sizes) {
    assert.ok(Math.abs(w - 794) <= 1 && Math.abs(h - 1123) <= 1, `${w}×${h}`);
  }
});

/* ---- pixels: palettes and the Roster view's Cards part ------------------- */

const LINK = "c1;pl0,a1,tc2,tb6,sn0,sn3,sn1,sb3,sb1;pm4,a1,ewm8;pm3,a1,ewm1;pm1,a1,ewm4,ea0;pm1,a1,ewm4,ea0;pm5,a1,twu8,ewm8";

/** A fresh page with the example link imported (saved, nothing queued). */
async function withGathering() {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on("dialog", d => d.accept());
  await p.goto(URL_);
  await p.waitForFunction(() => document.querySelectorAll(".lib-tile").length > 0);
  await p.click('nav.tabs a[data-dest="gatherings"]');
  await p.locator('#bd-import:visible, #bd-body [data-act="import"]').first().click();
  await p.fill("#json-in", LINK);
  await p.click("#load-warband-btn");
  await p.waitForTimeout(400);
  return p;
}
/** Every printed sheet in `sel`, as PNG bytes, under print media. */
async function sheets(p, sel, warband) {
  await p.evaluate((w) => document.body.classList.toggle("printing-warband", w), warband);
  await p.emulateMedia({ media: "print" });
  await p.waitForTimeout(200);
  const out = [];
  for (const h of await p.$$(sel)) out.push(await h.screenshot());
  await p.emulateMedia({ media: "screen" });
  return out;
}
const same = (a, b) => a.length === b.length && a.every((buf, i) => buf.equals(b[i]));

test("the Roster's Cards part prints the same sheets as the queue would", async () => {
  const p = await withGathering();
  await p.click('[data-act="view"][data-view="roster"]');
  await p.click('button[data-route="gatherings/roster/cards"]');
  await p.waitForTimeout(600);
  assert.equal(await p.textContent("#queue-count"), "0");             // the queue is untouched
  const count = await p.textContent(".bd-roster-count");
  const fromRoster = await sheets(p, "#roster-sheets .sheet", true);
  assert.ok(fromRoster.length > 0);
  assert.match(count, new RegExp(`Sheets: ${fromRoster.length}$`));
  // The roster sheet itself isn't printed alongside.
  await p.emulateMedia({ media: "print" });
  assert.equal(await p.isVisible("#wb-pages"), false);
  await p.emulateMedia({ media: "screen" });
  // The same cards through the queue.
  await p.click('.bd-roster-bar [data-act="cards"]');
  await p.click("#nav-queue-link");
  await p.waitForTimeout(800);
  const fromQueue = await sheets(p, "#sheets-wrap .sheet", false);
  assert.equal(fromQueue.length, fromRoster.length);
  assert.ok(same(fromRoster, fromQueue), "roster card sheets differ from the queue's");
  await p.context().close();
});

test("printed sheets and the roster are identical in every palette", async () => {
  const p = await withGathering();
  await p.click('.bd-roster-bar [data-act="cards"], .bd-ghead [data-act="cards"]');
  const palettes = await p.$$eval("#nc-theme-select option", os => os.map(o => o.value));
  assert.ok(palettes.length >= 4);
  const shoot = async (value) => {
    await p.evaluate((v) => { const s = document.getElementById("nc-theme-select"); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, value);
    await p.goto(`${URL_}#cards/queue`); await p.waitForTimeout(700);
    const cards = await sheets(p, "#sheets-wrap .sheet", false);
    await p.goto(`${URL_}#gatherings/roster`); await p.waitForTimeout(700);
    const roster = await sheets(p, "#wb-pages .wb-page", true);
    return { cards, roster, palette: await p.evaluate(() => document.documentElement.dataset.ncPalette) };
  };
  const base = await shoot(palettes[0]);
  assert.ok(base.cards.length > 0 && base.roster.length > 0);
  for (const value of palettes.slice(1)) {
    const now = await shoot(value);
    assert.ok(same(base.cards, now.cards), `card sheets differ in ${value}`);
    assert.ok(same(base.roster, now.roster), `roster differs in ${value}`);
  }
  // Light device setting ("Match device" when the palette has it).
  await p.emulateMedia({ colorScheme: "light" });
  const light = await shoot(palettes.includes("auto") ? "auto" : palettes[0]);
  assert.ok(same(base.cards, light.cards) && same(base.roster, light.roster), "prints differ with a light device setting");
  await p.context().close();
});

test("print queue: summary and a More menu; options are real checkboxes with state shown beside the summary", async () => {
  const p = await withGathering();
  await p.click('.bd-roster-bar [data-act="cards"], .bd-ghead [data-act="cards"]');
  await p.goto(`${URL_}#cards/queue`);
  await p.waitForTimeout(700);
  const open = () => p.evaluate(() => document.getElementById("print-more").open);
  const ids = ["mark-printed-btn", "clear-queue-btn-2", "bleed-toggle", "backs-toggle", "need-toggle"];
  assert.ok((await p.textContent("#sheet-count")).trim().length > 0, "summary shown");
  assert.equal(await open(), false);
  for (const id of ids) assert.equal(await p.isHidden("#" + id), true, `${id} hidden while the menu is closed`);
  assert.equal(await p.isVisible("#print-opts-on"), false, "nothing to show with every option off");
  await p.click("#print-more > summary");
  for (const id of ids) assert.equal(await p.isVisible("#" + id), true, id);
  assert.equal(await p.getAttribute("#backs-toggle", "type"), "checkbox");
  // Ticking an option keeps the menu open and shows the state next to the summary.
  await p.click("#backs-toggle");
  assert.equal(await open(), true);
  assert.equal(await p.isChecked("#backs-toggle"), true);
  assert.match(await p.textContent("#print-opts-on"), /Card backs/);
  await p.click("#bleed-toggle");
  assert.match(await p.textContent("#print-opts-on"), /Gap between cards . Card backs/);
  await p.keyboard.press("Escape");
  assert.equal(await open(), false);
  assert.equal(await p.isVisible("#print-opts-on"), true, "state stays visible with the menu closed");
  // Clear queue still asks first.
  const queued = await p.textContent("#queue-count");
  await p.click("#print-more > summary");
  await p.click("#clear-queue-btn-2");
  assert.ok(await p.isVisible("dialog.nc-dialog[open]"), "asks first, in the themed dialog");
  assert.equal(await p.textContent('dialog.nc-dialog[open] [data-nd="ok"]'), "Clear");
  await p.click('dialog.nc-dialog [data-nd="cancel"]');
  assert.equal(await open(), false);
  assert.equal(await p.textContent("#queue-count"), queued, "cancelled: queue kept");
  await p.click("#print-more > summary");
  await p.click("#clear-queue-btn-2");
  await p.click('dialog.nc-dialog[open] [data-nd="ok"]');
  assert.equal(await p.textContent("#queue-count"), "0");
  // Nothing queued: one message, no More menu, no list or preview panel.
  assert.equal(await p.isVisible("#queue-empty"), true);
  assert.equal(await p.isVisible("#print-more"), false);
  assert.equal(await p.isVisible(".queue-panel"), false);
  await p.context().close();
});

test("print queue: the first Move up and the last Move down are disabled", async () => {
  const p = await withGathering();
  await p.click('.bd-roster-bar [data-act="cards"], .bd-ghead [data-act="cards"]');
  await p.goto(`${URL_}#cards/queue`);
  await p.waitForTimeout(700);
  const n = await p.locator("#queue-list .queue-item").count();
  assert.ok(n > 2, "several queued cards");
  const dis = (i, label) => p.locator("#queue-list .queue-item").nth(i).locator(`button[aria-label="${label}"]`).isDisabled();
  assert.equal(await dis(0, "Move up"), true);
  assert.equal(await dis(0, "Move down"), false);
  assert.equal(await dis(n - 1, "Move down"), true);
  assert.equal(await dis(n - 1, "Move up"), false);
  await p.context().close();
});

test("a card's text is placed the same alone and in a mixed queue, for every template", async () => {
  const r = await page.evaluate(async () => {
    const { state } = await import("/js/state.js");
    const { renderCardSvg } = await import("/js/templates.js");
    const cats = state.bundle.categories;
    const picks = [];
    const seen = new Set();
    for (const [key, cat] of Object.entries(cats)) {
      if (!(cat.rows || []).length) continue;
      // One card per template, and a few more: every sellsword, the first spell and weapon.
      if (!seen.has(cat.template)) { seen.add(cat.template); picks.push({ key, row: cat.rows[0] }); }
    }
    for (const row of cats["sellswords"].rows) picks.push({ key: "sellswords", row });
    picks.push({ key: "spells", row: cats["spells"].rows[0] }, { key: "melee-weapons", row: cats["melee-weapons"].rows[0] });
    // Spell and weapon cards go first so a leak would reach the sellswords after them.
    picks.sort((a, b) => (a.key === "sellswords") - (b.key === "sellswords"));
    const measure = (host) => [...host.children].map(card =>
      [...card.querySelectorAll("text, tspan")].map(t => {
        const b = t.getBBox();
        return [t.textContent.trim().slice(0, 24), Math.round(b.x * 100) / 100, Math.round(b.y * 100) / 100, Math.round(b.width * 100) / 100];
      }));
    const host = (cards) => {
      const h = document.createElement("div");
      h.style.cssText = "position:absolute;left:0;top:0;width:" + (cards.length === 1 ? "63mm" : "63mm");
      h.innerHTML = cards.map(c => `<div style="width:63mm;height:88mm">${renderCardSvg({ ...c, override: {} })}</div>`).join("");
      document.body.append(h);
      return h;
    };
    await document.fonts.ready;
    const mixedHost = host(picks);
    const mixed = measure(mixedHost);
    mixedHost.remove();
    const diffs = [];
    for (let i = 0; i < picks.length; i++) {
      const h = host([picks[i]]);
      const alone = measure(h)[0];
      h.remove();
      if (JSON.stringify(alone) !== JSON.stringify(mixed[i])) diffs.push(picks[i].key + ":" + (picks[i].row.name || i));
    }
    return { n: picks.length, templates: [...seen].length, diffs };
  });
  assert.ok(r.templates >= 8, `${r.templates} templates`);
  assert.deepEqual(r.diffs, []);
});
