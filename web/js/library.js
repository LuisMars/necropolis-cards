/**
 * Library tab — filterable list of every card in the bundle.
 *
 * Each tile can be added to the print queue, shows a full text preview,
 * how many copies are queued, and a "printed" stepper that records how many
 * you've already printed (the inventory used by the Print tab's
 * "only what I still need" mode). The inventory can be exported/imported as
 * JSON (file download/upload or copy/paste).
 */

import { icon } from "./lucide.js";
import {
  state, saveQueue,
  printedCount, addPrinted, cardId, savePrinted,
} from "./state.js";
import { $, escapeHtml } from "./util.js";
import { pickField } from "./i18n.js";
import { label, plural, categoryTitle } from "./builder/messages.js";

const lang = () => state.lang || "en";
const L = (k) => label(k, lang());
const catName = (key, cat) => categoryTitle("cat", key, cat.title, lang());

const $search = $("lib-search");
const $cat    = $("lib-category");
const $grid   = $("lib-grid");
const $count  = $("lib-count");
const $addAll = $("lib-add-all");

// Inventory import/export controls.
const $invExportFile = $("inv-export-file");
const $invCopy       = $("inv-copy");
const $invImportFile = $("inv-import-file");
const $invFileInput  = $("inv-file-input");
const $invPick       = $("inv-pick-file");
const $invPastePanel = $("inv-paste-panel");
const $invPasteArea  = $("inv-paste-area");
const $invPasteApply = $("inv-paste-apply");
const $invPasteCancel= $("inv-paste-cancel");
const $invStatus     = $("inv-status");

let onChangeCb = null;
// The set of cards currently shown by the active filter, so "Add all in
// view" and the live re-render after a queue change stay in sync.
let inView = [];
// The card whose printed stepper is open (one at a time), by cardId.
let openPrintedId = null;

export function initLibrary({ onChange }) {
  onChangeCb = onChange;
  $search.addEventListener("input", renderGrid);
  $cat.addEventListener("change", renderGrid);
  $addAll.addEventListener("click", addAllInView);

  // "More" menu: a <details> that closes on acting on an item, on Escape and
  // on a tap outside it.
  const $more = $("lib-more");
  $more.querySelector(".lib-more-panel").addEventListener("click", (e) => {
    if (e.target.closest("button")) $more.open = false;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !$more.open) return;
    $more.open = false;
    $more.querySelector("summary").focus();
  });
  document.addEventListener("pointerdown", (e) => {
    if ($more.open && !$more.contains(e.target)) $more.open = false;
  });

  $invExportFile.addEventListener("click", exportToFile);
  $invCopy.addEventListener("click", copyToClipboard);
  // Import opens one panel offering a file or pasted text.
  $invImportFile.addEventListener("click", () => togglePastePanel(true));
  $invPick.addEventListener("click", () => $invFileInput.click());
  $invFileInput.addEventListener("change", importFromFile);
  $invPasteCancel.addEventListener("click", () => togglePastePanel(false));
  $invPasteApply.addEventListener("click", applyPaste);
}

/** Called when the bundle has loaded so we can populate the category select
 *  (again when the language changed, keeping the chosen category). */
let catLang = null;
export function renderLibrary() {
  if ($cat.options.length <= 1 || catLang !== lang()) {
    catLang = lang();
    const chosen = $cat.value;
    $cat.querySelectorAll("optgroup").forEach(og => og.remove());
    for (const g of state.bundle.groups) {
      const og = document.createElement("optgroup");
      og.label = categoryTitle("group", g.title, g.title, lang());
      for (const it of g.items) {
        const opt = document.createElement("option");
        opt.value = it.key;
        opt.textContent = categoryTitle("cat", it.key, it.title, lang());
        og.appendChild(opt);
      }
      $cat.appendChild(og);
    }
    $cat.value = chosen;
  }
  renderGrid();
}

// Fields to show as the tile's preview, best (most descriptive) first.
const PREVIEW_FIELDS = [
  "effect", "special", "special_rules", "objectives",
  "armaments", "restrictions", "flavor",
];

/** Full-text description of a card for the library tile, in the
 *  currently-selected card language (falls back to English per field). */
function previewText(row) {
  for (const f of PREVIEW_FIELDS) {
    const v = pickField(row, f, state.lang);
    if (typeof v === "string" && v.trim()) {
      // Whole text, never cut; blank-line paragraph breaks survive.
      return v.split(/\n\s*\n/).map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
    }
  }
  return "";
}

/** Card name in the selected card language (English fallback). */
function displayName(row) {
  return pickField(row, "name", state.lang) || row.name || L("unnamed");
}

/** How many copies of (key, name) are already in the print queue. */
function queuedCount(key, name) {
  let n = 0;
  for (const q of state.queue) {
    if (q.key === key && (q.row?.name || "") === (name || "")) n++;
  }
  return n;
}

