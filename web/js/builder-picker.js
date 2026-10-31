/**
 * Builder: the "+ Add …" picker and the campaign's "remove an item" choice.
 *
 * One shared modal <dialog> (showModal: the browser traps focus, Escape
 * closes it) lists what a model can add to one of its lists: a search field
 * (accent- and case-blind, over name, kind and rules text), filter chips by
 * kind where the list has them, and the rows, grouped as on the cards. Each
 * row shows its cost, a short summary from the card row and, if adding it
 * would break a rule, why (the Builder warns, it never blocks).
 *
 * In a campaign the list opens with "From the stash (free)" before "Buy at
 * the Markets". Adding keeps the dialog open ("Added Blade") so several
 * items go in one go; Done closes it and focus goes back to the button that
 * opened it.
 *
 * This module holds no gathering state. builder-tab.js hands it hooks that
 * read the working copy and make each change through its own `edit()`.
 */

import { icon } from "./lucide.js";
import { state } from "./state.js";
import { escapeHtml, foldText as norm } from "./util.js";
import { pickField } from "./i18n.js";
import { slug, TRAIT_CATEGORIES, WEAPON_CATEGORIES } from "./builder/catalog.js";
import { campaignStarted } from "./builder/rules.js";
import { buyPrice, sellValue } from "./builder/campaign.js";
import { label, itemName } from "./builder/messages.js";

const esc = escapeHtml;
const lang = () => state.lang || "en";
const L = (k) => label(k, lang());
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const catalog = () => state.catalog;
const improvised = (key) => /improvised-weapon$/.test(key);

/** Category headings, as on the cards. */
const CAT_TITLE = {
  "basic-leader-traits":      ["Basic leader traits", "Rasgos básicos de líder"],
  "covenant-leader-traits":   ["Covenant leader traits", "Rasgos de líder de pacto"],
  "covenant-wretched-traits": ["Covenant traits", "Rasgos de pacto"],
  "wretched-undead-traits":   ["Wretched Undead traits", "Rasgos de No Muertos Miserables"],
  "melee-weapons":            ["Melee", "Cuerpo a cuerpo"],
  "ranged-weapons":           ["Ranged", "A distancia"],
  "thrown-weapons":           ["Thrown", "Arrojadizas"],
  "colossal-weapons":         ["Colossal", "Colosales"],
  "armours":                  ["Armour", "Armaduras"],
  "miscellaneous-equipment":  ["Equipment", "Equipo misceláneo"],
};
const catTitle = (c) => (lang() === "es" ? CAT_TITLE[c]?.[1] : CAT_TITLE[c]?.[0]) || c;
const catRows = (c) => (catalog().bundle.categories[c]?.rows || []).map(r => [`${c}/${slug(r.name)}`, r]);

/** A list's options as groups: [{id, title, rows: [[key, row], …]}]. */
export function addGroups(list, leader) {
  const cats = (cs) => cs.map(c => ({ id: c, title: catTitle(c), rows: catRows(c) }));
  switch (list) {
    case "traits":    return cats(leader ? TRAIT_CATEGORIES : ["covenant-wretched-traits", "wretched-undead-traits"]);
    case "spells": {
      const groups = new Map();
      for (const r of catalog().bundle.categories.spells?.rows || []) {
        const school = pickField(r, "school", lang()) || r.school || "";
        if (!groups.has(school)) groups.set(school, { id: `school-${slug(r.school)}`, title: school, rows: [] });
        groups.get(school).rows.push([`spells/${slug(r.name)}`, r]);
      }
      return [...groups.values()];
    }
    // Thrown weapons are Miscellaneous Equipment (p.41), as import files them.
    case "weapons":   return cats(WEAPON_CATEGORIES.filter(c => c !== "thrown-weapons"));
    case "armour":    return [{ id: "armours", title: null, rows: catRows("armours") }];
    case "equipment": return cats(["miscellaneous-equipment", "thrown-weapons"]);
  }
  return [];
}

