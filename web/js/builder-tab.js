/**
 * Builder tab — create and edit gatherings (rulebook pp.17-42).
 *
 * Laid out as a gathering sheet: the models on the left, and beside them a
 * ledger that stays in view — who the gathering is, what it costs, what is
 * wrong with it, and what to do with it.
 *
 * Edits go into a draft (web/js/gatherings.js), not the saved gathering:
 * every change clones the working copy, changes the clone and redraws, with
 * costs, stats and warnings recomputed by builder/rules.js. "Save changes"
 * commits the draft, "Discard" drops it, so options and gear can be tried
 * out freely. Nothing is blocked; a broken rule shows on its model.
 *
 * Hand-off to the rest of the app goes through the Companion App JSON the
 * gathering exports (builder/appjson.js): the Warband roster renders it and
 * the importer's card matching queues its cards.
 */

import { state, saveWarband } from "./state.js";
import { $, escapeHtml } from "./util.js";
import { pickField } from "./i18n.js";
import { store, drafts } from "./gatherings.js";
import { applyPayload } from "./import.js";
import { evaluate, campaignStarted, AFFINITIES } from "./builder/rules.js";
import { newGathering, newModel } from "./builder/gathering.js";
import { toAppJson } from "./builder/appjson.js";
import { linkUrl, defaultWeapon } from "./builder/codec.js";
import { categoryOf, slug, TRAIT_CATEGORIES, WEAPON_CATEGORIES } from "./builder/catalog.js";
import { describe, label, itemName } from "./builder/messages.js";
import { buyGear, sellGear, recruit, record } from "./builder/campaign.js";
import { campaignHtml, campaignChange, campaignClick, setFold } from "./builder-campaign.js";
import { afterBattleHtml, afterBattleChange, afterBattleClick } from "./builder-afterbattle.js";

const $pick   = $("bd-pick");
const $body   = $("bd-body");
const $newBtn = $("bd-new");
const $dupBtn = $("bd-dup");
const $delBtn = $("bd-del");

let hooks = {};
let status = "";          // one line of feedback from the last action (HTML)
let summaryOpen = false;  // every warning listed, opened from the ledger
let view = "gathering";   // "gathering" (build) or "campaign"

const esc = escapeHtml;
const lang = () => state.lang || "en";
const L = (k) => label(k, lang());
const catalog = () => state.catalog;

/* ---- the working copy ------------------------------------------------------ */

/** The gathering as the player sees it: its draft if there is one. */
function working() {
  const cur = store.current();
  return cur ? drafts.get(cur.id) || cur : null;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Does this gathering have changes that aren't saved? */
const dirty = (g) => !!g && !!drafts.get(g.id) && !same(drafts.get(g.id), store.get(g.id));

function keep(g) {
  // Back to exactly what is saved: no draft needed.
  if (same(g, store.get(g.id))) drafts.remove(g.id);
  else drafts.set(g);
}

export function initBuilder({ onChange, switchToWarband }) {
  hooks = { onChange, switchToWarband };
  $newBtn.addEventListener("click", () => { store.save(newGathering()); status = ""; view = "gathering"; renderBuilder(); });
  $dupBtn.addEventListener("click", () => {
    const g = working();
    if (!g) return;
    store.save({ ...structuredClone(g), id: newGathering().id, name: `${g.name || L("untitled")} ${L("copySuffix")}` });
    renderBuilder();
  });
  $delBtn.addEventListener("click", () => {
    const g = store.current();
    if (g && confirm(L("confirmDelete"))) { drafts.remove(g.id); store.remove(g.id); status = ""; renderBuilder(); }
  });
  $pick.addEventListener("change", () => {
    const g = store.get($pick.value);
    if (g) store.save(g);   // saving makes it current; its draft, if any, stays
    status = "";
    renderBuilder();
  });
  $body.addEventListener("change", onChange_);
  $body.addEventListener("click", onClick);
  // Folding sections remember whether they're open ("toggle" doesn't bubble).
  $body.addEventListener("toggle", (e) => { if (e.target.dataset?.fold) setFold(e.target.dataset.fold, e.target.open); }, true);
}

/* ---- editing --------------------------------------------------------------- */

/** Clone the working copy, let `fn` change it, keep it as the draft and
 *  redraw. The redraw waits a tick so a Tab key press lands its focus first. */
function edit(fn) {
  const cur = working();
  if (!cur) return;
  const g = structuredClone(cur);
  fn(g);
  keep(g);
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

function addItem(g, m, list, key) {
  // In a campaign gear is bought at the Bazaar price (p.72); traits and
  // spells come from rewards, not the treasury.
  if (campaignStarted(g) && GEAR.includes(list)) return buyGear(g, catalog(), m.uid, list, key);
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
  const { act, uid, aff } = el.dataset;
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
      case "m-add": {
        const [list, key] = v.split("|");
        if (list && key) addItem(g, m, list, key);
        break;
      }
      case "m-mana":     m.mana = { ...m.mana, [aff]: Math.max(0, parseInt(v, 10) || 0) }; break;
    }
  });
}