function addToQueue(key, row) {
  state.queue.push({ key, row, override: null });
}

/** Remove one queued copy of (key, name): the latest, matched as queuedCount does. */
function removeFromQueue(key, row) {
  for (let i = state.queue.length - 1; i >= 0; i--) {
    const q = state.queue[i];
    if (q.key === key && (q.row?.name || "") === (row.name || "")) { state.queue.splice(i, 1); return; }
  }
}

function renderGrid() {
  // Keep keyboard focus on the same control across the rebuild below.
  const fid = document.activeElement?.closest?.("#lib-grid") ? document.activeElement.dataset.fid : null;
  const q = $search.value.trim().toLowerCase();
  const catFilter = $cat.value;
  $grid.innerHTML = "";
  inView = [];
  for (const [key, cat] of Object.entries(state.bundle.categories)) {
    if (catFilter && key !== catFilter) continue;
    for (const row of (cat.rows || [])) {
      const n = ((row.name || "") + " " + (row.name_es || "")).toLowerCase();
      if (q && !n.includes(q)) continue;
      inView.push({ key, row });
      $grid.appendChild(buildTile(key, cat, row));
    }
  }

  const queuedInView = inView.reduce((s, it) => s + (queuedCount(it.key, it.row.name) ? 1 : 0), 0);
  $count.textContent = plural("libCount", inView.length, lang()) +
    (queuedInView ? ` · ${plural("libInQueue", queuedInView, lang())}` : "");
  $addAll.disabled = inView.length === 0;
  $addAll.innerHTML = `${icon("plus")} ${escapeHtml(plural("libAddAll", inView.length, lang()))}`;
  if (fid) {
    const find = (f) => [...$grid.querySelectorAll("[data-fid]")].find(el => el.dataset.fid === f);
    // The - button vanishes at 0 queued; focus moves to that card's + Add.
    (find(fid) || find(fid.replace(/:qdec$/, ":add")))?.focus();
  }
}

function buildTile(key, cat, row) {
  const queued  = queuedCount(key, row.name);
  const printed = printedCount(key, row.name);
  const need    = Math.max(0, queued - printed);
  const preview = previewText(row);
  const id      = cardId(key, row.name);
  const open    = openPrintedId === id;

  const t = document.createElement("div");
  t.className = "lib-tile" + (printed ? " has-printed" : "");
  t.innerHTML = `
    <div class="tile-head">
      <span class="cat">${escapeHtml(catName(key, cat))}</span>
      ${queued ? `<span class="queue-ctl" title="${escapeHtml(plural("libQueued", queued, lang()))}">
        <button type="button" class="qdec" data-fid="${escapeHtml(id)}:qdec" aria-label="${escapeHtml(plural("libQueueLess", 1, lang(), { name: displayName(row) }))}">−</button>
        <span class="in-queue queue-n" aria-live="polite">${queued}</span>
        <button type="button" class="add qinc" data-fid="${escapeHtml(id)}:add" aria-label="${escapeHtml(plural("libQueueMore", 1, lang(), { name: displayName(row) }))}">+</button>
      </span>`
      : `<button type="button" class="add" data-fid="${escapeHtml(id)}:add">${escapeHtml(L("libAdd"))}</button>`}
    </div>
    <span class="name">${escapeHtml(displayName(row))}</span>
    ${preview ? `<span class="preview">${escapeHtml(preview)}</span>` : ""}
    <div class="tile-foot">
      <button type="button" class="printed-toggle" data-fid="${escapeHtml(id)}:toggle" aria-expanded="${open}"
        title="${escapeHtml(L("libPrintedTitle"))}">${escapeHtml(plural("libPrintedN", printed, lang()))}</button>
      <span class="printed-ctl" ${open ? "" : "hidden"} title="${escapeHtml(L("libPrintedTitle"))}">
        <button type="button" class="dec" data-fid="${escapeHtml(id)}:dec" aria-label="${escapeHtml(L("libPrintedLess"))}">−</button>
        <span class="printed-n">${printed}</span>
        <button type="button" class="inc" data-fid="${escapeHtml(id)}:inc" aria-label="${escapeHtml(L("libPrintedMore"))}">+</button>
      </span>
      ${queued
        ? (need > 0
            ? `<span class="need">${escapeHtml(plural("libNeed", need, lang()))}</span>`
            : `<span class="need done">${icon("check")} ${escapeHtml(plural("libAllPrinted", queued, lang()))}</span>`)
        : ""}
    </div>`;

  // Whole tile adds to the queue (the "+ Add" button just bubbles up to it, so
  // a tap or Enter adds once); the printed controls must not bubble up.
  t.addEventListener("click", () => {
    addToQueue(key, row);
    saveQueue();
    renderGrid();
    onChangeCb?.();
  });
  t.querySelector(".qdec")?.addEventListener("click", (e) => {
    e.stopPropagation();
    removeFromQueue(key, row);
    saveQueue();
    renderGrid();
    onChangeCb?.();
  });
  const stepper = t.querySelector(".printed-ctl");
  stepper.addEventListener("click", (e) => e.stopPropagation());
  t.querySelector(".printed-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    openPrintedId = openPrintedId === id ? null : id;
    renderGrid();
  });
  stepper.querySelector(".dec").addEventListener("click", () => bumpPrinted(key, row.name, -1));
  stepper.querySelector(".inc").addEventListener("click", () => bumpPrinted(key, row.name, +1));

  return t;
}