/** The few facts a player picks by, from the card row: kept to one line. */
function summary(key, r) {
  const f = (k) => { const v = String(pickField(r, k, lang()) ?? "").trim(); return v === "—" || v === "-" ? "" : v; };
  const cat = key.split("/")[0];
  const bits = [];
  if (cat.endsWith("-weapons")) {
    if (f("attacks")) bits.push(`${L("attacksShort")} ${f("attacks")}`);
    if (f("damage")) bits.push(`${L("damageShort")} ${f("damage").replace(/\s+/g, "")}`);
    if (f("range")) bits.push(`${L("rangeShort")} ${f("range")}"`);
    if (f("hands")) bits.push(`${f("hands")}${L("handsShort")}`);
    return [bits.join(" · "), f("special")];
  }
  if (cat === "armours") return [f("armour") ? `${L("armourShort")} ${f("armour")}` : "", f("effect")];
  if (cat === "spells") {
    if (f("ap")) bits.push(`${L("apShort")} ${f("ap")}`);
    if (f("channel")) bits.push(`${L("channelShort")} ${f("channel")}`);
    return [bits.join(" · "), f("effect")];
  }
  return [f("restrictions"), f("effect")];
}

/* ---- the picker ------------------------------------------------------------ */

let hooks = {};
let dlg = null;           // the <dialog>
let ctx = null;           // { uid, list, fid, chip, query, active, status }
let rows = [];            // what's drawn: [{value, el}]

/**
 * @param {object} h  hooks from builder-tab.js:
 *   working()                → the gathering on screen
 *   reasons(uid, values)     → Map value → why adding it breaks a rule
 *   add(uid, value)          → make the change ("list|key" or "stash|i")
 *   remove(uid, list, i, how) → how: "sell" | "stash" | "discard"
 */
export function initPicker(h) {
  hooks = h;
  const host = document.querySelector('section.tab[data-tab="builder"]') || document.body;
  dlg = document.createElement("dialog");
  dlg.className = "bd-picker";
  dlg.setAttribute("aria-labelledby", "bd-picker-title");
  host.append(dlg);
  dlg.addEventListener("close", () => {
    const back = ctx?.fid;
    ctx = null;
    rows = [];
    dlg.innerHTML = "";
    // The opener was probably redrawn: find it again by its field id.
    if (back) document.querySelector(`[data-fid="${CSS.escape(back)}"]`)?.focus();
  });
  dlg.addEventListener("click", onClick);
  dlg.addEventListener("input", (e) => {
    if (!e.target.matches(".bd-picker-search")) return;
    ctx.query = e.target.value;
    ctx.active = null;
    drawList();
  });
  dlg.addEventListener("keydown", onKey);
  // A click on the backdrop (outside the box) closes it, as Escape does.
  dlg.addEventListener("pointerdown", (e) => { if (e.target === dlg) dlg.close(); });
}

/** Open the picker for one list of one model. `fid`: the opener's data-fid. */
export function openPicker(uid, list, fid) {
  ctx = { uid, list, fid, chip: "", query: "", active: null, status: "", mode: "add" };
  drawShell();
  dlg.showModal();
  dlg.querySelector(".bd-picker-search")?.focus();
}

/** After every Builder redraw: the open picker follows the working copy. */
export function refreshPicker() {
  if (!ctx || !dlg.open) return;
  const g = hooks.working();
  if (!g || !g.models.some(m => m.uid === ctx.uid)) { dlg.close(); return; }
  if (ctx.mode === "add") drawList();
}

/** Campaign: what to do with an item taken off a model. */
export function openRemove(uid, list, i, fid) {
  ctx = { uid, list, i: Number(i), fid, mode: "remove" };
  const g = hooks.working();
  const m = g.models.find(x => x.uid === uid);
  const key = m[list][ctx.i];
  const who = m.name || itemName(catalog(), m.profile, lang());
  const sells = list === "weapons" || list === "armour";
  dlg.className = "bd-picker bd-picker-small";
  dlg.innerHTML = `
    <div class="bd-picker-box">
      <header class="bd-picker-head">
        <h2 id="bd-picker-title">${esc(fill(L("removeTitle"), { item: itemName(catalog(), key, lang()), model: who }))}</h2>
      </header>
      <p class="bd-picker-note">${esc(L(sells ? "removeHint" : "removeHintEquipment"))}</p>
      <div class="bd-picker-choices">
        ${sells ? `<button type="button" class="primary" data-pk="rm" data-how="sell">${esc(fill(L("sellFor"), { n: sellValue(catalog(), key) }))}</button>` : ""}
        <button type="button" class="${sells ? "secondary" : "primary"}" data-pk="rm" data-how="stash">${esc(L("keepInStash"))}</button>
        ${sells ? "" : `<button type="button" class="secondary" data-pk="rm" data-how="discard">${esc(L("discard"))}</button>`}
        <button type="button" class="link" data-pk="close">${esc(L("cancel"))}</button>
      </div>
    </div>`;
  dlg.showModal();
  dlg.querySelector('[data-pk="rm"]')?.focus();
}

