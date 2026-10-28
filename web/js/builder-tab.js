/**
 * Builder tab — create and edit gatherings (rulebook pp.17-42).
 *
 * The saved gathering (web/js/gatherings.js) is the only state: every edit
 * clones it, changes the clone, saves it and redraws the tab from it, with
 * costs, stats and warnings recomputed by builder/rules.js. Nothing is
 * blocked; a broken rule shows as a warning on the model it applies to.
 *
 * Hand-off to the rest of the app goes through the Companion App JSON the
 * gathering exports (builder/appjson.js): the Warband roster renders it and
 * the importer's card matching queues its cards.
 */

import { state, saveWarband } from "./state.js";
import { $, escapeHtml } from "./util.js";
import { pickField } from "./i18n.js";
import { store } from "./gatherings.js";
import { applyPayload } from "./import.js";
import { evaluate, AFFINITIES } from "./builder/rules.js";
import { newGathering, newModel } from "./builder/gathering.js";
import { toAppJson } from "./builder/appjson.js";
import { linkUrl, defaultWeapon } from "./builder/codec.js";
import { categoryOf, slug, TRAIT_CATEGORIES, WEAPON_CATEGORIES } from "./builder/catalog.js";
import { describe, label, itemName } from "./builder/messages.js";
import { campaignHtml, campaignChange, campaignClick } from "./builder-campaign.js";
import { buyGear, sellGear, recruit, record } from "./builder/campaign.js";
import { campaignStarted } from "./builder/rules.js";
import { afterBattleHtml, afterBattleChange, afterBattleClick } from "./builder-afterbattle.js";

const $pick   = $("bd-pick");
const $body   = $("bd-body");
const $newBtn = $("bd-new");
const $dupBtn = $("bd-dup");
const $delBtn = $("bd-del");

let hooks = {};
let status = "";          // one line of feedback from the last action (HTML)
let summaryOpen = false;  // the warning summary, opened from the count chip
let view = "gathering";   // "gathering" (build) or "campaign"

const esc = escapeHtml;
const lang = () => state.lang || "en";
const L = (k) => label(k, lang());
const catalog = () => state.catalog;

export function initBuilder({ onChange, switchToWarband }) {
  hooks = { onChange, switchToWarband };
  $newBtn.addEventListener("click", () => { store.save(newGathering()); status = ""; renderBuilder(); });
  $dupBtn.addEventListener("click", () => {
    const g = store.current();
    if (!g) return;
    store.save({ ...structuredClone(g), id: newGathering().id,
                 name: `${g.name || L("untitled")} ${L("copySuffix")}` });
    renderBuilder();
  });
  $delBtn.addEventListener("click", () => {
    const g = store.current();
    if (g && confirm(L("confirmDelete"))) { store.remove(g.id); status = ""; renderBuilder(); }
  });
  $pick.addEventListener("change", () => {
    const g = store.get($pick.value);
    if (g) store.save(g);   // saving makes it current
    status = "";
    renderBuilder();
  });
  $body.addEventListener("change", onChange_);
  $body.addEventListener("click", onClick);
}

/* ---- editing ------------------------------------------------------------- */

/** Clone the current gathering, let `fn` change it, save and redraw. The
 *  redraw waits a tick so a Tab key press lands its focus first. */
function edit(fn) {
  const cur = store.current();
  if (!cur) return;
  const g = structuredClone(cur);
  fn(g);
  store.save(g);
  setTimeout(renderBuilder, 0);
}

const findModel = (g, uid) => g.models.find(m => m.uid === uid);
const isLeaderKey = (key) => categoryOf(key) === "leaders";

/** The one affinity a covenant locks its gathering to, or null. */
function covenantLock(g) {
  const cov = catalog().covenant(g.covenant);
  const locks = (cov?.keywords_any || []).map(k => k.toLowerCase()).filter(k => AFFINITIES.includes(k));
  return locks.length === 1 ? locks[0] : null;
}

function allowedAffinities(key) {
  return isLeaderKey(key) ? AFFINITIES : (catalog().profileRules(key).affinity || AFFINITIES);
}

