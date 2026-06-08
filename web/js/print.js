/**
 * Print tab — queue manager + A4 sheet preview.
 *
 * The same .sheet markup is used on-screen and in the print dialog;
 * print CSS in styles.css hides the UI chrome and the sheet's
 * page-break-after handles multi-page output cleanly.
 */

import { state, saveQueue, printedCount, addPrinted, cardId } from "./state.js";
import { $, escapeHtml } from "./util.js";
import { renderCardSvg } from "./templates.js";

const $queueList   = $("queue-list");
const $sheetsWrap  = $("sheets-wrap");
const $sheetCount  = $("sheet-count");
const $bleed       = $("bleed-toggle");
const $backs       = $("backs-toggle");
const $needToggle  = $("need-toggle");
const $markPrinted = $("mark-printed-btn");
const $clearBtn    = $("clear-queue-btn-2");

const CARDS_PER_SHEET = 9;

let onChangeCb = null;

export function initPrint({ onChange } = {}) {
  onChangeCb = onChange;
  $bleed.addEventListener("change", renderPrint);
  $backs.addEventListener("change", renderPrint);
  $needToggle.addEventListener("change", renderPrint);
  $markPrinted.addEventListener("click", markRunPrinted);
  $clearBtn.addEventListener("click", () => {
    if (!state.queue.length) return;
    if (!confirm(`Clear all ${state.queue.length} card${state.queue.length === 1 ? "" : "s"} from the queue?`)) return;
    state.queue = [];
    saveQueue();
    renderPrint();
    if (onChangeCb) onChangeCb();
  });
}

/* The cards that will actually print. With "only what I still need" off this
 * is the whole queue; on, it drops the first `printed` copies of each card
 * identity, leaving max(0, queued − printed) — i.e. just the shortfall. */
export function printList() {
  if (!$needToggle.checked) return state.queue.slice();
  const seen = Object.create(null);
  const out = [];
  for (const q of state.queue) {
    const id = cardId(q.key, q.row?.name);
    const nth = (seen[id] = (seen[id] || 0) + 1);
    if (nth > printedCount(q.key, q.row?.name)) out.push(q);
  }
  return out;
}

/* Add this run's cards to the printed inventory, so next time the same
 * cards count as "already printed". Works in both modes: it bumps printed by
 * exactly what this run lays out. */
function markRunPrinted() {
  const list = printList();
  if (!list.length) return;
  const counts = Object.create(null);
  for (const q of list) counts[cardId(q.key, q.row?.name)] = (counts[cardId(q.key, q.row?.name)] || 0) + 1;
  // Apply per identity once.
  const applied = new Set();
  for (const q of list) {
    const id = cardId(q.key, q.row?.name);
    if (applied.has(id)) continue;
    applied.add(id);
    addPrinted(q.key, q.row?.name, counts[id]);
  }
  renderPrint();
  if (onChangeCb) onChangeCb();
}

export function renderPrint() {
  renderQueue();
  renderSheets();
}

function renderQueue() {
  $queueList.innerHTML = "";
  if (!state.queue.length) {
    const empty = document.createElement("div");
    empty.className = "empty-msg";
    empty.style.padding = "20px";
    empty.style.border = "none";
    empty.textContent = "Queue is empty. Use Import or Library to add cards.";
    $queueList.appendChild(empty);
    return;
  }
  state.queue.forEach((q, i) => {
    const cat = state.bundle.categories[q.key];
    const ov = q.override || {};
    const label = ov.header || ov.name || q.row.name || "(unnamed)";
    const expanded = state.expanded === i;

    const wrap = document.createElement("div");
    wrap.className = "queue-item-wrap";

    const item = document.createElement("div");
    item.className = "queue-item";
    item.innerHTML = `
      <span class="cat">${escapeHtml(cat ? cat.title : q.key)}</span>
      <span class="name" contenteditable="true" spellcheck="false" title="Click to rename">${escapeHtml(label)}</span>
      <button title="Edit fields" class="edit-btn">${expanded ? "▴" : "▾"}</button>
      <button title="Move up">↑</button>
      <button title="Move down">↓</button>
      <button title="Remove">✕</button>`;
    const nameSpan = item.querySelector(".name");
    const edBtn = item.querySelector(".edit-btn");
    const [, up, dn, rm] = item.querySelectorAll("button");
    up.addEventListener("click", () => move(i, -1));
    dn.addEventListener("click", () => move(i,  1));
    rm.addEventListener("click", () => remove(i));
    edBtn.addEventListener("click", () => {
      state.expanded = expanded ? null : i;
      renderQueue();
    });
    nameSpan.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); nameSpan.blur(); }
      else if (e.key === "Escape") { e.preventDefault(); nameSpan.textContent = label; nameSpan.blur(); }
    });
    nameSpan.addEventListener("blur", () => commitName(i, nameSpan.textContent.trim(), label));
    wrap.appendChild(item);

    if (expanded) wrap.appendChild(renderEditPanel(i));
    $queueList.appendChild(wrap);
  });
}