function model() {
  return hooks.working()?.models.find(m => m.uid === ctx.uid) || null;
}
const isLeader = (m) => m.profile.startsWith("leaders/");

function drawShell() {
  const m = model();
  const who = m.name || itemName(catalog(), m.profile, lang());
  const groups = addGroups(ctx.list, isLeader(m));
  const chips = groups.length > 1 ? `
      <div class="bd-picker-chips" role="group" aria-label="${esc(L("filterByKind"))}">
        ${[{ id: "", title: L("allKinds") }, ...groups].map(gr =>
          `<button type="button" class="secondary" data-pk="chip" data-chip="${esc(gr.id)}" aria-pressed="${ctx.chip === gr.id}">${esc(gr.title)}</button>`).join("")}
      </div>` : "";
  dlg.className = "bd-picker";
  dlg.innerHTML = `
    <div class="bd-picker-box">
      <header class="bd-picker-head">
        <h2 id="bd-picker-title">${esc(fill(L(`pick_${ctx.list}`), { model: who }))}</h2>
        <button type="button" class="secondary bd-picker-x" data-pk="close" aria-label="${esc(L("close"))}" title="${esc(L("close"))}">${icon("x")}</button>
      </header>
      <div class="bd-picker-searchbox">${icon("search")}<input type="search" class="bd-picker-search" role="combobox" aria-expanded="true" aria-autocomplete="list"
             aria-controls="bd-picker-list" aria-label="${esc(L("pickerSearch"))}" placeholder="${esc(L("pickerSearch"))}"
             autocomplete="off" spellcheck="false"></div>
      ${chips}
      <div class="bd-picker-list" id="bd-picker-list" role="listbox" aria-label="${esc(L(ctx.list))}"></div>
      <footer class="bd-picker-foot">
        <p class="bd-picker-status" role="status" aria-live="polite"></p>
        <button type="button" class="primary" data-pk="close">${esc(L("done"))}</button>
      </footer>
    </div>`;
  drawList();
}

function drawList() {
  const g = hooks.working();
  const m = model();
  if (!g || !m) return;
  const groups = addGroups(ctx.list, isLeader(m));
  const groupOf = new Map(groups.flatMap(gr => gr.rows.map(([k]) => [k, gr])));
  const q = norm(ctx.query);
  const keep = (key, r) => {
    const gr = groupOf.get(key);
    if (ctx.chip && gr?.id !== ctx.chip) return false;
    if (!q) return true;
    const [line, rules] = summary(key, r);
    return norm([pickField(r, "name", lang()), r.name, gr?.title, line, rules].join(" ")).includes(q);
  };
  const campaign = campaignStarted(g);
  // From the stash first (campaign only), then the catalogue.
  const stash = campaign ? (g.gearStash || []).map((e, i) => [e, i])
    .filter(([e]) => e.list === ctx.list && keep(e.key, catalog().row(e.key) || {})) : [];
  const shown = groups.map(gr => ({ ...gr, rows: gr.rows.filter(([k, r]) => keep(k, r)) })).filter(gr => gr.rows.length);
  const values = [...stash.map(([, i]) => `stash|${i}`), ...shown.flatMap(gr => gr.rows.map(([k]) => `${ctx.list}|${k}`))];
  const why = hooks.reasons(ctx.uid, values);

  let n = 0;
  const row = (value, key, cost) => {
    const r = catalog().row(key) || {};
    const [line, rules] = summary(key, r);
    const reason = why.get(value);
    const id = `bd-pk-${n++}`;
    return `<div class="bd-picker-row" role="option" id="${id}" data-pk="add" data-value="${esc(value)}" aria-selected="false"
              ${reason ? `aria-describedby="${id}-why"` : ""}>
        <span class="bd-pk-name">${esc(pickField(r, "name", lang()) || key)}</span>
        <span class="bd-pk-cost">${esc(cost)}</span>
        ${line || rules ? `<span class="bd-pk-sum">${line ? `<b>${esc(line)}</b>` : ""}${line && rules ? " " : ""}${esc(rules)}</span>` : ""}
        ${reason ? `<span class="bd-pk-why" id="${id}-why" data-reason="${esc(reason)}">${icon("triangle-alert")}<span>${esc(reason)}</span></span>` : ""}
      </div>`;
  };
  const price = (key) => {
    const n = campaign ? buyPrice(g, catalog(), key) : Number(catalog().row(key)?.obols) || 0;
    return n ? `${n} ${L("obols")}` : L("free");
  };
  const section = (title, body) => `<div class="bd-picker-sec" role="group" aria-label="${esc(title)}">
      <div class="bd-picker-sec-title" aria-hidden="true">${esc(title)}</div>${body}</div>`;
  const groupHtml = (gr) => {
    const body = gr.rows.map(([k]) => row(`${ctx.list}|${k}`, k, price(k))).join("");
    return gr.title ? `<div class="bd-picker-group" role="group" aria-label="${esc(gr.title)}">
        <div class="bd-picker-group-title" aria-hidden="true">${esc(gr.title)}</div>${body}</div>` : body;
  };
  let html = shown.map(groupHtml).join("");
  if (campaign) {
    html = (stash.length ? section(L("fromStash"), stash.map(([e, i]) => row(`stash|${i}`, e.key, L("free"))).join("")) : "") +
      (shown.length ? section(L("buyAtMarkets"), html) : "");
  }
  const list = dlg.querySelector(".bd-picker-list");
  list.innerHTML = html || `<p class="bd-picker-empty">${esc(L("pickerNone"))}</p>`;
  rows = [...list.querySelectorAll(".bd-picker-row")].map(el => ({ value: el.dataset.value, el }));
  const at = ctx.addedAt ?? -1;
  ctx.addedAt = null;
  setActive(rows.find(r => r.value === ctx.active) || (at >= 0 ? rows[Math.min(at, rows.length - 1)] : null) || rows[0] || null, false);
  dlg.querySelectorAll('[data-pk="chip"]').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.chip === ctx.chip)));
  dlg.querySelector(".bd-picker-status").textContent = ctx.status || "";
}