/** A new model of type `key`, set up the way the rulebook starts it. */
function addModel(g, key) {
  const allowed = allowedAffinities(key);
  const lock = covenantLock(g);
  const m = newModel(g, {
    profile: key,
    affinity: allowed.length === 1 ? allowed[0] : (lock && allowed.includes(lock) ? lock : null),
    weapons: [defaultWeapon(catalog(), key)],
  });
  if (isLeaderKey(key)) {
    // Every leader gains Summon, and its covenant's leader trait.
    m.spells = ["spells/summon"];
    const cov = catalog().covenant(g.covenant);
    if (cov?.leader_trait) m.traits = [cov.leader_trait];
    g.models.unshift(m);
  } else {
    g.models.push(m);
  }
}

function setCovenant(g, key) {
  const old = catalog().covenant(g.covenant);
  const cov = catalog().covenant(key);
  g.covenant = key || null;
  const leader = g.models.find(m => isLeaderKey(m.profile));
  if (leader) {
    leader.traits = leader.traits.filter(t => t !== old?.leader_trait);
    if (cov?.leader_trait && !leader.traits.includes(cov.leader_trait)) leader.traits.unshift(cov.leader_trait);
  }
  // A covenant that locks the affinity sets it wherever the model allows it.
  const lock = covenantLock(g);
  if (lock) for (const m of g.models) if (allowedAffinities(m.profile).includes(lock)) m.affinity = lock;
}

function changeProfile(g, m, key) {
  const wasLeader = isLeaderKey(m.profile);
  m.profile = key;
  const allowed = allowedAffinities(key);
  if (!allowed.includes(m.affinity)) m.affinity = allowed.length === 1 ? allowed[0] : null;
  if (isLeaderKey(key) && !wasLeader) {
    if (!m.spells.includes("spells/summon")) m.spells.unshift("spells/summon");
    const cov = catalog().covenant(g.covenant);
    if (cov?.leader_trait && !m.traits.includes(cov.leader_trait)) m.traits.unshift(cov.leader_trait);
  }
  // Swap a free default weapon for the new type's (colossal or not).
  if (m.weapons.length === 1 && /improvised-weapon$/.test(m.weapons[0])) m.weapons = [defaultWeapon(catalog(), key)];
}

const GEAR = ["weapons", "armour", "equipment"];

function addItem(m, list, key) {
  // The free Improvised Weapon is only there because a model needs a
  // weapon: a real one takes its place.
  const lone = list === "weapons" && m.weapons.length === 1 &&
    /improvised-weapon$/.test(m.weapons[0]) && !/improvised-weapon$/.test(key);
  if (lone && categoryOf(key) !== "thrown-weapons") m.weapons = [];
  m[list].push(key);
}

function onChange_(e) {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const { act, uid, list, aff } = el.dataset;
  const v = el.value;
  edit(g => {
    if (afterBattleChange(act, el, g) || campaignChange(act, el, g)) return;
    const m = uid ? findModel(g, uid) : null;
    switch (act) {
      case "name":       g.name = v.trim(); break;
      case "covenant":   setCovenant(g, v); break;
      case "lair-name":  g.lair = { ...g.lair, name: v.trim() }; break;
      case "lair-pick":  if (v) g.lair = { ...g.lair, name: lairName(Number(v)) }; break;
      case "add-model":
        if (!v) break;
        // In a campaign a new minion is recruited at the Bazaar price (p.72).
        if (campaignStarted(g) && categoryOf(v) === "minions") recruit(g, catalog(), v, defaultWeapon(catalog(), v));
        else addModel(g, v);
        break;
      case "m-name":     m.name = v.trim(); break;
      case "m-profile":  changeProfile(g, m, v); break;
      case "m-aff":      m.affinity = v || null; break;
      case "m-add":
        if (!v) break;
        // In a campaign gear is bought at the Bazaar price (p.72); traits
        // and spells come from rewards, not the treasury.
        if (campaignStarted(g) && GEAR.includes(list)) buyGear(g, catalog(), m.uid, list, v);
        else addItem(m, list, v);
        break;
      case "m-mana":     m.mana = { ...m.mana, [aff]: Math.max(0, parseInt(v, 10) || 0) }; break;
    }
  });
}

