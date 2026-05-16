/**
 * Bundle loader.
 *
 * Fetches `data.json` (built by web/bundle.py) and every template SVG it
 * references, then builds a name-keyed lookup index used by the importer
 * and the library view. Everything is loaded once at startup.
 */

import { state } from "./state.js";
import { normName } from "./matching.js";

export async function loadBundle() {
  const r = await fetch("data.json", { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to load data.json: " + r.status);
  state.bundle = await r.json();
  // Prefetch every template once so renderCardSvg is synchronous.
  for (const [stem, path] of Object.entries(state.bundle.templates)) {
    const tr = await fetch(path, { cache: "no-store" });
    state.templates[stem] = await tr.text();
  }
  buildIndex();
}

function buildIndex() {
  const idx = {};
  for (const [key, cat] of Object.entries(state.bundle.categories)) {
    for (const row of (cat.rows || [])) {
      const n = normName(row.name);
      if (!n) continue;
      (idx[n] ||= []).push({ key, row });
    }
  }
  state.index = idx;
}
