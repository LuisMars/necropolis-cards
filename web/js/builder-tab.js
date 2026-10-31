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
 * gathering exports (builder/appjson.js): the roster view renders it and
 * the importer's card matching queues its cards.
 *
 * The page is the Gatherings destination. Its view switch (Gathering /
 * Campaign / Roster) is driven by the address (main.js routes
 * #gatherings, #gatherings/campaign and #gatherings/roster to `setView`);
 * the buttons only ask for a new address.
 */

import { icon } from "./lucide.js";
import { state } from "./state.js";
import { $, escapeHtml, whenPointerFree } from "./util.js";
import { pickField } from "./i18n.js";
import { store, drafts } from "./gatherings.js";
import { applyPayload } from "./import.js";
import { evaluate, campaignStarted, AFFINITIES } from "./builder/rules.js";
import { newGathering, newModel } from "./builder/gathering.js";
import { toAppJson } from "./builder/appjson.js";
import { linkUrl, defaultWeapon } from "./builder/codec.js";
import { categoryOf, slug } from "./builder/catalog.js";
import { describe, label, itemName } from "./builder/messages.js";
import { buyGear, sellGear, recruit, record, stashGear, takeGear, channelBonuses } from "./builder/campaign.js";
import { initPicker, openPicker, openRemove, refreshPicker, stashable } from "./builder-picker.js";
import { campaignHtml, campaignChange, campaignClick, setFold, setNotice, failText } from "./builder-campaign.js";
import { afterBattleHtml, afterBattleChange, afterBattleClick, syncRequired } from "./builder-afterbattle.js";

const $pick   = $("bd-pick");
const $body   = $("bd-body");
const $newBtn = $("bd-new");
const $dupBtn = $("bd-dup");
const $delBtn = $("bd-del");
const $importBtn = $("bd-import");

let hooks = {};
let status = "";          // one line of feedback from the last action (HTML)
let summaryOpen = false;  // every warning listed, opened from the ledger
let view = "gathering";   // "gathering" (build), "campaign" or "roster"
let observer = null;      // marks the model card in view in the models list

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
  status = "";   // "Changes saved", a copied link… no longer describe it
  // Back to exactly what is saved: no draft needed.
  if (same(g, store.get(g.id))) drafts.remove(g.id);
  else drafts.set(g);
}

/** The roster sheet's data: the gathering on screen (its draft, if any) as
 *  the Companion App JSON the roster renders, or null with none open. */
export function rosterPayload() {
  const g = catalog() ? working() : null;
  return g ? toAppJson(g, catalog()) : null;
}

/** The view the address asks for; main.js renders afterwards. */
export function setView(v) {
  view = ["gathering", "campaign", "roster"].includes(v) ? v : "gathering";
}

/** Ask for a view: through the address when main.js routes, else directly. */
function goView(v) {
  if (hooks.navigate) hooks.navigate(v === "gathering" ? "gatherings" : `gatherings/${v}`);
  else { view = v; renderBuilder(); }
}

/** One line of feedback after cards were queued, with a way to the queue. */
// TODO plural: "1 cards"; switch cardsAdded to plural() once messages.js has it.
const queuedHtml = (n) => `${n} ${esc(L("cardsAdded"))} ` +
  `<button type="button" class="link" data-act="open-queue">${esc(L("openQueue"))}</button>`;

export function initBuilder({ onChange, navigate, onRender, rosterInfo, setRosterSkip }) {
  hooks = { onChange, navigate, onRender, rosterInfo, setRosterSkip };
  $newBtn.addEventListener("click", () => { store.save(newGathering()); status = ""; goView("gathering"); renderBuilder(); });
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
  initPicker({
    working,
    reasons: addReasons,
    add: (uid, value) => edit(g => pickerAdd(g, uid, value)),
    remove: (uid, list, i, how) => edit(g => {
      if (how === "sell") sellGear(g, catalog(), uid, list, i);
      else if (how === "stash") stashGear(g, catalog(), uid, list, i);
      else {   // equipment: it can't be sold (p.72)
        const [k] = findModel(g, uid)[list].splice(Number(i), 1);
        record(g, "discard", { item: k, uid });
      }
    }),
  });
  $body.addEventListener("click", onClick);
  // A die typed or a choice made (no redraw) can enable an Apply button.
  for (const t of ["input", "change"]) $body.addEventListener(t, () => syncRequired($body));
  // Folding sections remember whether they're open ("toggle" doesn't bubble).
  $body.addEventListener("toggle", (e) => { if (e.target.dataset?.fold) setFold(e.target.dataset.fold, e.target.open); }, true);
}