function onClick(e) {
  const el = e.target.closest("button[data-act]");
  if (!el) return;
  const { act, uid, list, i } = el.dataset;
  const g = store.current();
  if (act === "view") { view = el.dataset.view; renderBuilder(); return; }
  // Campaign actions change a clone; only a handled one is saved.
  const clone = g ? structuredClone(g) : null;
  if (clone && (afterBattleClick(act, el, clone) || campaignClick(act, el, clone))) {
    store.save(clone);
    setTimeout(renderBuilder, 0);
    return;
  }
  switch (act) {
    case "m-del-item": edit(g => {
                         // In a campaign weapons and armour sell for half (p.72).
                         if (campaignStarted(g) && (list === "weapons" || list === "armour")) sellGear(g, catalog(), uid, list, i);
                         else {
                           const [k] = findModel(g, uid)[list].splice(Number(i), 1);
                           if (campaignStarted(g) && list === "equipment") record(g, "discard", { item: k, uid });
                         }
                       }); break;
    case "m-remove":   edit(g => {
                         const m = findModel(g, uid);
                         if (campaignStarted(g)) record(g, "dismiss", { item: m.profile, uid });
                         g.models = g.models.filter(x => x.uid !== uid);
                       }); break;
    case "m-up":
    case "m-down":     edit(g => {
                         const k = g.models.findIndex(m => m.uid === uid);
                         const j = act === "m-up" ? k - 1 : k + 1;
                         if (j >= 0 && j < g.models.length) [g.models[k], g.models[j]] = [g.models[j], g.models[k]];
                       }); break;
    case "lair-roll":  edit(g => { g.lair = { ...g.lair, name: lairName(rollLair()) }; }); break;
    case "roster":     showRoster(g); break;
    case "cards":      queueCards(g); break;
    case "link":       copyLink(g); break;
    case "export":     download(`${fileStem(g)}.json`, toAppJson(g, catalog())); break;
    case "backup":     download(`${fileStem(g)}-backup.json`, g); break;
    case "summary":    summaryOpen = !summaryOpen; renderBuilder(); break;
    case "goto":       gotoModel(uid); break;
  }
}

/* ---- lair names (p.42) ---------------------------------------------------- */

/** D5 for the tens, D10 for the ones: 11-60. */
function rollLair() {
  const d5 = 1 + Math.floor(Math.random() * 5);
  const d10 = 1 + Math.floor(Math.random() * 10);
  return d5 * 10 + d10;
}

function lairName(roll) {
  const e = (catalog().rules.lair_names || []).find(x => x.roll === roll);
  return e ? pickField(e, "name", lang()) : "";
}

/* ---- hand-off -------------------------------------------------------------- */

function showRoster(g) {
  state.warband = toAppJson(g, catalog());
  saveWarband();
  hooks.switchToWarband?.();
}

function queueCards(g) {
  const matches = applyPayload(toAppJson(g, catalog()), { queue: true });
  const n = matches.filter(m => m.target.kind !== "unmatched").length;
  hooks.onChange?.();
  status = `${n} ${esc(L("cardsAdded"))}`;
  renderBuilder();
}

function copyLink(g) {
  const url = linkUrl(g, catalog());
  // Always show the link too, in case the clipboard is unavailable.
  const shown = `<input class="bd-link" readonly value="${esc(url)}">`;
  status = shown;
  renderBuilder();
  navigator.clipboard?.writeText(url).then(() => {
    status = `${esc(L("linkCopied"))} ${shown}`;
    renderBuilder();
  }, () => {});
}

const fileStem = (g) => slug(g.name) || "gathering";

function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---- rendering ------------------------------------------------------------- */

