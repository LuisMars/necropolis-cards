/**
 * Library tab — filterable list of every card in the bundle.
 * Click a tile to append to the print queue.
 */

import { state, saveQueue } from "./state.js";
import { $, escapeHtml } from "./util.js";

const $search = $("lib-search");
const $cat    = $("lib-category");
const $grid   = $("lib-grid");
const $count  = $("lib-count");

let onChangeCb = null;

export function initLibrary({ onChange }) {
  onChangeCb = onChange;
  $search.addEventListener("input", renderGrid);
  $cat.addEventListener("change", renderGrid);
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

function renderGrid() {
  const q = $search.value.trim().toLowerCase();
  const catFilter = $cat.value;
  $grid.innerHTML = "";
  let count = 0;
  for (const [key, cat] of Object.entries(state.bundle.categories)) {
    if (catFilter && key !== catFilter) continue;
    for (const row of (cat.rows || [])) {
      const n = (row.name || "").toLowerCase();
      if (q && !n.includes(q)) continue;
      count++;
      const t = document.createElement("div");
      t.className = "lib-tile";
      t.innerHTML = `
        <span class="cat">${escapeHtml(cat.title)}</span>
        <span class="name">${escapeHtml(row.name || "(unnamed)")}</span>
        <span class="add">+ Add</span>`;
      t.addEventListener("click", () => {
        state.queue.push({ key, row, override: null });
        saveQueue();
        if (onChangeCb) onChangeCb();
      });
      $grid.appendChild(t);
    }
  }
  $count.textContent = `${count} item${count === 1 ? "" : "s"}`;
}