function onClick(e) {
  const el = e.target.closest("button[data-act]");
  if (!el) return;
  const { act, uid, list, i } = el.dataset;
  const g = working();
  switch (act) {
    case "new":     $newBtn.click(); return;
    case "view":    view = el.dataset.view; renderBuilder(); return;
    case "save":    store.save(drafts.get(g.id)); drafts.remove(g.id); status = esc(L("saved")); renderBuilder(); return;
    case "discard": if (confirm(L("confirmDiscardDraft"))) { drafts.remove(g.id); status = ""; renderBuilder(); } return;
  }
  // Campaign and after-battle actions change a clone; only a handled one is kept.
  const clone = g ? structuredClone(g) : null;
  if (clone && (afterBattleClick(act, el, clone) || campaignClick(act, el, clone))) {
    keep(clone);
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

/* ---- lair names (p.42) ----------------------------------------------------- */

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

/* ---- hand-off --------------------------------------------------------------- */

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

/* ---- rendering --------------------------------------------------------------- */

export function renderBuilder() {
  if (!catalog()) return;
  // Keep focus on the same field across the redraw.
  const focused = document.activeElement?.dataset?.fid;

  const all = store.list();
  const g = working();
  $newBtn.textContent = L("newGathering");
  $dupBtn.textContent = L("duplicate");
  $delBtn.textContent = L("delete");
  $dupBtn.hidden = $delBtn.hidden = $newBtn.hidden = !g;   // the empty state has its own button
  $pick.hidden = all.length < 2;
  $pick.innerHTML = all.map(x =>
    `<option value="${esc(x.id)}"${x.id === g?.id ? " selected" : ""}>${esc((drafts.get(x.id) || x).name || L("untitled"))}` +
    `${dirty(x) ? ` (${esc(L("unsavedShort"))})` : ""}</option>`).join("");

  if (!g) {
    $body.innerHTML = `<div class="bd-empty"><p>${esc(L("empty"))}</p>
      <button type="button" class="primary" data-act="new">${esc(L("newGathering"))}</button></div>`;
    return;
  }
  const ev = evaluate(g, catalog());
  const main = view === "campaign"
    ? (g.campaign?.afterBattle ? afterBattleHtml(g, ev) : campaignHtml(g, ev))
    : (campaignStarted(g) ? `<p class="bd-hint">${esc(L("campaignShop"))}</p>` : "") +
      g.models.map((m, i) => modelHtml(g, m, ev.models[i], i)).join("") + addModelHtml(g);
  $body.innerHTML = `
    <div class="bd-layout">
      <div class="bd-main">
        ${viewTabsHtml()}
        ${summaryOpen && ev.warnings.length ? warningSummaryHtml(g, ev) : ""}
        ${main}
      </div>
      <aside class="bd-side">${ledgerHtml(g, ev)}</aside>
    </div>`;

  if (focused) $body.querySelector(`[data-fid="${CSS.escape(focused)}"]`)?.focus();
}

function viewTabsHtml() {
  const b = (v, k) => `<button type="button" class="secondary" data-act="view" data-view="${v}" aria-pressed="${view === v}">${esc(L(k))}</button>`;
  return `<div class="bd-views" role="group" aria-label="${esc(L("workspace"))}">${b("gathering", "viewGathering")}${b("campaign", "viewCampaign")}</div>`;
}

/** Rule warnings: amber, with a sign and the text, never colour alone. */
const warnList = (ws) => ws.length
  ? `<ul class="bd-warn" aria-label="${esc(L("ruleWarnings"))}">${ws.map(w => `<li>⚠ ${esc(describe(w, catalog(), lang()))}</li>`).join("")}</ul>`
  : "";

/**
 * The ledger beside the sheet: draft state, identity, the figures that
 * matter (spend against budget, treasury, deployment limit), problems, and
 * what to do with the gathering — one primary action at a time.
 */
function ledgerHtml(g, ev) {
  const isDirty = dirty(g);
  const covs = (catalog().rules.covenants || []).map(c =>
    `<option value="${esc(c.key)}"${c.key === g.covenant ? " selected" : ""}>${esc(itemName(catalog(), c.key, lang()))}</option>`).join("");
  const lairs = (catalog().rules.lair_names || []).map(e =>
    `<option value="${e.roll}">${e.roll}. ${esc(pickField(e, "name", lang()))}</option>`).join("");

  const first = ev.budget != null;
  const over = first && ev.total > ev.budget;
  const pct = first ? Math.min(100, Math.round(ev.total / ev.budget * 100)) : 0;
  const figures = first ? `
      <div class="bd-fig${over ? " over" : ""}">
        <dt>${esc(L("obolsSpent"))}</dt><dd><b>${ev.total}</b> ${esc(L("of"))} ${ev.budget}</dd>
        <div class="bd-meter"><span style="width:${pct}%"></span></div>
      </div>` : `
      <div class="bd-fig"><dt>${esc(L("treasury"))}</dt><dd><b>${Number(g.treasury) || 0}</b> ${esc(L("obols"))}</dd></div>
      <div class="bd-fig"><dt>${esc(L("rosterValue"))}</dt><dd><b>${ev.total}</b> ${esc(L("obols"))}</dd></div>`;

  const own = ev.warnings.filter(w => !w.model);
  const n = ev.warnings.length;
  const warnings = n ? `
      <div class="bd-ledger-warn">
        ${warnList(own)}
        <button type="button" class="link" data-act="summary" aria-expanded="${summaryOpen}">
          ${esc(summaryOpen ? L("hideWarnings") : `${n} ${L(n === 1 ? "warning" : "warnings")}: ${L("showAll")}`)}</button>
      </div>` : `<p class="bd-good">${esc(L("noWarnings"))}</p>`;

  return `
    ${isDirty ? `
      <div class="bd-draft" role="status">
        <p>${esc(L("unsaved"))}</p>
        <button type="button" class="primary" data-act="save">${esc(L("saveChanges"))}</button>
        <button type="button" class="link" data-act="discard">${esc(L("discardChanges"))}</button>
      </div>` : ""}
    <h2 class="bd-gname">${esc(g.name || L("untitled"))}</h2>
    <div class="bd-fields">
      <label>${esc(L("name"))}
        <input type="text" data-act="name" data-fid="g-name" value="${esc(g.name)}" placeholder="${esc(L("untitled"))}"></label>
      <label>${esc(L("covenant"))}
        <select data-act="covenant" data-fid="g-cov"><option value="">${esc(L("chooseCovenant"))}</option>${covs}</select></label>
      <label>${esc(L("lair"))}
        <input type="text" data-act="lair-name" data-fid="g-lair" value="${esc(g.lair?.name || "")}" placeholder="${esc(L("lairPlaceholder"))}"></label>
      <div class="bd-lair-tools">
        <button type="button" class="link" data-act="lair-roll" data-fid="g-roll">${esc(L("rollLair"))}</button>
        <select data-act="lair-pick" data-fid="g-lair-pick" aria-label="${esc(L("pickLair"))}"><option value="">${esc(L("pickLair"))}</option>${lairs}</select>
      </div>
    </div>
    <dl class="bd-figs">
      ${figures}
      <div class="bd-fig"><dt>${esc(L("deploymentLimit"))}</dt><dd><b>${ev.deploymentLimit}</b></dd></div>
      <div class="bd-fig"><dt>${esc(L("modelsLabel"))}</dt><dd><b>${g.models.length}</b></dd></div>
    </dl>
    ${first ? `<p class="bd-hint">${over ? "" : `${esc(L("firstBuildNote"))} `}<button type="button" class="link" data-act="start-built">${esc(L("alreadyBuilt"))}</button></p>` : ""}
    ${warnings}
    <div class="bd-actions">
      <button type="button" class="${isDirty ? "secondary" : "primary"}" data-act="roster">${esc(L("viewRoster"))}</button>
      <button type="button" class="secondary" data-act="cards">${esc(L("addCards"))}</button>
      <details class="bd-share">
        <summary>${esc(L("shareExport"))}</summary>
        <button type="button" class="link" data-act="link">${esc(L("copyLink"))}</button>
        <button type="button" class="link" data-act="export">${esc(L("exportJson"))}</button>
        <button type="button" class="link" data-act="backup">${esc(L("backup"))}</button>
      </details>
    </div>
    ${status ? `<div class="bd-status">${status}</div>` : ""}`;
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
    groups.push(`<li class="bd-sum-group"><h4>${esc(m.name ? `${m.name} (${type})` : type)}</h4><ul>` +
      ws.map(w => `<li><button type="button" data-act="goto" data-uid="${esc(m.uid)}">${line(w)}</button></li>`).join("") +
      `</ul></li>`);
  });
  return `<ul class="bd-sum">${groups.join("")}</ul>`;
}

