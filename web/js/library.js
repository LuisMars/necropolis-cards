/**
 * Library tab — filterable list of every card in the bundle.
 *
 * Each tile can be added to the print queue, shows a 2-line text preview,
 * how many copies are queued, and a "printed" stepper that records how many
 * you've already printed (the inventory used by the Print tab's
 * "only what I still need" mode). The inventory can be exported/imported as
 * JSON (file download/upload or copy/paste).
 */

import {
  state, saveQueue,
  printedCount, addPrinted, cardId, savePrinted,
} from "./state.js";
import { $, escapeHtml } from "./util.js";
import { pickField } from "./i18n.js";

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
const $invPasteTog   = $("inv-paste-toggle");
const $invPastePanel = $("inv-paste-panel");
const $invPasteArea  = $("inv-paste-area");
const $invPasteApply = $("inv-paste-apply");
const $invPasteCancel= $("inv-paste-cancel");
const $invStatus     = $("inv-status");

let onChangeCb = null;
// The set of cards currently shown by the active filter, so "Add all in
// view" and the live re-render after a queue change stay in sync.
let inView = [];

export function initLibrary({ onChange }) {
  onChangeCb = onChange;
  $search.addEventListener("input", renderGrid);
  $cat.addEventListener("change", renderGrid);
  $addAll.addEventListener("click", addAllInView);

  $invExportFile.addEventListener("click", exportToFile);
  $invCopy.addEventListener("click", copyToClipboard);
  $invImportFile.addEventListener("click", () => $invFileInput.click());
  $invFileInput.addEventListener("change", importFromFile);
  $invPasteTog.addEventListener("click", () => togglePastePanel(true));
  $invPasteCancel.addEventListener("click", () => togglePastePanel(false));
  $invPasteApply.addEventListener("click", applyPaste);
}

/** Called when the bundle has loaded so we can populate the category select. */
export function renderLibrary() {
  if ($cat.options.length <= 1) {
    for (const g of state.bundle.groups) {
      const og = document.createElement("optgroup");
      og.label = g.title;
      for (const it of g.items) {
        const opt = document.createElement("option");
        opt.value = it.key;
        opt.textContent = it.title;
        og.appendChild(opt);
      }
      $cat.appendChild(og);
    }
  }
  renderGrid();
}

// Fields to show as the tile's preview, best (most descriptive) first.
const PREVIEW_FIELDS = [
  "effect", "special", "special_rules", "objectives",
  "armaments", "restrictions", "flavor",
];

/** Short single-line description of a card for the library tile, in the
 *  currently-selected card language (falls back to English per field). */
function previewText(row) {
  for (const f of PREVIEW_FIELDS) {
    const v = pickField(row, f, state.lang);
    if (typeof v === "string" && v.trim()) {
      return v.replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

/** Card name in the selected card language (English fallback). */
function displayName(row) {
  return pickField(row, "name", state.lang) || row.name || "(unnamed)";
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

function renderGrid() {
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
  $count.textContent =
    `${inView.length} item${inView.length === 1 ? "" : "s"}` +
    (queuedInView ? ` · ${queuedInView} in queue` : "");
  $addAll.disabled = inView.length === 0;
  $addAll.textContent = `+ Add all in view (${inView.length})`;
}

function buildTile(key, cat, row) {
  const queued  = queuedCount(key, row.name);
  const printed = printedCount(key, row.name);
  const need    = Math.max(0, queued - printed);
  const preview = previewText(row);

  const t = document.createElement("div");
  t.className = "lib-tile" + (printed ? " has-printed" : "");
  t.innerHTML = `
    <div class="tile-head">
      <span class="cat">${escapeHtml(cat.title)}</span>
      ${queued ? `<span class="in-queue">${queued} queued</span>` : ""}
      <span class="add">+ Add</span>
    </div>
    <span class="name">${escapeHtml(displayName(row))}</span>
    ${preview ? `<span class="preview">${escapeHtml(preview)}</span>` : ""}
    <div class="tile-foot">
      <span class="printed-ctl" title="How many you've already printed">
        <button type="button" class="dec" aria-label="One fewer printed">−</button>
        <span class="printed-n">${printed}</span>
        <button type="button" class="inc" aria-label="One more printed">+</button>
        <span class="printed-lbl">printed</span>
      </span>
      ${queued
        ? (need > 0
            ? `<span class="need">need ${need}</span>`
            : `<span class="need done">✓ all printed</span>`)
        : ""}
    </div>`;

  // Whole tile adds to the queue; the stepper buttons must not bubble up.
  t.addEventListener("click", () => {
    addToQueue(key, row);
    saveQueue();
    renderGrid();
    onChangeCb?.();
  });
  const stepper = t.querySelector(".printed-ctl");
  stepper.addEventListener("click", (e) => e.stopPropagation());
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
  status(`Exported ${count} card${count === 1 ? "" : "s"}.`);
}

async function copyToClipboard() {
  const text = inventoryJSON();
  try {
    await navigator.clipboard.writeText(text);
    status("Copied inventory JSON to clipboard.");
  } catch {
    // Clipboard API blocked (e.g. non-secure context) — fall back to paste box.
    togglePastePanel(true);
    $invPasteArea.value = text;
    $invPasteArea.select();
    status("Clipboard blocked — JSON shown below; copy it manually.", false);
  }
}

function importFromFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => applyImportText(String(reader.result));
  reader.onerror = () => status("Could not read file.", false);
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
  catch { status("Invalid JSON — nothing imported.", false); return; }

  let entries;
  if (Array.isArray(data)) entries = data;
  else if (data && Array.isArray(data.printed)) entries = data.printed;
  else if (data && typeof data === "object") {
    entries = Object.entries(data).map(([id, n]) => {
      const sp = String(id).indexOf(" ");
      return sp < 0 ? null : { key: id.slice(0, sp), name: id.slice(sp + 1), printed: n };
    }).filter(Boolean);
  } else { status("Unrecognised format — nothing imported.", false); return; }

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
  status(`Imported ${count} card${count === 1 ? "" : "s"}.`);
}