function setActive(r, scroll = true) {
  rows.forEach(x => { x.el.classList.toggle("is-active", x === r); x.el.setAttribute("aria-selected", String(x === r)); });
  ctx.active = r?.value || null;
  const input = dlg.querySelector(".bd-picker-search");
  if (r) input?.setAttribute("aria-activedescendant", r.el.id); else input?.removeAttribute("aria-activedescendant");
  if (r && scroll) r.el.scrollIntoView({ block: "nearest" });
}

function add(value) {
  const r = rows.find(x => x.value === value);
  const name = r?.el.querySelector(".bd-pk-name")?.textContent || "";
  // The cursor stays on the row added; a stash row taken is gone (or its
  // value now names the next stash item), so the row now in its place.
  ctx.active = value;
  ctx.addedAt = rows.indexOf(r);
  ctx.status = fill(L("addedItem"), { item: name });
  dlg.querySelector(".bd-picker-status").textContent = ctx.status;
  hooks.add(ctx.uid, value);   // the Builder redraws, then refreshPicker()
}

function onClick(e) {
  const el = e.target.closest("[data-pk]");
  if (!el || !ctx) return;
  switch (el.dataset.pk) {
    case "close": dlg.close(); break;
    case "chip":  ctx.chip = el.dataset.chip; ctx.active = null; drawList(); break;
    case "add":   setActive(rows.find(r => r.el === el), false); add(el.dataset.value); break;
    case "rm": {
      const { uid, list, i } = ctx;
      dlg.close();
      hooks.remove(uid, list, i, el.dataset.how);
      break;
    }
  }
}

function onKey(e) {
  if (!ctx || ctx.mode !== "add" || !rows.length) return;
  const i = rows.findIndex(r => r.value === ctx.active);
  const go = (j) => { e.preventDefault(); setActive(rows[Math.max(0, Math.min(rows.length - 1, j))]); };
  switch (e.key) {
    case "ArrowDown": go(i + 1); break;
    case "ArrowUp":   go(i - 1); break;
    case "PageDown":  go(i + 8); break;
    case "PageUp":    go(i - 8); break;
    case "Enter":
      if (e.target.matches(".bd-picker-search, .bd-picker-row") && ctx.active) { e.preventDefault(); add(ctx.active); }
      break;
  }
}

/** Is this item one the stash can take? (Not the free Improvised Weapon.) */
export const stashable = (key) => !improvised(key);
