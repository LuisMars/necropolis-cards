/**
 * Bundle loader.
 *
 * Fetches `data.json` (built by web/bundle.py) and every template SVG it
 * references, then builds a name-keyed lookup index used by the importer
 * and the library view. Everything is loaded once at startup.
 */

import { state } from "./state.js";
import { normName } from "./matching.js";
import { buildCatalog } from "./builder/catalog.js";

/**
 * Card SVGs are drawn inline, and an inline <style> applies to the whole
 * document, so one template's `.label` rule would restyle every other card on
 * the page. Prefix each rule with the template's own class, put that class on
 * the card's root, and a card looks the same alone or among others.
 * (build.py renders each card by itself through Inkscape and is not affected.)
 */
export function scopeTemplateCss(stem, svg) {
  const cls = "tpl-" + stem.replace(/[^\w-]/g, "-");
  svg = svg.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g, (m, open, css, close) =>
    open + css.replace(/([^{}]+)\{/g, (mm, sel) =>
      sel.split(",").map(x => ` svg.${cls} ${x.trim()}`).join(",") + " {") + close);
  return svg.replace(/<svg\b([^>]*)>/, (m, attrs) =>
    /\sclass="/.test(attrs) ? `<svg${attrs.replace(/\sclass="/, ` class="${cls} `)}>` : `<svg${attrs} class="${cls}">`);
}

export async function loadBundle() {
  const r = await fetch("data.json", { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to load data.json: " + r.status);
  state.bundle = await r.json();
  // Prefetch every template once so renderCardSvg is synchronous.
  for (const [stem, path] of Object.entries(state.bundle.templates)) {
    const tr = await fetch(path, { cache: "no-store" });
    state.templates[stem] = scopeTemplateCss(stem, await tr.text());
  }
  buildIndex();
  state.catalog = buildCatalog(state.bundle);
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