/* Persist an inline-edited name back to the queue item. For profile cards
 * (leader/minion/sellsword) the banner header is the modelName, stored in
 * `override.header`; everywhere else the banner is the card name, served
 * by the `{{NAME}}` substitution from `override.name`. */
const PROFILE_TEMPLATES = new Set(["leader", "minion", "sellsword"]);

/* Render the per-card edit form for queue item `i`. Every {{KEY}}
 * placeholder in the card's template (plus every BODY_BLOCK key) gets a
 * field. Initial value comes from override > row. Edits write to
 * q.override[key.toLowerCase()] and trigger a re-render. */
const LONG_FIELDS = new Set(["special_rules","effect","flavor","body","armaments","special"]);

function templateFields(stem) {
  const tpl = state.templates[stem] || "";
  const found = new Set();
  for (const m of tpl.matchAll(/\{\{(\w+)\}\}/g))                 found.add(m[1].toLowerCase());
  for (const m of tpl.matchAll(/BODY_BLOCK:\s*(\w+)/g))           found.add(m[1].toLowerCase());
  // Skip purely structural keys handled elsewhere.
  for (const k of ["sigil"]) found.delete(k);
  return [...found];
}

function renderEditPanel(i) {
  const q   = state.queue[i];
  const cat = state.bundle.categories[q.key];
  const stem = cat?.template || "";
  const fields = templateFields(stem);
  const panel = document.createElement("div");
  panel.className = "queue-edit";

  for (const key of fields) {
    const row = document.createElement("div");
    row.className = "queue-edit-row";
    const labelTxt = key.replace(/_/g, " ");
    const value = (q.override && q.override[key] != null)
      ? q.override[key]
      : (q.row[key] ?? "");
    const isLong = LONG_FIELDS.has(key);
    row.innerHTML = `
      <label>${escapeHtml(labelTxt)}</label>
      ${isLong
        ? `<textarea rows="3" data-key="${key}">${escapeHtml(String(value))}</textarea>`
        : `<input type="text" data-key="${key}" value="${escapeHtml(String(value))}">`}`;
    const input = row.querySelector("[data-key]");
    input.addEventListener("input", () => commitField(i, key, input.value));
    panel.appendChild(row);
  }
  // For profile cards, also expose `header` (modelName/banner override) —
  // it's not a {{KEY}} in the template; the renderer swaps it in via a
  // regex on `class="banner-title"`.
  if (PROFILE_TEMPLATES.has(stem)) {
    const headerVal = (q.override && q.override.header) || "";
    const row = document.createElement("div");
    row.className = "queue-edit-row";
    row.innerHTML = `
      <label>banner</label>
      <input type="text" data-key="header" placeholder="(uses default banner)" value="${escapeHtml(headerVal)}">`;
    const input = row.querySelector("[data-key]");
    input.addEventListener("input", () => commitField(i, "header", input.value));
    panel.insertBefore(row, panel.firstChild);
  }
  return panel;
}

function commitField(i, key, value) {
  const q = state.queue[i];
  q.override = q.override || {};
  // Empty string → clear the override so the row's default kicks back in.
  if (value === "" || value == null) delete q.override[key];
  else                                q.override[key] = value;
  saveQueue();
  // Re-render only the print preview; keep the queue list intact so the
  // user's caret position in the field they're typing doesn't jump.
  renderSheets();
  // Also update the queue-item name label live if the relevant field changed.
  if (key === "header" || key === "name") renderQueueLabel(i);
}