/** Scroll a model's card into view and mark it briefly. */
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

/**
 * One model on the sheet: its name in blackletter as on its card, type and
 * keyword, cost, the stat strip, any problems, what it carries, and one
 * menu to add to it.
 */
function modelHtml(g, m, e, idx) {
  const leader = e.isLeader;
  const sw = e.isSellsword;
  const uid = esc(m.uid);
  const typeName = itemName(catalog(), m.profile, lang());
  const profiles = (cat) => (catalog().bundle.categories[cat]?.rows || []).map(r => {
    const key = `${cat}/${slug(r.name)}`;
    return `<option value="${esc(key)}"${key === m.profile ? " selected" : ""}>${esc(pickField(r, "name", lang()))}</option>`;
  }).join("");
  // Short choices are visible radios, not a dropdown (PR #6). The options
  // still come from the model's rules, and the inputs keep the existing
  // data-act=m-aff change handler; arrow keys move between them natively.
  const affChoices = [null, ...allowedAffinities(m.profile)];
  const affinityHtml = `<fieldset class="bd-affinity-control"><legend>${esc(L("affinity"))}</legend>` +
    affChoices.map(a => {
      const val = a || "";
      const title = a ? L(a) : L("noAffinity");
      return `<label class="bd-affinity-option${a ? ` aff-${a}` : ""}">` +
        `<input type="radio" name="aff-${uid}" value="${esc(val)}" data-act="m-aff" data-uid="${uid}" ` +
        `data-fid="${uid}-aff-${esc(val || "none")}"${(m.affinity || "") === val ? " checked" : ""}` +
        `${a ? "" : ` aria-label="${esc(title)}"`}>` +
        `<span>${a ? esc(title) : "—"}</span></label>`;
    }).join("") + `</fieldset>`;
  const stats = [
    ["ap", e.stats.ap], ["move", e.stats.move], ["violence", target(e.stats.violence)],
    ["ranged", target(e.stats.ranged)], ["hp", e.stats.hp],
    ...(leader ? [["mana", e.mana], ["spells", e.spellsAllowed]] : []),
  ].map(([k, v]) => `<div class="bd-stat"><dt>${esc(L(k))}</dt><dd>${esc(String(v ?? "—"))}</dd></div>`).join("");

  // What it carries: only lists that have something, in the card's order.
  const swRow = sw ? catalog().row(m.profile) || {} : null;
  const list = (title, body) => `<div class="bd-list"><h4>${esc(title)}</h4><div class="bd-items">${body}</div></div>`;
  const lists = sw
    ? [list(L("armaments"), `<span class="bd-prose">${esc(String(pickField(swRow, "armaments", lang()) || "—"))}</span>`)]
    : ["traits", "spells", "weapons", "armour", "equipment"]
        .filter(l => (m[l] || []).length)
        .map(l => list(L(l), chipsHtml(m, l)));
  if (leader) lists.push(list(L("mana"), manaHtml(m)));

  return `
    <section class="bd-model${leader ? " leader" : ""}${m.affinity ? ` aff-${m.affinity}` : ""}" id="bd-model-${uid}">
      <header class="bd-model-head">
        <div class="bd-model-title">
          <input type="text" class="bd-model-name" data-act="m-name" data-uid="${uid}" data-fid="${uid}-name"
                 value="${esc(m.name || "")}" placeholder="${esc(typeName)}" aria-label="${esc(L("modelName"))}">
          <div class="bd-model-type">
            ${sw ? `<span class="bd-type">${esc(typeName)}, ${esc(L("sellsword").toLowerCase())}</span>`
                 : `<select data-act="m-profile" data-uid="${uid}" data-fid="${uid}-profile" aria-label="${esc(L("modelType"))}">
                      <optgroup label="${esc(L("leaders"))}">${profiles("leaders")}</optgroup>
                      <optgroup label="${esc(L("minions"))}">${profiles("minions")}</optgroup>
                    </select>`}
            ${affinityHtml}
          </div>
        </div>
        <div class="bd-model-cost"><b>${e.cost}</b> ${esc(L("obols"))}${sw
          ? `<small>${esc(L("deployCost"))} ${Number(swRow.deploy_obols) || 0}</small>` : ""}</div>
      </header>
      <dl class="bd-stats">${stats}</dl>
      ${warnList(e.warnings)}
      ${lists.length ? `<div class="bd-lists">${lists.join("")}</div>` : ""}
      <footer class="bd-model-foot">
        ${sw ? "" : addMenuHtml(m, leader)}
        <span class="spacer"></span>
        <button type="button" class="secondary" data-act="m-up" data-uid="${uid}" aria-label="${esc(L("moveUp"))}" title="${esc(L("moveUp"))}"${idx === 0 ? " disabled" : ""}>↑</button>
        <button type="button" class="secondary" data-act="m-down" data-uid="${uid}" aria-label="${esc(L("moveDown"))}" title="${esc(L("moveDown"))}"${idx === g.models.length - 1 ? " disabled" : ""}>↓</button>
        <button type="button" class="secondary danger" data-act="m-remove" data-uid="${uid}">${esc(L("removeModel"))}</button>
      </footer>
    </section>`;
}

