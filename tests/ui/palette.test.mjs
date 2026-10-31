/**
 * Theme: "Match device" follows the system colour scheme (live and on
 * reload), a stored palette wins over it, and the printed cards and A4
 * roster are pixel-identical whichever palette the screen uses.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 8769;
const URL_ = `http://localhost:${PORT}/`;
const KEY = "necropolis-ui-palette-v56";
const EXPORT = readFileSync(new URL("../fixtures/companion-export.json", import.meta.url), "utf8");

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

async function open(colorScheme, stored) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme });
  if (stored !== undefined) await ctx.addInitScript(([k, v]) => { if (!sessionStorage.seeded) { localStorage.setItem(k, v); sessionStorage.seeded = 1; } }, [KEY, stored]);
  const page = await ctx.newPage();
  page.on("dialog", d => d.accept());
  await page.goto(URL_);
  await page.waitForFunction(() => document.querySelector("#bd-body > *"));
  return page;
}
/** Choose in a Settings menu field (opens the menu if it is closed). */
async function choose(page, sel, value) {
  await page.evaluate(() => { document.getElementById("nav-settings").open = true; });
  await page.selectOption(sel, value);
}
/** Wait for the resolved palette (media-query change events are async). */
const settle = (page, palette) => page.waitForFunction(p => document.documentElement.dataset.ncPalette === p, palette, { timeout: 3000 });
const theme = page => page.evaluate(() => ({
  palette: document.documentElement.dataset.ncPalette,
  choice: document.documentElement.dataset.ncPaletteChoice,
  control: document.querySelector("#nc-theme-select").value,
  scheme: getComputedStyle(document.documentElement).colorScheme,
}));

test("Match device is the default and follows the colour scheme, live and on reload", async () => {
  const page = await open("dark");
  assert.deepEqual(await theme(page), { palette: "obsidian", choice: "auto", control: "auto", scheme: "dark" });
  assert.equal(await page.evaluate(k => localStorage.getItem(k), KEY), null);

  await page.emulateMedia({ colorScheme: "light" });
  await settle(page, "vellum");
  assert.deepEqual(await theme(page), { palette: "vellum", choice: "auto", control: "auto", scheme: "light" });
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(232, 227, 217)");

  await page.reload();
  // Resolved in <head>: the attribute is there before the body is parsed.
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ncPalette), "vellum");
  await page.emulateMedia({ colorScheme: "dark" });
  await settle(page, "obsidian");
  assert.equal((await theme(page)).palette, "obsidian");
  await page.context().close();
});

test("the palette is applied before first paint", async () => {
  const ctx = await browser.newContext({ colorScheme: "light" });
  // Record the palette the moment <body> appears.
  await ctx.addInitScript(() => {
    new MutationObserver((_, mo) => {
      if (document.body) { window.__atBody = document.documentElement.dataset.ncPalette; mo.disconnect(); }
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  await page.goto(URL_);
  assert.equal(await page.evaluate(() => window.__atBody), "vellum");
  await ctx.close();
});

test("a chosen palette is stored and wins over the device; Match device can be chosen again", async () => {
  const page = await open("light");
  await choose(page, "#nc-theme-select", "slate");
  assert.equal(await page.evaluate(k => localStorage.getItem(k), KEY), "slate");
  await page.reload();
  assert.deepEqual(await theme(page), { palette: "slate", choice: "slate", control: "slate", scheme: "dark" });

  await choose(page, "#nc-theme-select", "auto");
  assert.equal(await page.evaluate(k => localStorage.getItem(k), KEY), "auto");
  assert.equal((await theme(page)).palette, "vellum");
  await page.emulateMedia({ colorScheme: "dark" });
  await settle(page, "obsidian");
  assert.equal((await theme(page)).palette, "obsidian");
  await page.context().close();
});

test("stored values from before Match device still load; unknown ones fall back to it", async () => {
  let page = await open("light", "ink-bone");
  assert.deepEqual(await theme(page), { palette: "ink-bone", choice: "ink-bone", control: "ink-bone", scheme: "dark" });
  await page.context().close();
  page = await open("light", "no-such-palette");
  assert.equal((await theme(page)).palette, "vellum");
  assert.equal((await theme(page)).choice, "auto");
  await page.context().close();
});

test("the Match device option follows the page language", async () => {
  const page = await open("dark");
  const label = () => page.textContent('#nc-theme-select option[value="auto"]');
  assert.equal(await label(), "Match device");
  await choose(page, "#lang-select", "es");
  await page.waitForFunction(() => document.documentElement.lang === "es");
  assert.equal(await label(), "Según el dispositivo");
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === "es");
  assert.equal(await label(), "Según el dispositivo");
  await page.context().close();
});

test("printed card sheets and roster sheets are identical in Vellum and Obsidian", async () => {
  const page = await open("light", "vellum");
  // Queue every card the sample warband matches; it also opens as a gathering.
  await page.click('nav.tabs a[data-dest="gatherings"]');
  await page.locator('#bd-import:visible, #bd-body [data-act="import"]').first().click();
  await page.fill("#json-in", EXPORT);
  await page.click("#parse-btn");
  await page.waitForTimeout(500);

  const sheets = async (route, selector, warband) => {
    const out = {};
    for (const palette of ["vellum", "obsidian"]) {
      await page.emulateMedia({ media: "screen" });
      await choose(page, "#nc-theme-select", palette);
      await page.goto(URL_ + "#" + route);
      await page.waitForTimeout(800);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.ncPalette), palette);
      await page.evaluate(on => document.body.classList.toggle("printing-warband", on), warband);
      await page.emulateMedia({ media: "print" });
      const els = await page.locator(selector).all();
      assert.ok(els.length > 0, `${selector} rendered`);
      out[palette] = [];
      for (const el of els) out[palette].push(await el.screenshot());
    }
    assert.equal(out.vellum.length, out.obsidian.length);
    out.vellum.forEach((buf, i) => assert.ok(buf.equals(out.obsidian[i]), `${selector} #${i + 1} differs between palettes`));
    return out.vellum.length;
  };
  await sheets("cards/queue", ".sheet", false);
  await sheets("gatherings/roster", ".wb-page", true);
  await page.context().close();
});