function bumpPrinted(key, name, delta) {
  addPrinted(key, name, delta);
  renderGrid();
  onChangeCb?.();   // print preview / "need" counts may change
}

/** Queue every card the current filter is showing. */
function addAllInView() {
  if (!inView.length) return;
  for (const { key, row } of inView) addToQueue(key, row);
  saveQueue();
  renderGrid();
  onChangeCb?.();
}

/* ---- inventory import / export ------------------------------------------ */

function inventoryObject() {
  const printed = Object.entries(state.printed)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => {
      const sp = id.indexOf(" ");
      return { key: id.slice(0, sp), name: id.slice(sp + 1), printed: n };
    })
    .sort((a, b) => (a.key + a.name).localeCompare(b.key + b.name));
  return { app: "necropolis-card-printer", kind: "printed-inventory", version: 1, printed };
}

function inventoryJSON() {
  return JSON.stringify(inventoryObject(), null, 2);
}

function status(msg, ok = true) {
  $invStatus.textContent = msg;
  $invStatus.classList.toggle("err", !ok);
}

function exportToFile() {
  const blob = new Blob([inventoryJSON()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "necropolis-printed-inventory.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const count = inventoryObject().printed.length;
  status(plural("invExported", count, lang()));
}

async function copyToClipboard() {
  const text = inventoryJSON();
  try {
    await navigator.clipboard.writeText(text);
    status(L("invCopied"));
  } catch {
    // Clipboard API blocked (e.g. non-secure context) — fall back to paste box.
    togglePastePanel(true);
    $invPasteArea.value = text;
    $invPasteArea.select();
    status(L("invClipBlocked"), false);
  }
}

function importFromFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { applyImportText(String(reader.result)); togglePastePanel(false); };
  reader.onerror = () => status(L("invReadFailed"), false);
  reader.readAsText(file);
  e.target.value = "";  // allow re-importing the same file
}

function togglePastePanel(show) {
  $invPastePanel.hidden = !show;
  if (show) { $invPasteArea.focus(); }
  else { $invPasteArea.value = ""; }
}

function applyPaste() {
  applyImportText($invPasteArea.value);
  togglePastePanel(false);
}

/** Parse and apply an exported inventory, replacing the current one. Accepts
 * our {printed:[{key,name,printed}]} shape, a bare array of those, or a raw
 * { "<key> <name>": n } map. */
function applyImportText(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { status(L("invBadJson"), false); return; }

  let entries;
  if (Array.isArray(data)) entries = data;
  else if (data && Array.isArray(data.printed)) entries = data.printed;
  else if (data && typeof data === "object") {
    entries = Object.entries(data).map(([id, n]) => {
      const sp = String(id).indexOf(" ");
      return sp < 0 ? null : { key: id.slice(0, sp), name: id.slice(sp + 1), printed: n };
    }).filter(Boolean);
  } else { status(L("invBadFormat"), false); return; }

  const next = {};
  let count = 0;
  for (const e of entries) {
    if (!e || !e.key || !e.name) continue;
    const n = Math.max(0, Math.floor(Number(e.printed) || 0));
    if (n > 0) { next[cardId(e.key, e.name)] = n; count++; }
  }
  state.printed = next;
  savePrinted();
  renderGrid();
  onChangeCb?.();
  status(plural("invImported", count, lang()));
}

/* The filter bar sticks under the (sticky) header: its offset and height are
 * published as CSS variables, so tiles keep focus clear of it (scroll-margin). */
if (typeof ResizeObserver !== "undefined") {
  const header = document.querySelector("header.app");
  // Wide: the toolbar sticks; phone: only the filter row (see design-v5.css).
  const bars = [document.querySelector(".lib-toolbar"), document.querySelector(".lib-filter")].filter(Boolean);
  const root = document.documentElement.style;
  const measure = () => {
    const stuck = header && getComputedStyle(header).position === "sticky";
    root.setProperty("--nc-header-h", stuck ? `${header.offsetHeight}px` : "0px");
    const bar = bars.find(b => getComputedStyle(b).position === "sticky" && b.offsetHeight);
    if (bar) root.setProperty("--lib-filter-h", `${bar.offsetHeight}px`);
  };
  const ro = new ResizeObserver(measure);
  if (header) ro.observe(header);
  bars.forEach(b => ro.observe(b));
  measure();
}