function chipsHtml(m, list) {
  const uid = esc(m.uid);
  return (m[list] || []).map((key, i) => {
    const name = itemName(catalog(), key, lang());
    const cost = Number(catalog().row(key)?.obols) || 0;
    return `<span class="bd-item">${esc(name)}${cost ? `<small>${cost}</small>` : ""}` +
      `<button type="button" data-act="m-del-item" data-uid="${uid}" data-list="${list}" data-i="${i}" aria-label="${esc(L("remove"))} ${esc(name)}">✕</button></span>`;
  }).join("");
}

/** Category headings for the add menu. */
const CAT_TITLE = {
  "basic-leader-traits":      ["Basic leader traits", "Rasgos básicos de líder"],
  "covenant-leader-traits":   ["Covenant leader traits", "Rasgos de líder de pacto"],
  "covenant-wretched-traits": ["Covenant traits", "Rasgos de pacto"],
  "wretched-undead-traits":   ["Wretched Undead traits", "Rasgos de No Muertos Miserables"],
  "melee-weapons":            ["Melee weapons", "Armas cuerpo a cuerpo"],
  "ranged-weapons":           ["Ranged weapons", "Armas a distancia"],
  "thrown-weapons":           ["Thrown weapons", "Armas arrojadizas"],
  "colossal-weapons":         ["Colossal weapons", "Armas colosales"],
  "armours":                  ["Armour", "Armaduras"],
  "miscellaneous-equipment":  ["Equipment", "Equipo misceláneo"],
};