export function renderBuilder() {
  if (!catalog()) return;
  // Keep focus on the same field across the redraw.
  const focused = document.activeElement?.dataset?.fid;

  const all = store.list();
  const g = store.current();
  $newBtn.textContent = `+ ${L("newGathering")}`;
  $dupBtn.textContent = L("duplicate");
  $delBtn.textContent = L("delete");
  $dupBtn.disabled = $delBtn.disabled = !g;
  $pick.hidden = !all.length;
  $pick.innerHTML = all.map(x =>
    `<option value="${esc(x.id)}"${x.id === g?.id ? " selected" : ""}>${esc(x.name || L("untitled"))}</option>`).join("");

  if (!g) {
    $body.innerHTML = `<div class="empty-msg">${esc(L("empty"))}</div>`;
    return;
  }
  const ev = evaluate(g, catalog());
  $body.innerHTML =
    headHtml(g) +
    summaryHtml(g, ev) +
    (summaryOpen && ev.warnings.length
      ? warningSummaryHtml(g, ev)
      : warningsHtml(ev.warnings.filter(w => !w.model))) +
    viewSwitchHtml() +
    (view === "campaign"
      ? (g.campaign?.afterBattle ? afterBattleHtml(g, ev) : campaignHtml(g, ev))
      : g.models.map((m, i) => modelHtml(g, m, ev.models[i], i)).join("") + addModelHtml(g));

  if (focused) $body.querySelector(`[data-fid="${CSS.escape(focused)}"]`)?.focus();
}

function viewSwitchHtml() {
  const b = (v) => `<button type="button" class="secondary" data-act="view" data-view="${v}" aria-pressed="${view === v}">` +
    `${esc(L(v === "campaign" ? "viewCampaign" : "viewGathering"))}</button>`;
  return `<div class="bd-views" role="group" aria-label="Builder workspace">${b("gathering")}${b("campaign")}</div>`;
}

function headHtml(g) {
  const covs = (catalog().rules.covenants || []).map(c =>
    `<option value="${esc(c.key)}"${c.key === g.covenant ? " selected" : ""}>${esc(itemName(catalog(), c.key, lang()))}</option>`);
  const lairs = (catalog().rules.lair_names || []).map(e =>
    `<option value="${e.roll}">${e.roll} · ${esc(pickField(e, "name", lang()))}</option>`);
  return `
    <div class="bd-head">
      <label>${esc(L("name"))}
        <input type="text" data-act="name" data-fid="g-name" value="${esc(g.name)}" placeholder="${esc(L("untitled"))}"></label>
      <label>${esc(L("covenant"))}
        <select data-act="covenant" data-fid="g-cov">
          <option value="">${esc(L("chooseCovenant"))}</option>${covs.join("")}
        </select></label>
      <label class="bd-lair">${esc(L("lair"))}
        <span class="bd-inline">
          <input type="text" data-act="lair-name" data-fid="g-lair" value="${esc(g.lair?.name || "")}">
          <button type="button" class="secondary" data-act="lair-roll" data-fid="g-roll">🎲 ${esc(L("rollLair"))}</button>
          <select data-act="lair-pick" data-fid="g-lair-pick"><option value="">${esc(L("pickLair"))}</option>${lairs.join("")}</select>
        </span></label>
    </div>`;
}

