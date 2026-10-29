/**
 * Browser tests for the themed select (web/js/select.js) against
 * web/select-demo.html, served by web/serve.py on its own port.
 *
 *   npm run test:ui -- tests/ui/select.test.mjs
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 8767;
const URL_ = `http://localhost:${PORT}/select-demo.html`;

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

async function open(ctx = {}, query = "") {
  const context = await browser.newContext({ viewport: { width: 1100, height: 820 }, ...ctx });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(URL_ + query);
  await page.waitForFunction(() => document.querySelector(".nc-select-trigger, .nc-select-native"));
  return { page, errors };
}
const trig = id => `#${id} + .nc-select-trigger`;
const shown = page => page.locator(".nc-select-pop .nc-select-option:not([hidden])");
const changes = page => page.evaluate(() => window.__changes.filter(c => c.id !== "palette"));
const activeText = page => page.evaluate(() => {
  const t = document.activeElement;
  const id = t.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id).querySelector(".nc-select-label").textContent : null;
});

test("enhances eligible selects and leaves the rest native", async () => {
  const { page, errors } = await open();
  const info = await page.evaluate(() => ({
    wrapped: [...document.querySelectorAll(".nc-select > select")].map(s => s.id),
    native: document.querySelector("#native").parentElement.classList.contains("nc-select"),
    hidden: getComputedStyle(document.querySelector("#short")).opacity,
    ariaHidden: document.querySelector("#short").getAttribute("aria-hidden"),
  }));
  assert.ok(["palette", "short", "placeholder", "grouped", "clipped", "disabled", "bottom"]
    .every(id => info.wrapped.includes(id)));
  assert.equal(info.native, false);
  assert.equal(info.hidden, "0");
  assert.equal(info.ariaHidden, "true");
  const t = page.locator(trig("short"));
  assert.equal(await t.getAttribute("role"), "combobox");
  assert.equal(await t.getAttribute("aria-expanded"), "false");
  assert.equal(await t.getAttribute("aria-label"), "Result");
  assert.equal(await t.textContent(), "Win");
  assert.equal(await page.locator(trig("disabled")).getAttribute("aria-disabled"), "true");
  assert.deepEqual(errors, []);
});

test("mouse selection fires change on the native select", async () => {
  const { page, errors } = await open();
  await page.click(trig("short"));
  assert.equal(await page.locator(trig("short")).getAttribute("aria-expanded"), "true");
  await page.click(".nc-select-pop .nc-select-option >> text=Loss");
  assert.equal(await page.locator(".nc-select-pop").count(), 0);
  assert.equal(await page.inputValue("#short"), "loss");
  assert.equal(await page.locator(trig("short")).textContent(), "Loss");
  assert.deepEqual(await changes(page), [{ id: "short", act: "result", value: "loss" }]);
  // Grouped: the m-add value contract is kept.
  await page.click(trig("grouped"));
  await page.click(".nc-select-pop .nc-select-option >> text=Heavy Armour");
  assert.deepEqual((await changes(page)).at(-1),
    { id: "grouped", act: "m-add", value: "armour|armours/heavy-armour" });
  // Disabled options do nothing; clicking outside closes.
  await page.click(trig("grouped"));
  await page.click(".nc-select-pop .nc-select-option >> text=Sling", { force: true });   // aria-disabled
  assert.equal(await page.locator(".nc-select-pop").count(), 1);
  await page.mouse.click(20, 780);
  assert.equal(await page.locator(".nc-select-pop").count(), 0);
  assert.equal((await changes(page)).length, 2);
  // Clicking a disabled trigger doesn't open.
  await page.click(trig("disabled"), { force: true });
  assert.equal(await page.locator(".nc-select-pop").count(), 0);
  assert.deepEqual(errors, []);
});

test("keyboard: open, move, type-ahead, Enter, Escape, Tab", async () => {
  const { page, errors } = await open();
  await page.focus(trig("clipped"));
  await page.keyboard.press("Enter");
  assert.equal(await activeText(page), "Necromancer");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  assert.equal(await activeText(page), "Skeleton");
  await page.keyboard.press("End");
  assert.equal(await activeText(page), "Wraith");
  await page.keyboard.press("Home");
  assert.equal(await activeText(page), "Necromancer");
  await page.keyboard.press("PageDown");
  assert.equal(await activeText(page), "Wraith");
  await page.keyboard.type("z");
  assert.equal(await activeText(page), "Zombie");
  await page.keyboard.press("Escape");                         // closes, keeps value and focus
  assert.equal(await page.locator(".nc-select-pop").count(), 0);
  assert.equal(await page.inputValue("#clipped"), "leaders/necromancer");
  assert.equal(await page.evaluate(() => document.activeElement.matches("#clipped + .nc-select-trigger")), true);

  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.type("gh");
  assert.equal(await activeText(page), "Ghoul");
  await page.keyboard.press("Enter");
  assert.equal(await page.inputValue("#clipped"), "minions/ghoul");
  assert.equal(await page.locator(trig("clipped")).textContent(), "Ghoul");
  assert.deepEqual((await changes(page)).at(-1), { id: "clipped", act: null, value: "minions/ghoul" });

  // Space opens; Tab picks the active option and moves on.
  await page.focus(trig("short"));
  await page.keyboard.press(" ");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  assert.equal(await page.inputValue("#short"), "loss");
  assert.equal(await page.locator(".nc-select-pop").count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.matches("#placeholder + .nc-select-trigger")), true);
  assert.deepEqual(errors, []);
});

test("long lists: the filter narrows options and keeps matching groups", async () => {
  const { page, errors } = await open();
  await page.click(trig("grouped"));
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains("nc-select-filter-input")), true);
  const all = await shown(page).count();
  assert.ok(all > 20);
  await page.keyboard.type("armour");
  assert.deepEqual(await shown(page).locator(".nc-select-label").allTextContents(),
    ["Light Armour (8)", "Heavy Armour (15)", "Shield (5)", "Helm (4)"]);     // group label matches too
  assert.deepEqual(await page.locator(".nc-select-pop .nc-select-groupbox:not([hidden]) .nc-select-group").allTextContents(), ["Armours"]);
  await page.fill(".nc-select-filter-input", "ecto");
  assert.deepEqual(await shown(page).locator(".nc-select-label").allTextContents(), ["Ectoplasm (11)", "Ectoplasm Vigour (14)"]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await page.inputValue("#grouped"), "upgrade|upgrades/ectoplasm-vigour");
  // No matches.
  await page.click(trig("grouped"));
  await page.keyboard.type("qqq");
  assert.equal(await shown(page).count(), 0);
  assert.equal(await page.isVisible(".nc-select-empty"), true);
  await page.keyboard.press("Escape");
  // Typing on the closed trigger seeds the filter.
  await page.keyboard.type("h");
  assert.equal(await page.inputValue(".nc-select-filter-input"), "h");
  await page.keyboard.press("Escape");
  // Legality reasons are shown and are the option's description.
  await page.click(trig("grouped"));
  const halberd = page.locator(".nc-select-pop .nc-select-option", { hasText: "Halberd" });
  assert.match(await halberd.textContent(), /Two-handed/);
  const desc = await halberd.getAttribute("aria-describedby");
  assert.match(await page.textContent(`#${desc}`), /already carries a shield/);
  assert.notEqual(await halberd.getAttribute("aria-disabled"), "true");
  assert.deepEqual(errors, []);
});

test("programmatic changes update the trigger", async () => {
  const { page, errors } = await open();
  await page.click("#set-value");                               // select.value = "draw", no event
  await page.waitForFunction(() => document.querySelector("#short + .nc-select-trigger").textContent === "Draw");
  await page.evaluate(() => { const s = document.querySelector("#placeholder"); s.selectedIndex = 2; });
  await page.waitForFunction(() => document.querySelector("#placeholder + .nc-select-trigger").textContent === "Covenant of Bone");
  await page.evaluate(() => {
    const s = document.querySelector("#clipped");
    s.innerHTML = `<option value="a">Alpha</option><option value="b" selected>Beta</option>`;
  });
  await page.waitForFunction(() => document.querySelector("#clipped + .nc-select-trigger").textContent === "Beta");
  await page.evaluate(() => { document.querySelector("#short").disabled = true; });
  await page.waitForFunction(() => document.querySelector("#short + .nc-select-trigger").getAttribute("aria-disabled") === "true");
  // The palette control is synced by design-palettes.js through .value.
  await page.evaluate(() => { const s = document.querySelector("#palette"); s.value = "slate"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  assert.equal(await page.getAttribute("html", "data-nc-palette"), "slate");
  assert.equal(await page.locator(trig("palette")).textContent(), "Slate");
  assert.deepEqual(errors, []);
});

test("Playwright selectOption still drives an enhanced select", async () => {
  const { page, errors } = await open();
  await page.selectOption("#grouped", "armour|armours/heavy-armour");
  assert.equal(await page.locator(trig("grouped")).textContent(), "Heavy Armour (15)");
  assert.deepEqual((await changes(page)).at(-1), { id: "grouped", act: "m-add", value: "armour|armours/heavy-armour" });
  assert.deepEqual(errors, []);
});

test("selects injected with innerHTML are enhanced; removed ones are cleaned up", async () => {
  const { page, errors } = await open();
  await page.click("#inject");
  await page.waitForSelector(trig("injected"));
  assert.equal(await page.locator(trig("injected")).getAttribute("aria-label"), "Omen");
  await page.click(trig("injected"));
  await page.click(".nc-select-pop .nc-select-option >> text=Black Rain");
  assert.deepEqual((await changes(page)).at(-1), { id: "injected", act: "omen", value: "o2" });
  await page.evaluate(() => document.querySelector("#injected").remove());
  await page.waitForFunction(() => !document.querySelector("#inject-here .nc-select"));
  assert.deepEqual(errors, []);
});

test("the popup escapes overflow:hidden and flips above near the bottom", async () => {
  const { page, errors } = await open();
  await page.click(trig("clipped"));
  const box = await page.locator(".sd-clip").boundingBox();
  const pop = await page.locator(".nc-select-pop").boundingBox();
  assert.ok(pop.y + pop.height > box.y + box.height);           // extends past the clipping box
  assert.equal(await page.isVisible(".nc-select-pop >> text=Wraith"), true);
  await page.keyboard.press("Escape");

  await page.evaluate(() => {
    const t = document.querySelector("#bottom + .nc-select-trigger");
    window.scrollBy(0, t.getBoundingClientRect().bottom - innerHeight + 20);
  });
  await page.click(trig("bottom"));
  assert.equal(await page.getAttribute(".nc-select-pop", "data-placement"), "top");
  const t = await page.locator(trig("bottom")).boundingBox();
  const p = await page.locator(".nc-select-pop").boundingBox();
  assert.ok(p.y + p.height <= t.y);
  assert.ok(p.y >= 0);
  // Narrow viewport: never wider than the screen.
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 360, height: 700 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.click(trig("grouped"));
  const n = await page.locator(".nc-select-pop").boundingBox();
  assert.ok(n.x >= 0 && n.x + n.width <= 360);
  assert.deepEqual(errors, []);
});

test("coarse pointers keep the native picker (unless forced)", async () => {
  const touch = { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true };
  const { page, errors } = await open(touch);
  assert.equal(await page.locator(".nc-select-trigger").count(), 0);
  assert.equal(await page.evaluate(() => document.querySelector("#short").classList.contains("nc-select-native")), true);
  assert.equal(await page.isVisible("#short"), true);
  await page.selectOption("#short", "draw");
  assert.deepEqual(await changes(page), [{ id: "short", act: "result", value: "draw" }]);
  assert.deepEqual(errors, []);
  const forced = await open(touch, "?force");
  assert.ok(await forced.page.locator(".nc-select-trigger").count() > 0);
  assert.deepEqual(forced.errors, []);
});