/** One menu for everything a model can take, grouped as on the cards. */
function addMenuHtml(m, leader) {
  const uid = esc(m.uid);
  const group = (title, list, rows) => `<optgroup label="${esc(title)}">` + rows.map(([key, r]) => {
    const cost = Number(r.obols) || 0;
    return `<option value="${esc(`${list}|${key}`)}">${esc(pickField(r, "name", lang()))}${cost ? ` (${cost})` : ""}</option>`;
  }).join("") + `</optgroup>`;
  const cat = (c) => (catalog().bundle.categories[c]?.rows || []).map(r => [`${c}/${slug(r.name)}`, r]);
  const title = (c) => (lang() === "es" ? CAT_TITLE[c]?.[1] : CAT_TITLE[c]?.[0]) || c;
  const traitCats = leader ? TRAIT_CATEGORIES : ["covenant-wretched-traits", "wretched-undead-traits"];
  const groups = [
    ...traitCats.map(c => group(title(c), "traits", cat(c))),
    ...(leader ? spellGroups().map(([school, rows]) => group(`${L("spells")}: ${school}`, "spells", rows)) : []),
    ...WEAPON_CATEGORIES.map(c => group(title(c), "weapons", cat(c))),
    group(title("armours"), "armour", cat("armours")),
    group(title("miscellaneous-equipment"), "equipment", cat("miscellaneous-equipment")),
  ];
  return `<select class="bd-add" data-act="m-add" data-uid="${uid}" data-fid="${uid}-add">
      <option value="">${esc(L("addToModel"))}</option>${groups.join("")}</select>`;
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
  return `<span class="bd-mana">` + AFFINITIES.map(a => `
    <label class="aff-${a}">${esc(L(a))}
      <input type="number" min="0" max="9" data-act="m-mana" data-uid="${uid}" data-aff="${a}" data-fid="${uid}-mana-${a}" value="${Number(m.mana?.[a]) || 0}">
    </label>`).join("") + `</span>`;
}

function addModelHtml(g) {
  const hasLeader = g.models.some(m => isLeaderKey(m.profile));
  const opts = (cat) => (catalog().bundle.categories[cat]?.rows || []).map(r =>
    `<option value="${esc(`${cat}/${slug(r.name)}`)}">${esc(pickField(r, "name", lang()))} (${Number(r.obols) || 0})</option>`).join("");
  return `
    <div class="bd-add-model">
      ${g.models.length ? "" : `<p>${esc(L("noModels"))}</p>`}
      <select data-act="add-model" data-fid="add-model" class="bd-add">
        <option value="">${esc(L(hasLeader ? "addModel" : "addLeader"))}</option>
        ${hasLeader ? "" : `<optgroup label="${esc(L("leaders"))}">${opts("leaders")}</optgroup>`}
        <optgroup label="${esc(L("minions"))}">${opts("minions")}</optgroup>
      </select>
    </div>`;
}
