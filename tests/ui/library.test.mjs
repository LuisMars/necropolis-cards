/**
 * Cards > Library: the More menu and the per-card printed stepper.
 * Run with `npm run test:ui`.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 8767;
const URL_ = `http://localhost:${PORT}/#cards`;

let server, browser, page;

before(async () => {
  server = spawn("python3", ["web/serve.py", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(URL_)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch();
  page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await page.goto(URL_);
  await page.waitForFunction(() => document.querySelectorAll(".lib-tile").length > 1);
});
after(async () => { await browser?.close(); server?.kill(); });

test("More menu holds the inventory actions, closes on acting, Escape and outside tap", async () => {
  const open = () => page.evaluate(() => document.getElementById("lib-more").open);
  assert.equal(await open(), false);
  assert.equal(await page.isHidden("#inv-export-file"), true);
  await page.click("#lib-more > summary");
  assert.equal(await open(), true);
  for (const id of ["lib-add-all", "inv-export-file", "inv-import-file", "inv-copy"]) {
    assert.equal(await page.isVisible("#" + id), true, id);
    assert.ok((await page.locator("#" + id).boundingBox()).height >= 44, id);
  }
  // No jargon in the labels, and no separate paste button.
  const labels = await page.locator("#lib-more .lib-more-panel button").allTextContents();
  assert.deepEqual(labels.map(t => t.trim()).slice(1), ["Export backup", "Import backup", "Copy backup"]);
  assert.ok(!labels.some(t => /json/i.test(t)));
  assert.equal(await page.locator("#inv-paste-toggle").count(), 0);
  // Import backup closes the menu and offers a file or pasted text.
  await page.click("#inv-import-file");
  assert.equal(await open(), false);
  assert.equal(await page.isVisible("#inv-paste-panel"), true);
  assert.equal(await page.isVisible("#inv-pick-file"), true);
  assert.equal(await page.isVisible("#inv-paste-area"), true);
  await page.fill("#inv-paste-area", JSON.stringify({ printed: [{ key: "spell", name: "Zz Test", printed: 2 }] }));
  await page.click("#inv-paste-apply");
  assert.match(await page.textContent("#inv-status"), /Imported 1 card/);
  assert.equal(await page.isHidden("#inv-paste-panel"), true);
  // Bad pasted text names no format.
  await page.click("#lib-more > summary");
  await page.click("#inv-import-file");
  await page.fill("#inv-paste-area", "nonsense");
  await page.click("#inv-paste-apply");
  assert.ok(!/json/i.test(await page.textContent("#inv-status")));
  assert.match(await page.getAttribute("#inv-status", "class"), /err/);
  // A file also imports.
  await page.click("#lib-more > summary");
  await page.click("#inv-import-file");
  await page.setInputFiles("#inv-file-input", { name: "b.json", mimeType: "application/json", buffer: Buffer.from('{"printed":[]}') });
  await page.waitForFunction(() => /Imported 0/.test(document.getElementById("inv-status").textContent));
  assert.equal(await page.isHidden("#inv-paste-panel"), true);
  // At 390 the menu button shares the count's row.
  const dc = await page.evaluate(() => {
    const c = document.getElementById("lib-count").getBoundingClientRect(), m = document.querySelector("#lib-more > summary").getBoundingClientRect();
    return Math.abs((c.top + c.height / 2) - (m.top + m.height / 2));
  });
  assert.ok(dc < 12, `More shares the count row (${dc})`);
  // Escape.
  await page.click("#lib-more > summary");
  await page.keyboard.press("Escape");
  assert.equal(await open(), false);
  // Outside tap.
  await page.click("#lib-more > summary");
  await page.click("#lib-count");
  assert.equal(await open(), false);
  // Status stays visible after the menu closes.
  await page.click("#lib-more > summary");
  await page.click("#inv-export-file");
  assert.equal(await open(), false);
  assert.match(await page.textContent("#inv-status"), /Exported/);
  assert.equal(await page.isVisible("#inv-status"), true);
});

test("a card's printed stepper opens on demand, one at a time, keeping focus", async () => {
  const toggles = page.locator(".lib-tile .printed-toggle");
  const stepperShown = (i) => page.locator(".lib-tile").nth(i).locator(".printed-ctl").isVisible();
  assert.equal(await stepperShown(0), false);
  assert.equal(await toggles.nth(0).getAttribute("aria-expanded"), "false");
  assert.match(await toggles.nth(0).textContent(), /printed/);
  const queueBefore = await page.locator(".lib-tile .in-queue").count();
  await toggles.nth(0).click();
  assert.equal(await stepperShown(0), true);
  assert.equal(await toggles.nth(0).getAttribute("aria-expanded"), "true");
  // Tapping the toggle did not add the card.
  assert.equal(await page.locator(".lib-tile .in-queue").count(), queueBefore);
  // Stepping survives the re-render and keeps focus on the same button.
  await page.locator(".lib-tile").nth(0).locator(".inc").click();
  assert.equal(await page.evaluate(() => document.activeElement.className), "inc");
  assert.match(await toggles.nth(0).textContent(), /^1 printed/);
  assert.equal(await stepperShown(0), true);
  // Opening another closes the first.
  await toggles.nth(1).click();
  assert.equal(await stepperShown(1), true);
  assert.equal(await stepperShown(0), false);
  // Tapping again closes it.
  await toggles.nth(1).click();
  assert.equal(await stepperShown(1), false);
  assert.equal(await page.evaluate(() => document.activeElement.className), "printed-toggle");
  // "+ Add" adds once.
  const n0 = await page.locator(".lib-tile .queue-ctl").count();
  await page.locator(".lib-tile .add").nth(2).click();
  assert.equal(await page.locator(".lib-tile .queue-ctl").count(), n0 + 1);
  assert.equal((await page.locator(".lib-tile .queue-n").first().textContent()).trim(), "1");
});

test("a queued card gets a - / N / + control that unqueues down to + Add", async () => {
  const tile = page.locator(".lib-tile").filter({ has: page.locator(".queue-ctl") }).first();
  const name = await tile.locator(".name").textContent();
  const nav = () => page.textContent("#queue-count");
  const before = await nav();
  await tile.locator(".qinc").click();
  assert.equal((await tile.locator(".queue-n").textContent()).trim(), "2");
  assert.equal(await page.evaluate(() => document.activeElement.className), "add qinc");
  assert.notEqual(await nav(), before);
  const less = tile.locator(".qdec");
  assert.ok((await less.boundingBox()).height >= 44);
  assert.match(await less.getAttribute("aria-label"), new RegExp(name.trim().slice(0, 6)));
  await less.click();
  assert.equal((await tile.locator(".queue-n").textContent()).trim(), "1");
  assert.equal(await page.evaluate(() => document.activeElement.className), "qdec");
  assert.equal(await nav(), before);
  await less.click();
  assert.equal(await page.locator(".lib-tile").filter({ hasText: name.trim() }).first().locator(".queue-ctl").count(), 0);
  assert.equal(await page.locator(".lib-tile").filter({ hasText: name.trim() }).first().locator("button.add").isVisible(), true);
});

test("search and category stick to the top while scrolling; tiles still take clicks", async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const sameRow = await page.evaluate(() => {
    const s = document.getElementById("lib-search").getBoundingClientRect();
    const c = document.querySelector("#lib-category + .nc-select, #lib-category").getBoundingClientRect();
    return Math.abs(s.top - c.top) < 2;
  });
  assert.equal(sameRow, true, "search and category share one row at phone width");
  await page.evaluate(() => window.scrollTo(0, 3000));
  await page.waitForTimeout(200);
  const bar = await page.evaluate(() => {
    const el = document.querySelector(".lib-filter"), b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, pos: getComputedStyle(el).position };
  });
  assert.equal(bar.pos, "sticky");
  assert.ok(bar.top >= -1 && bar.top < 4, `bar top ${bar.top}`);
  // A tile below the bar is hit-testable and queues on click.
  const n0 = await page.locator(".lib-tile .queue-ctl").count();
  const idx = await page.evaluate((bottom) => [...document.querySelectorAll(".lib-tile")].findIndex(t => {
    const r = t.getBoundingClientRect();
    return !t.querySelector(".queue-ctl") && r.top > bottom + 4 && r.bottom < innerHeight;
  }), bar.bottom);
  assert.ok(idx >= 0, "a tile is on screen under the bar");
  const tile = page.locator(".lib-tile").nth(idx);
  const box = await tile.boundingBox();
  assert.ok(box.y > bar.bottom - 1, "the tile sits under the bar");
  assert.equal(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".lib-tile"), [box.x + 20, box.y + 40]), true);
  await tile.locator("button.add").click();
  assert.equal(await page.locator(".lib-tile .queue-ctl").count(), n0 + 1);
  // Tiles skip off-screen rendering.
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".lib-tile")).contentVisibility), "auto");
  await page.evaluate(() => window.scrollTo(0, 0));
});

test("tile preview shows the whole text: not clamped, not clipped", async () => {
  const r = await page.evaluate(() => {
    const ps = [...document.querySelectorAll(".lib-tile .preview")];
    const p = ps.sort((a, b) => b.textContent.length - a.textContent.length)[0];
    p.scrollIntoView();
    const cs = getComputedStyle(p);
    const t = p.closest(".lib-tile");
    return { len: p.textContent.length, sh: p.scrollHeight, ch: p.clientHeight,
      clamp: cs.webkitLineClamp, ov: cs.overflow, fits: t.scrollWidth <= t.clientWidth };
  });
  assert.ok(r.len > 150, "long card");
  assert.ok(r.sh <= r.ch, `${r.sh} > ${r.ch}`);
  assert.equal(r.clamp, "none");
  assert.equal(r.ov, "visible");
  assert.ok(r.fits);
});