/* ---- editing --------------------------------------------------------------- */

/** Clone the working copy, let `fn` change it, keep it as the draft and
 *  redraw. The redraw waits a tick so a Tab key press lands its focus
 *  first, and waits for a pressed pointer to be released, so the button
 *  being clicked isn't replaced under it. A change that throws is dropped
 *  and says why. */
function edit(fn, act = "") {
  const cur = working();
  if (!cur) return;
  const g = structuredClone(cur);
  try {
    fn(g);
  } catch (err) {
    setNotice(cur, failText(act, err));
    redraw();
    return;
  }
  setNotice(null);
  keep(g);
  redraw();
}
const redraw = () => whenPointerFree(renderBuilder);

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
  if (act === "roster-skip") { hooks.setRosterSkip?.(el.checked); return; }
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
  }, act);
}

function onClick(e) {
  const el = e.target.closest("button[data-act]");
  if (!el) return;
  const { act, uid, list, i } = el.dataset;
  const g = working();
  switch (act) {
    case "new":     $newBtn.click(); return;
    case "view":    goView(el.dataset.view); return;
    case "import":  $importBtn.click(); return;
    case "open-queue": hooks.navigate?.("cards/queue"); return;
    case "save":    store.save(drafts.get(g.id)); drafts.remove(g.id); status = esc(L("saved")); renderBuilder(); return;
    case "discard": if (confirm(L("confirmDiscardDraft"))) { drafts.remove(g.id); status = ""; renderBuilder(); } return;
  }
  // Campaign and after-battle actions change a clone; only a handled one is
  // kept. One that throws (a die left blank, a reward with no model) keeps
  // nothing and says why where it was pressed.
  const clone = g ? structuredClone(g) : null;
  let handled = false;
  try {
    handled = !!clone && (afterBattleClick(act, el, clone) || campaignClick(act, el, clone));
  } catch (err) {
    setNotice(g, failText(act, err));
    redraw();
    return;
  }
  if (handled) {
    setNotice(null);
    keep(clone);
    redraw();
    return;
  }
  switch (act) {
    case "m-pick":     openPicker(uid, list, el.dataset.fid); break;
    case "m-del-item":
      // In a campaign, gear coming off a model is sold, kept in the stash
      // or thrown away: ask which (the free Improvised Weapon just goes).
      if (campaignStarted(g) && GEAR.includes(list) && stashable(findModel(g, uid)[list][Number(i)])) {
        openRemove(uid, list, i, `${uid}-add-${list}`);
        break;
      }
      edit(g => {
                         // In a campaign weapons and armour sell for half (p.72).
                         if (campaignStarted(g) && (list === "weapons" || list === "armour")) sellGear(g, catalog(), uid, list, i);
                         else {
                           const m = findModel(g, uid);
                           const [k] = m[list].splice(Number(i), 1);
                           // A model always has a weapon: the free Improvised one comes back (as in the engine).
                           if (list === "weapons" && !m.weapons.length) m.weapons.push(defaultWeapon(catalog(), m.profile));
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
    case "roster":     goView("roster"); break;
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

function queueCards(g) {
  const matches = applyPayload(toAppJson(g, catalog()), { queue: true });
  const n = matches.filter(m => m.target.kind !== "unmatched").length;
  hooks.onChange?.();
  status = queuedHtml(n);
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
  draw();
  // main.js keeps the roster sheet and the header in step with what's drawn.
  hooks.onRender?.();
}

/* ---- focus across a redraw ---------------------------------------------------
 * A redraw replaces every control, so the focused one is found again: by its
 * data-fid, else its id, else its action and the data it acts on (the ↑ of
 * model m3 is still the ↑ of m3 after it moved). When it's gone (a removed
 * chip, a model moved to the top), focus goes to the control now in its
 * place in the same model card, else to the next card, else to the control
 * at the same position on the page — never back to the top of the page. */

const CONTROLS = "button, input, select, textarea, summary";
const KEY_DATA = ["act", "uid", "list", "i", "key", "step", "by", "part", "from", "view", "take", "id", "kind", "field", "aff", "dest"];
const usable = (el) => el && !el.disabled && !el.closest("[hidden], details:not([open]) > :not(summary)");
/** The controls a player can reach, in order; a themed dropdown counts as its select. */
const controlsIn = (root) => [...root.querySelectorAll(CONTROLS)].filter(usable);
const sourceOf = (el) => el?.closest?.(".nc-select")?.querySelector(":scope > select") || el;

function focusMark() {
  const el = sourceOf(document.activeElement);
  if (!el || el === document.body || !$body.contains(el)) return null;
  const d = el.dataset || {};
  let sel = null;
  if (d.fid) sel = `[data-fid="${CSS.escape(d.fid)}"]`;
  else if (el.id) sel = `#${CSS.escape(el.id)}`;
  else if (d.act) sel = el.tagName.toLowerCase() + KEY_DATA.filter(k => d[k] != null)
    .map(k => `[data-${k}="${CSS.escape(d[k])}"]`).join("");
  const card = el.closest(".bd-model");
  const cards = [...$body.querySelectorAll(".bd-model")];
  return {
    sel,
    card: card?.id || null,
    cardIndex: card ? cards.indexOf(card) : -1,
    inCard: card ? controlsIn(card).indexOf(el) : -1,
    index: controlsIn($body).indexOf(el),
    isCard: el.classList?.contains("bd-model"),
  };
}

function restoreFocus(mark) {
  if (!mark) return;
  const exact = mark.sel && [...$body.querySelectorAll(mark.sel)].find(usable);
  if (exact) { exact.focus(); return; }
  if (mark.card) {
    const card = document.getElementById(mark.card);
    if (card && !mark.isCard) {
      const list = controlsIn(card);
      const el = list[Math.min(Math.max(mark.inCard, 0), list.length - 1)];
      (el || card).focus();
      return;
    }
    const cards = [...$body.querySelectorAll(".bd-model")];
    const next = card || cards[Math.min(mark.cardIndex, cards.length - 1)];
    if (next) { next.focus(); return; }
  }
  const list = controlsIn($body);
  list[Math.min(Math.max(mark.index, 0), list.length - 1)]?.focus();
}

function draw() {
  // Keep focus on the same control across the redraw.
  const focused = focusMark();

  const all = store.list();
  const g = working();
  $newBtn.textContent = L("newGathering");
  $importBtn.textContent = L("import");
  $dupBtn.textContent = L("duplicate");
  $delBtn.textContent = L("delete");
  // The empty state has its own buttons.
  $dupBtn.hidden = $delBtn.hidden = $newBtn.hidden = !g;
  $importBtn.hidden = !g && $importBtn.getAttribute("aria-expanded") !== "true";
  $pick.hidden = all.length < 2;
  // Nothing left in the toolbar (the empty state): no gap above the message.
  // Inline, since .bd-toolbar's display beats [hidden].
  $pick.closest(".bd-toolbar").style.display = !g && $importBtn.hidden ? "none" : "";
  $pick.innerHTML = all.map(x =>
    `<option value="${esc(x.id)}"${x.id === g?.id ? " selected" : ""}>${esc((drafts.get(x.id) || x).name || L("untitled"))}` +
    `${dirty(x) ? ` (${esc(L("unsavedShort"))})` : ""}</option>`).join("");

  if (!g) {
    $body.innerHTML = `<div class="bd-empty"><p>${esc(L("empty"))}</p>
      <button type="button" class="primary" data-act="new">${esc(L("newGathering"))}</button>
      <button type="button" class="secondary" data-act="import">${esc(L("import"))}</button></div>`;
    restoreFocus(focused);
    return;
  }
  const ev = evaluate(g, catalog());
  const head = `${viewTabsHtml()}${gatheringHeadHtml(g, ev)}${summaryOpen && ev.warnings.length ? warningSummaryHtml(g, ev) : ""}`;
  if (view === "roster") {
    $body.innerHTML = `<div class="bd-roster-head">${head}${rosterBarHtml(g)}</div>`;
  } else if (view === "campaign") {
    // The Campaign view has its own lists: no models sidebar.
    $body.innerHTML = `${head}<div class="bd-main bd-campaign">${g.campaign?.afterBattle ? afterBattleHtml(g, ev) : campaignHtml(g, ev)}</div>`;
  } else {
    $body.innerHTML = `${head}
      <div class="bd-layout">
        <div class="bd-main">
          ${campaignStarted(g) ? `<p class="bd-hint">${esc(L("campaignShop"))}</p>` : ""}
          ${g.models.length ? g.models.map((m, i) => modelHtml(g, m, ev.models[i], i)).join("") : `<p class="bd-hint">${esc(L("noModels"))}</p>`}
        </div>
        <aside class="bd-side">${modelsNavHtml(g, ev)}</aside>
      </div>`;
  }
  watchModels();
  syncRequired($body);

  restoreFocus(focused);
  refreshPicker();
}

function viewTabsHtml() {
  const b = (v, k) => `<button type="button" class="secondary" data-act="view" data-view="${v}" aria-pressed="${view === v}">${esc(L(k))}</button>`;
  return `<div class="bd-views" role="group" aria-label="${esc(L("workspace"))}">` +
    `${b("gathering", "viewGathering")}${b("campaign", "viewCampaign")}${b("roster", "viewRosterTab")}</div>`;
}

/** Above the roster: the Sheet / Cards switch (the A4 roster, or the
 *  gathering's own card sheets), and for the cards, skipping those already
 *  printed, how many there are, and queueing them to print with others. */
function rosterBarHtml(g) {
  const info = hooks.rosterInfo?.() || { part: "sheet", skip: false, cards: 0, sheets: 0 };
  const b = (part, route, k) => `<button type="button" class="secondary" data-route="${route}" aria-pressed="${info.part === part}">${esc(L(k))}</button>`;
  const cards = info.part === "cards" ? `
        <label class="bd-check"><input type="checkbox" data-act="roster-skip" data-fid="roster-skip"${info.skip ? " checked" : ""}> ${esc(L("skipOwned"))}</label>
        <span class="bd-roster-count">${esc(L("cardsSheets").replace("{cards}", info.cards).replace("{sheets}", info.sheets))}</span>` : "";
  return `
    <div class="bd-roster-bar">
      <div class="bd-roster-actions">
        <div class="bd-views nav-local" role="group" aria-label="${esc(L("rosterPart"))}">${b("sheet", "gatherings/roster", "rosterSheet")}${b("cards", "gatherings/roster/cards", "rosterCards")}</div>
        ${cards}
        <button type="button" class="secondary" data-act="cards">${esc(L("addCards"))}</button>
        ${status ? `<div class="bd-status" role="status">${status}</div>` : ""}
      </div>
    </div>`;
}

function draftHtml(g) {
  return dirty(g) ? `
      <div class="bd-draft" role="status">
        <p>${icon("triangle-alert")}<span>${esc(L("unsaved"))}</span></p>
        <button type="button" class="primary" data-act="save">${esc(L("saveChanges"))}</button>
        <button type="button" class="link" data-act="discard">${esc(L("discardChanges"))}</button>
      </div>` : "";
}

/** Rule warnings: amber, with a sign and the text, never colour alone. */
const warnList = (ws) => ws.length
  ? `<ul class="bd-warn" aria-label="${esc(L("ruleWarnings"))}">${ws.map(w => `<li>${icon("triangle-alert")}<span>${esc(describe(w, catalog(), lang()))}</span></li>`).join("")}</ul>`
  : "";

/**
 * The gathering's header, above every view: its name in blackletter, the
 * covenant and lair, the figures that matter (spend against budget,
 * treasury, deployment limit, models), the gathering's own warnings, the
 * draft's Save / Discard, and a secondary row of what to do with it.
 */
function gatheringHeadHtml(g, ev) {
  // Campaign and Roster lead with their own content: there the header keeps
  // the name, the figures and the warning count, and leaves the fields to
  // the Gathering view.
  const full = view === "gathering";
  const covs = (catalog().rules.covenants || []).map(c =>
    `<option value="${esc(c.key)}"${c.key === g.covenant ? " selected" : ""}>${esc(itemName(catalog(), c.key, lang()))}</option>`).join("");
  const lairs = (catalog().rules.lair_names || []).map(e =>
    `<option value="${e.roll}">${e.roll}. ${esc(pickField(e, "name", lang()))}</option>`).join("");

  const first = ev.budget != null;
  const over = first && ev.total > ev.budget;
  const pct = first ? Math.min(100, Math.round(ev.total / ev.budget * 100)) : 0;
  const fig = (k, v, extra = "", cls = "") =>
    `<div class="bd-fig${cls}"><dt>${esc(L(k))}</dt><dd>${v}${extra}</dd></div>`;
  const figures = [
    first
      ? fig("obolsSpent", `<b>${ev.total}</b> ${esc(L("of"))} ${ev.budget}`, `<span class="bd-meter"><span style="width:${pct}%"></span></span>`, over ? " over" : "")
      : fig("treasury", `<b>${Number(g.treasury) || 0}</b> ${esc(L("obols"))}`, "", Number(g.treasury) < 0 ? " over" : ""),
    first ? "" : fig("rosterValue", `<b>${ev.total}</b> ${esc(L("obols"))}`),
    fig("deploymentLimit", `<b>${ev.deploymentLimit}</b>`),
    fig("modelsLabel", `<b>${g.models.length}</b>`),
  ].join("");

  const own = ev.warnings.filter(w => !w.model);
  const n = ev.warnings.length;
  const warnings = n ? `
      <div class="bd-ledger-warn">
        ${full ? warnList(own) : ""}
        <button type="button" class="link bd-warn-toggle" data-act="summary" aria-expanded="${summaryOpen}">
          ${icon("triangle-alert")}<span>${esc(summaryOpen ? L("hideWarnings") : `${n} ${L(n === 1 ? "warning" : "warnings")}: ${L("showAll")}`)}</span></button>
      </div>` : `<p class="bd-good">${icon("check")} ${esc(L("noWarnings"))}</p>`;

  return `
    <section class="bd-ghead${full ? "" : " compact"}" aria-label="${esc(L("gathering"))}">
      ${draftHtml(g)}
      <input type="text" class="bd-gname" data-act="name" data-fid="g-name" value="${esc(g.name)}"
             placeholder="${esc(L("untitled"))}" aria-label="${esc(L("name"))}">
      ${full ? `<div class="bd-fields">
        <label class="bd-gfield">${esc(L("covenant"))}
          <select data-act="covenant" data-fid="g-cov"><option value="">${esc(L("chooseCovenant"))}</option>${covs}</select></label>
        <label class="bd-gfield">${esc(L("lair"))}
          <input type="text" data-act="lair-name" data-fid="g-lair" value="${esc(g.lair?.name || "")}" placeholder="${esc(L("lairPlaceholder"))}"></label>
        <div class="bd-lair-tools">
          <button type="button" class="link" data-act="lair-roll" data-fid="g-roll">${icon("dices")} ${esc(L("rollLair"))}</button>
          <select data-act="lair-pick" data-fid="g-lair-pick" aria-label="${esc(L("pickLair"))}"><option value="">${esc(L("pickLair"))}</option>${lairs}</select>
        </div>
      </div>` : ""}
      <dl class="bd-figs">${figures}</dl>
      ${first && full ? `<p class="bd-hint">${over ? "" : `${esc(L("firstBuildNote"))} `}<button type="button" class="link" data-act="start-built">${esc(L("alreadyBuilt"))}</button></p>` : ""}
      ${warnings}
      <div class="bd-actions">
        ${view === "roster" ? "" : `<button type="button" class="secondary" data-act="roster">${esc(L("viewRoster"))}</button>
        <button type="button" class="secondary" data-act="cards">${esc(L("addCards"))}</button>`}
        <details class="bd-share">
          <summary>${esc(L("shareExport"))} ${icon("chevron-down")}</summary>
          <div class="bd-share-menu">
            <button type="button" class="link" data-act="link">${esc(L("copyLink"))}</button>
            <button type="button" class="link" data-act="export">${esc(L("exportJson"))}</button>
            <button type="button" class="link" data-act="backup">${esc(L("backup"))}</button>
          </div>
        </details>
      </div>
      ${status && view !== "roster" ? `<div class="bd-status" role="status">${status}</div>` : ""}
    </section>`;
}

/**
 * The models list beside the cards (Gathering view): one row per model in
 * the gathering's order, leader first, each a jump to its card; the one in
 * view is marked (aria-current). "Add model" sits at the end.
 */
function modelsNavHtml(g, ev) {
  const rows = g.models.map((m, i) => {
    const e = ev.models[i];
    const type = itemName(catalog(), m.profile, lang());
    const w = e.warnings.length;
    return `<li><button type="button" class="bd-nav-model${e.isLeader ? " leader" : ""}" data-act="goto" data-uid="${esc(m.uid)}">
        <span class="bd-nav-name">${esc(m.name || type)}</span>
        ${m.name ? `<span class="bd-nav-type">${esc(type)}</span>` : ""}
        <span class="bd-nav-cost">${e.cost}</span>
        ${w ? `<span class="bd-nav-warn" title="${esc(`${w} ${L(w === 1 ? "warning" : "warnings")}`)}">${icon("triangle-alert")}<span class="bd-nav-n">${w}</span>` +
              `<span class="visually-hidden"> ${esc(L(w === 1 ? "warning" : "warnings"))}</span></span>` : ""}
      </button></li>`;
  }).join("");
  return `
    <nav class="bd-nav" aria-label="${esc(L("modelsLabel"))}">
      <h2 class="bd-nav-title">${esc(L("modelsLabel"))}</h2>
      ${rows ? `<ul class="bd-nav-list">${rows}</ul>` : ""}
      ${addModelHtml(g)}
    </nav>`;
}

/** Mark the model card in view in the models list: the last card whose top
 *  has passed the reading line under the sticky header (IntersectionObserver
 *  says when cards cross it; the geometry decides which one is current). */
function watchModels() {
  observer?.disconnect();
  onScrollModels = null;
  const cards = [...$body.querySelectorAll(".bd-model")];
  if (!cards.length || typeof IntersectionObserver !== "function") return;
  // The reading line: under the sticky header, about a third down the view.
  const line = () => Math.max((parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) + 40,
                              innerHeight * 0.3);
  const mark = (uid) => $body.querySelectorAll(".bd-nav-model").forEach(b => {
    if (b.dataset.uid === uid) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
  const update = () => {
    const y = line();
    const current = cards.filter(c => c.getBoundingClientRect().top <= y).pop() || cards[0];
    mark(current.id.replace(/^bd-model-/, ""));
  };
  observer = new IntersectionObserver(update, { threshold: [0, 0.25, 0.5, 0.75, 1] });
  cards.forEach(c => observer.observe(c));
  onScrollModels = update;
  update();
}
// Between threshold crossings (a long card, a smooth scroll that ends
// mid-card) the scroll position still decides: once per frame.
let onScrollModels = null, scrollQueued = false;
addEventListener("scroll", () => {
  if (scrollQueued || !onScrollModels) return;
  scrollQueued = true;
  requestAnimationFrame(() => { scrollQueued = false; if ($body.querySelector(".bd-nav")) onScrollModels?.(); });
}, { passive: true });

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

/** Scroll a model's card into view, move focus to it and mark it briefly.
 *  From the Campaign or Roster view, back to the Gathering view first. */
function gotoModel(uid) {
  if (view !== "gathering") { goView("gathering"); renderBuilder(); }
  const card = document.getElementById(`bd-model-${uid}`);
  if (!card) return;
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  card.focus({ preventScroll: true });
  $body.querySelectorAll(".bd-nav-model").forEach(b => {
    if (b.dataset.uid === uid) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
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

  // What it carries: every list the model can have, in the card's order,
  // each with its own add menu under its chips. Sellswords come armed.
  const swRow = sw ? catalog().row(m.profile) || {} : null;
  const list = (title, body, extra = "") =>
    `<div class="bd-list"><h4>${esc(title)}</h4><div class="bd-items">${body}</div>${extra}</div>`;
  let lists;
  if (sw) {
    lists = [list(L("armaments"), `<span class="bd-prose">${esc(String(pickField(swRow, "armaments", lang()) || "—"))}</span>`)];
  } else {
    lists = ADD_LISTS.filter(l => leader || !l.leader).map(l => l.list === "mana"
      ? list(L("mana"), manaHtml(m))
      : list(L(l.list), chipsHtml(m, l.list, g), addButtonHtml(m, l)));
  }

  return `
    <section class="bd-model${leader ? " leader" : ""}${m.affinity ? ` aff-${m.affinity}` : ""}" id="bd-model-${uid}" tabindex="-1" aria-label="${esc(m.name || typeName)}">
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
      <div class="bd-lists">${lists.join("")}</div>
      <footer class="bd-model-foot">
        <span class="spacer"></span>
        <button type="button" class="secondary" data-act="m-up" data-uid="${uid}" aria-label="${esc(L("moveUp"))}" title="${esc(L("moveUp"))}"${idx === 0 ? " disabled" : ""}>${icon("arrow-up")}</button>
        <button type="button" class="secondary" data-act="m-down" data-uid="${uid}" aria-label="${esc(L("moveDown"))}" title="${esc(L("moveDown"))}"${idx === g.models.length - 1 ? " disabled" : ""}>${icon("arrow-down")}</button>
        <button type="button" class="secondary danger" data-act="m-remove" data-uid="${uid}">${esc(L("removeModel"))}</button>
      </footer>
    </section>`;
}

function chipsHtml(m, list, g) {
  const uid = esc(m.uid);
  // Master Abyssal Artillery (p.67): +1 to channel the spell it was given to.
  const channel = list === "spells" ? channelBonuses(g) : {};
  if (!(m[list] || []).length) return `<span class="bd-none">${esc(L("noneYet"))}</span>`;
  return m[list].map((key, i) => {
    const name = itemName(catalog(), key, lang());
    const cost = Number(catalog().row(key)?.obols) || 0;
    const bonus = channel[key] ? `<small class="bd-bonus">${esc(L("channelBonus").replace("{n}", channel[key]))}</small>` : "";
    return `<span class="bd-item">${esc(name)}${cost ? `<small>${cost}</small>` : ""}${bonus}` +
      `<button type="button" data-act="m-del-item" data-uid="${uid}" data-list="${list}" data-i="${i}" aria-label="${esc(L("remove"))} ${esc(name)}">${icon("x")}</button></span>`;
  }).join("");
}

/** The lists on a model card, in the card's order. `leader`: leaders only. */
const ADD_LISTS = [
  { list: "traits",    add: "addTrait" },
  { list: "spells",    add: "addSpell", leader: true },
  { list: "mana",      leader: true },
  { list: "weapons",   add: "addWeapon" },
  { list: "armour",    add: "addArmour" },
  { list: "equipment", add: "addEquipment" },
];

/** A list's "+ Add …" button: opens the picker (builder-picker.js). */
const addButtonHtml = (m, { list, add }) =>
  `<button type="button" class="secondary bd-add-btn" data-act="m-pick" data-uid="${esc(m.uid)}" data-list="${list}" ` +
  `data-fid="${esc(m.uid)}-add-${list}" aria-haspopup="dialog">${icon("plus")}${esc(L(add))}</button>`;

/** Rule warnings as comparable keys: which rule and what, not the counts. */
const warnKeys = (ws) => ws.map(w => `${w.code}|${w.model || ""}|${w.item || ""}`);

/**
 * Why each picker row would break a rule: value → the text of the first
 * warning it would add. Each is tried on a copy of the gathering through
 * the path the picker takes (addItem, so a campaign buys it; takeGear for
 * the stash), evaluated by the rules engine, and compared with now.
 */
function addReasons(uid, values) {
  const g = working();
  const out = new Map();
  if (!g || !findModel(g, uid)) return out;
  const before = new Map();
  for (const k of warnKeys(evaluate(g, catalog()).warnings)) before.set(k, (before.get(k) || 0) + 1);
  for (const value of values) {
    const trial = structuredClone(g);
    pickerAdd(trial, uid, value);
    const left = new Map(before);
    const fresh = evaluate(trial, catalog()).warnings.filter(w => {
      const k = warnKeys([w])[0];
      const n = left.get(k) || 0;
      if (n) left.set(k, n - 1);
      return !n;
    });
    // The model's own rule first (hands, armour…), then the gathering's.
    const added = fresh.find(w => w.model === uid) || fresh[0];
    if (added) out.set(value, describe(added, catalog(), lang()));
  }
  return out;
}

/** What the picker adds: "list|key" through addItem (the m-add path), or
 *  "stash|i" from the campaign's gear stash, free. */
function pickerAdd(g, uid, value) {
  const [list, key] = value.split("|");
  if (list === "stash") takeGear(g, uid, Number(key));
  else if (list && key) addItem(g, findModel(g, uid), list, key);
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
      <select data-act="add-model" data-fid="add-model" class="bd-add" aria-label="${esc(L(hasLeader ? "addModel" : "addLeader"))}">
        <option value="">${esc(L(hasLeader ? "addModel" : "addLeader"))}</option>
        ${hasLeader ? "" : `<optgroup label="${esc(L("leaders"))}">${opts("leaders")}</optgroup>`}
        <optgroup label="${esc(L("minions"))}">${opts("minions")}</optgroup>
      </select>
    </div>`;
}