function summaryHtml(g, ev) {
  const over = ev.budget != null && ev.total > ev.budget;
  // The 300 obols are the first build's budget only; once the campaign
  // starts, the deployment limit and the treasury take over.
  const spent = ev.budget != null
    ? `<b>${ev.total}</b> / ${ev.budget} ${esc(L("obols"))} ${esc(L("spent"))} · ${esc(L("firstBuild"))}`
    : `<b>${ev.total}</b> ${esc(L("obols"))} · ${esc(L("treasury"))} <b>${Number(g.treasury) || 0}</b>`;
  const startBtn = ev.budget != null
    ? `<button type="button" class="secondary" data-act="start-built">${esc(L("alreadyBuilt"))}</button>` : "";
  const nWarn = ev.warnings.length;
  return `
    <div class="bd-summary">
      <span class="wb-chip ${over ? "over" : "good"}">${spent}</span>
      ${startBtn}
      <span class="wb-chip">${esc(L("deployment"))} <b>${ev.deploymentLimit}</b></span>
      <span class="wb-chip"><b>${g.models.length}</b> ${esc(L(g.models.length === 1 ? "model" : "models"))}</span>
      ${nWarn
        ? `<button type="button" class="wb-chip over bd-chip-btn" data-act="summary" aria-expanded="${summaryOpen}">` +
          `<b>${nWarn}</b> ${esc(L(nWarn === 1 ? "warning" : "warnings"))} ${summaryOpen ? "▴" : "▾"}</button>`
        : `<span class="wb-chip good">${esc(L("noWarnings"))}</span>`}
      <span class="spacer"></span>
      <button type="button" class="primary" data-act="roster">${esc(L("viewRoster"))}</button>
      <button type="button" class="secondary" data-act="cards">${esc(L("addCards"))}</button>
      <button type="button" class="secondary" data-act="link">${esc(L("copyLink"))}</button>
      <button type="button" class="secondary" data-act="export">${esc(L("exportJson"))}</button>
      <button type="button" class="secondary" data-act="backup">${esc(L("backup"))}</button>
    </div>
    ${status ? `<div class="bd-status">${status}</div>` : ""}
    ${ev.budget == null && view === "gathering" ? `<p class="bd-hint">${esc(L("campaignShop"))}</p>` : ""}`;
}

function warningsHtml(ws) {
  if (!ws.length) return "";
  return `<ul class="bd-warn" aria-label="Rule warnings">${ws.map(w => `<li>⚠ ${esc(describe(w, catalog(), lang()))}</li>`).join("")}</ul>`;
}

/**
 * Every warning in one list: the gathering's own first, then each model's
 * under its name. A model's entries jump to its card.
 */
function warningSummaryHtml(g, ev) {
  const line = (w) => esc(describe(w, catalog(), lang()));
  const own = ev.warnings.filter(w => !w.model);
  const groups = [];
  if (own.length) {
    groups.push(`<li class="bd-sum-group"><h4>${esc(L("gathering"))}</h4><ul>` +
      own.map(w => `<li>${line(w)}</li>`).join("") + `</ul></li>`);
  }
  g.models.forEach((m, i) => {
    const ws = ev.models[i].warnings;
    if (!ws.length) return;
    const type = itemName(catalog(), m.profile, lang());
    const title = m.name ? `${m.name} (${type})` : type;
    groups.push(`<li class="bd-sum-group"><h4>${esc(title)}</h4><ul>` +
      ws.map(w => `<li><button type="button" data-act="goto" data-uid="${esc(m.uid)}">${line(w)}</button></li>`).join("") +
      `</ul></li>`);
  });
  return `<ul class="bd-sum">${groups.join("")}</ul>`;
}

