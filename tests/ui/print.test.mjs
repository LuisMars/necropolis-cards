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
const PORT = 8766;
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
  // Queue every card the sample warband matches, then open the print tab.
  await page.click('nav.tabs button[data-tab="import"]');
  await page.fill("#json-in", EXPORT);
  await page.click("#parse-btn");
  await page.waitForTimeout(500);
  await page.click('nav.tabs button[data-tab="print"]');
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