function renderQueueLabel(i) {
  const wraps = $queueList.querySelectorAll(".queue-item-wrap");
  const wrap = wraps[i];
  if (!wrap) return;
  const q = state.queue[i];
  const ov = q.override || {};
  const label = ov.header || ov.name || q.row.name || "(unnamed)";
  const nameSpan = wrap.querySelector(".queue-item .name");
  if (nameSpan && nameSpan !== document.activeElement) nameSpan.textContent = label;
}

function commitName(i, next, prev) {
  if (next === prev || !next) {
    renderPrint();
    return;
  }
  const q = state.queue[i];
  const cat = state.bundle.categories[q.key];
  q.override = q.override || {};
  if (cat && PROFILE_TEMPLATES.has(cat.template)) q.override.header = next;
  else q.override.name = next;
  saveQueue();
  renderPrint();
}

function move(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= state.queue.length) return;
  [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
  saveQueue();
  renderPrint();
}

function remove(i) {
  state.queue.splice(i, 1);
  saveQueue();
  renderPrint();
}

function renderSheets() {
  $sheetsWrap.innerHTML = "";
  const cutGap = $bleed.checked;          // checkbox now toggles the cut gap
  const withBacks = $backs.checked;
  const list = printList();
  const needMode = $needToggle.checked;
  $markPrinted.disabled = list.length === 0;

  if (!list.length) {
    $sheetCount.textContent = "0 sheets";
    const e = document.createElement("div");
    e.className = "empty-msg";
    e.textContent = !state.queue.length
      ? "Print preview will appear here once you queue cards."
      : "Nothing left to print — every queued card is already in your printed inventory.";
    $sheetsWrap.appendChild(e);
    return;
  }
  const fronts  = Math.ceil(list.length / CARDS_PER_SHEET);
  const totals  = withBacks ? fronts * 2 : fronts;
  $sheetCount.textContent =
    `${totals} sheet${totals === 1 ? "" : "s"} · ${list.length} card${list.length === 1 ? "" : "s"}`
    + (needMode ? ` still needed (of ${state.queue.length} queued)` : "")
    + (withBacks ? " (fronts + backs)" : "");

  for (let s = 0; s < fronts; s++) {
    // Fronts sheet — 9 cards from the effective print list.
    const sheet = document.createElement("div");
    sheet.className = "sheet" + (cutGap ? " cut-gap" : "");
    const num = document.createElement("div");
    num.className = "sheet-num";
    num.textContent = `${withBacks ? s * 2 + 1 : s + 1}/${totals}`;
    sheet.appendChild(num);
    for (let i = 0; i < CARDS_PER_SHEET; i++) {
      const idx = s * CARDS_PER_SHEET + i;
      const q = list[idx];
      const card = document.createElement("div");
      card.className = "card" + (q ? "" : " empty");
      if (q) card.innerHTML = renderCardSvg(q);
      sheet.appendChild(card);
    }
    $sheetsWrap.appendChild(sheet);

    if (!withBacks) continue;

    // Backs sheet — 9 identical card backs in the same 3×3 grid so
    // duplex printing pairs each card with its back. Empty slots are
    // also stamped with a back, since cutting still needs guides.
    const back = document.createElement("div");
    back.className = "sheet" + (cutGap ? " cut-gap" : "");
    const bnum = document.createElement("div");
    bnum.className = "sheet-num";
    bnum.textContent = `${s * 2 + 2}/${totals}`;
    back.appendChild(bnum);
    const backTpl = state.templates["back"];
    const backHtml = backTpl ? backTpl.replace(/<svg\b([^>]*)>/,
      (m, attrs) => `<svg${attrs
        .replace(/\swidth="[^"]*"/g, "")
        .replace(/\sheight="[^"]*"/g, "")} width="100%" height="100%">`)
      : "";
    for (let i = 0; i < CARDS_PER_SHEET; i++) {
      const idx = s * CARDS_PER_SHEET + i;
      const filled = idx < list.length;
      const card = document.createElement("div");
      card.className = "card" + (filled ? "" : " empty");
      if (filled && backHtml) card.innerHTML = backHtml;
      back.appendChild(card);
    }
    $sheetsWrap.appendChild(back);
  }
}