/** Scroll a model's card into view and flash it. */
function gotoModel(uid) {
  const card = document.getElementById(`bd-model-${uid}`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.classList.remove("flash");
  void card.offsetWidth;   // restart the animation
  card.classList.add("flash");
}

/** "7+" for target numbers, "—" when the model has none. */
const target = (n) => (n == null ? "—" : `${n}+`);

function modelHtml(g, m, e, idx) {
  const leader = e.isLeader;
  const uid = esc(m.uid);
  const profiles = (cat) => (catalog().bundle.categories[cat]?.rows || []).map(r => {
    const key = `${cat}/${slug(r.name)}`;
    return `<option value="${esc(key)}"${key === m.profile ? " selected" : ""}>${esc(pickField(r, "name", lang()))}</option>`;
  }).join("");
  // Short choices are visible radios, not a dropdown. Inputs keep the
  // existing data-act=m-aff change handler and keyboard semantics intact.
  const affChoices = [null, ...allowedAffinities(m.profile)];
  const affinityHtml = `<fieldset class="bd-affinity-control"><legend>${esc(L("affinity"))}</legend>` +
    affChoices.map(a => {
      const val = a || "";
      const text = a ? esc(L(a)) : "—";
      const title = a ? esc(L(a)) : esc(L("chooseAffinity"));
      const chosen = (m.affinity || "") === val;
      return `<label class="bd-affinity-option" title="${title}">` +
        `<input type="radio" name="aff-${uid}" value="${esc(val)}" data-act="m-aff" data-uid="${uid}" ` +
        `data-fid="${uid}-aff-${esc(val || "none")}" aria-label="${title}"${chosen ? " checked" : ""}>` +
        `<span>${text}</span></label>`;
    }).join("") + `</fieldset>`;
  const stats = [
    [L("ap"), e.stats.ap], [L("move"), e.stats.move], [L("violence"), target(e.stats.violence)],
    [L("ranged"), target(e.stats.ranged)], [L("hp"), e.stats.hp],
    ...(leader ? [[L("mana"), e.mana], [L("spells"), e.spellsAllowed]] : []),
  ].map(([k, v]) => `<span><i>${esc(k)}</i> <b>${esc(String(v ?? "—"))}</b></span>`).join("");

  // Sellswords come with fixed armaments (p.74-76): show them, nothing to pick.
  const sw = e.isSellsword;
  const swRow = sw ? catalog().row(m.profile) || {} : null;
  const sections = sw ? `<div class="bd-list"><h4>${esc(L("armaments"))}</h4>` +
      `<div class="bd-amb-text">${esc(String(pickField(swRow, "armaments", lang()) || "—"))}</div></div>` : [
    listHtml(m, "traits", leader ? TRAIT_CATEGORIES : ["covenant-wretched-traits", "wretched-undead-traits"]),
    leader ? listHtml(m, "spells", ["spells"]) : "",
    listHtml(m, "weapons", WEAPON_CATEGORIES),
    listHtml(m, "armour", ["armours"]),
    listHtml(m, "equipment", ["miscellaneous-equipment"]),
    leader ? manaHtml(m) : "",
  ].join("");

  return `
    <section class="bd-model${leader ? " leader" : ""}" id="bd-model-${uid}">
      <div class="bd-model-head">
        <input type="text" data-act="m-name" data-uid="${uid}" data-fid="${uid}-name" value="${esc(m.name || "")}" placeholder="${esc(L("modelName"))}">
        ${sw ? `<span class="bd-type">${esc(itemName(catalog(), m.profile, lang()))} <span class="bd-tag">${esc(L("sellsword"))}</span></span>`
             : `<select data-act="m-profile" data-uid="${uid}" data-fid="${uid}-profile">
          <optgroup label="${esc(L("leaders"))}">${profiles("leaders")}</optgroup>
          <optgroup label="${esc(L("minions"))}">${profiles("minions")}</optgroup>
        </select>`}
        ${affinityHtml}
        <span class="wb-chip accent"><b>${e.cost}</b> ${esc(L("obols"))}${sw
          ? ` · ${Number(swRow.deploy_obols) || 0} ${esc(L("deployCost"))}` : ""}</span>
        <span class="spacer"></span>
        <button type="button" class="secondary" data-act="m-up" data-uid="${uid}" title="↑"${idx === 0 ? " disabled" : ""}>↑</button>
        <button type="button" class="secondary" data-act="m-down" data-uid="${uid}" title="↓"${idx === g.models.length - 1 ? " disabled" : ""}>↓</button>
        <button type="button" class="secondary" data-act="m-remove" data-uid="${uid}" title="${esc(L("remove"))}">✕</button>
      </div>
      <div class="bd-stats">${stats}</div>
      ${warningsHtml(e.warnings)}
      <div class="bd-lists">${sections}</div>
    </section>`;
}

/** Category headings for the add menus. */
const CAT_TITLE = {
  "basic-leader-traits":      ["Basic Leader Traits", "Rasgos básicos de líder"],
  "covenant-leader-traits":   ["Covenant Leader Traits", "Rasgos de líder de pacto"],
  "covenant-wretched-traits": ["Covenant Traits", "Rasgos de pacto"],
  "wretched-undead-traits":   ["Wretched Undead Traits", "Rasgos de No Muertos Miserables"],
  "melee-weapons":            ["Melee Weapons", "Armas cuerpo a cuerpo"],
  "ranged-weapons":           ["Ranged Weapons", "Armas a distancia"],
  "thrown-weapons":           ["Thrown Weapons", "Armas arrojadizas"],
  "colossal-weapons":         ["Colossal Weapons", "Armas colosales"],
  "armours":                  ["Armour", "Armaduras"],
  "miscellaneous-equipment":  ["Miscellaneous Equipment", "Equipo misceláneo"],
};

function listHtml(m, list, cats) {
  const uid = esc(m.uid);
  const chips = (m[list] || []).map((key, i) => {
    const row = catalog().row(key);
    const cost = Number(row?.obols) || 0;
    return `<span class="bd-item">${esc(itemName(catalog(), key, lang()))}` +
      (cost ? ` <small>${cost}</small>` : "") +
      `<button type="button" data-act="m-del-item" data-uid="${uid}" data-list="${list}" data-i="${i}" title="${esc(L("remove"))}">✕</button></span>`;
  }).join("");

  const groups = list === "spells" ? spellGroups() : cats.map(cat => [
    (lang() === "es" ? CAT_TITLE[cat]?.[1] : CAT_TITLE[cat]?.[0]) || cat,
    (catalog().bundle.categories[cat]?.rows || []).map(r => [`${cat}/${slug(r.name)}`, r]),
  ]);
  const options = groups.map(([title, rows]) => `<optgroup label="${esc(title)}">` + rows.map(([key, r]) => {
    const cost = Number(r.obols) || 0;
    return `<option value="${esc(key)}">${esc(pickField(r, "name", lang()))}${cost ? ` · ${cost}` : ""}</option>`;
  }).join("") + `</optgroup>`).join("");

  return `
    <div class="bd-list">
      <h4>${esc(L(list))}</h4>
      <div class="bd-items">${chips}
        <select data-act="m-add" data-uid="${uid}" data-list="${list}" data-fid="${uid}-add-${list}">
          <option value="">${esc(L("add"))}</option>${options}
        </select>
      </div>
    </div>`;
}

/** Spells grouped by school, in the order the rulebook lists them. */
function spellGroups() {
  const groups = new Map();
  for (const r of catalog().bundle.categories.spells?.rows || []) {
    const school = pickField(r, "school", lang()) || r.school || "";
    if (!groups.has(school)) groups.set(school, []);
    groups.get(school).push([`spells/${slug(r.name)}`, r]);
  }
  return [...groups];
}

function manaHtml(m) {
  const uid = esc(m.uid);
  const inputs = AFFINITIES.map(a => `
    <label>${esc(L(a))}
      <input type="number" min="0" max="9" data-act="m-mana" data-uid="${uid}" data-aff="${a}" data-fid="${uid}-mana-${a}" value="${Number(m.mana?.[a]) || 0}">
    </label>`).join("");
  return `<div class="bd-list"><h4>${esc(L("mana"))}</h4><div class="bd-mana">${inputs}</div></div>`;
}

function addModelHtml(g) {
  const hasLeader = g.models.some(m => isLeaderKey(m.profile));
  const opts = (cat) => (catalog().bundle.categories[cat]?.rows || []).map(r =>
    `<option value="${esc(`${cat}/${slug(r.name)}`)}">${esc(pickField(r, "name", lang()))} · ${Number(r.obols) || 0}</option>`).join("");
  return `
    <div class="bd-add-model">
      ${g.models.length ? "" : `<span class="bd-hint">${esc(L("noModels"))}</span>`}
      <select data-act="add-model" data-fid="add-model">
        <option value="">${esc(L("addModel"))}…</option>
        ${hasLeader ? "" : `<optgroup label="${esc(L("leaders"))}">${opts("leaders")}</optgroup>`}
        <optgroup label="${esc(L("minions"))}">${opts("minions")}</optgroup>
      </select>
    </div>`;
}
