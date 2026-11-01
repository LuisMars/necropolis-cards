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
import { state, saveQueue } from "./state.js";
import { $, escapeHtml, whenPointerFree } from "./util.js";
import { pickField } from "./i18n.js";
import { store, drafts } from "./gatherings.js";
import { applyPayload, payloadCards } from "./import.js";
import { evaluate, campaignStarted, AFFINITIES, allowedAffinities as allowedFor, forcedAffinity, applyForcedAffinities, lockMana } from "./builder/rules.js";
import { newGathering, newModel } from "./builder/gathering.js";
import { toAppJson } from "./builder/appjson.js";
import { linkUrl, defaultWeapon } from "./builder/codec.js";
import { categoryOf, slug } from "./builder/catalog.js";
import { describe, label, itemName, plural, fill } from "./builder/messages.js";
import {
  buyGear, sellGear, discardGear, recruitPrice, recruit, record, stashGear, takeGear, channelBonuses, startingWeapon,
  weaponLocked, buyPrice, deployCosts, payDeployment,
} from "./builder/campaign.js";
import { initPicker, openPicker, openRemove, openChoice, refreshPicker, stashable } from "./builder-picker.js";
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
  const g = cur ? drafts.get(cur.id) || cur : null;
  // A stored model whose keyword is forced but unset or wrong is shown
  // corrected (on a copy: nothing stored changes until the player edits).
  if (g && catalog()) {
    const fixed = structuredClone(g);
    const a = applyForcedAffinities(fixed, catalog());
    const b = lockMana(fixed, catalog());
    if (a || b) return fixed;
  }
  return g;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Does this gathering have changes that aren't saved? */
const dirty = (g) => !!g && !!drafts.get(g.id) && !same(drafts.get(g.id), store.get(g.id));

/** Does the gathering on screen have unsaved changes? (main.js: Print yields to Save.) */
export const hasDraft = () => dirty(store.current());

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
const queuedHtml = (n) => `${esc(plural("cardsAddedN", n, lang()))} ` +
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
  // The ⋯ menu closes on a choice, on Escape and on a tap outside it.
  const $more = document.getElementById("bd-more");
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
      else discardGear(g, catalog(), uid, list, i);
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
    const before = manaAllowances(g);
    fn(g);
    // Covenant-locked mana follows the allowance, except while the player sets it.
    if (act !== "m-mana") lockMana(g, catalog(), { topUp: manaAllowances(g) !== before });
  } catch (err) {
    setNotice(cur, failText(act, err));
    redraw();
    return;
  }
  setNotice(null);
  keep(g);
  redraw();
}
/** Each leader's mana allowance, as a string to compare before and after an edit. */
const manaAllowances = (g) => evaluate(g, catalog()).models.map(e => e.isLeader ? e.mana : "").join();
const redraw = () => whenPointerFree(renderBuilder);

const findModel = (g, uid) => g.models.find(m => m.uid === uid);
const isLeaderKey = (key) => categoryOf(key) === "leaders";

const allowedAffinities = (key) => allowedFor(catalog(), key);
const forced = (g, key) => forcedAffinity(g, key, catalog());

/** A new model of type `key`, set up the way the rulebook starts it. */
function addModel(g, key) {
  const m = newModel(g, {
    profile: key,
    affinity: forced(g, key),
    weapons: [startingWeapon(catalog(), key)],
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
  applyForcedAffinities(g, catalog());
}

function changeProfile(g, m, key) {
  const wasLeader = isLeaderKey(m.profile);
  const started = m.weapons.length === 1 ? startingWeapon(catalog(), m.profile) : null;
  m.profile = key;
  const allowed = allowedAffinities(key);
  const force = forced(g, key);
  if (force) m.affinity = force;
  else if (!allowed.includes(m.affinity)) m.affinity = null;
  if (isLeaderKey(key) && !wasLeader) {
    if (!m.spells.includes("spells/summon")) m.spells.unshift("spells/summon");
    const cov = catalog().covenant(g.covenant);
    if (cov?.leader_trait && !m.traits.includes(cov.leader_trait)) m.traits.unshift(cov.leader_trait);
  }
  // A model still on the weapon it started with gets the new type's (colossal,
  // a beast's Claws and Fangs, or the free Improvised one). In a campaign only
  // the free one is swapped: a paid weapon stays, and a weapon that costs is bought.
  if (m.weapons.length !== 1) return;
  const next = startingWeapon(catalog(), key);
  const free = /improvised-weapon$/.test(m.weapons[0]);
  const inCampaign = campaignStarted(g);
  if (m.weapons[0] === next || !(free || (!inCampaign && m.weapons[0] === started))) return;
  if (inCampaign && buyPrice(g, catalog(), next)) buyGear(g, catalog(), m.uid, "weapons", next);
  else m.weapons = [next];
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
        if (campaignStarted(g) && categoryOf(v) === "minions") recruit(g, catalog(), v);
        else addModel(g, v);
        break;
      case "m-name":     m.name = v.trim(); break;
      case "m-profile":  changeProfile(g, m, v); break;
      case "m-aff":      m.affinity = v || null; break;
      case "m-mana":     m.mana = { ...m.mana, [aff]: Math.max(0, parseInt(v, 10) || 0) }; break;
    }
  }, act);
}

/**
 * Campaign and after-battle actions change a clone; only a handled one is
 * kept. One that throws (a die left blank, a reward with no model) keeps
 * nothing and says why where it was pressed. `before` runs on the clone first.
 * @returns {boolean} true when the action was theirs
 */
function campaignAct(act, el, g, before = null) {
  const clone = g ? structuredClone(g) : null;
  let handled = false;
  try {
    before?.(clone);
    handled = !!clone && (afterBattleClick(act, el, clone) || campaignClick(act, el, clone));
  } catch (err) {
    setNotice(g, failText(act, err));
    redraw();
    return true;
  }
  if (handled) {
    setNotice(null);
    keep(clone);
    redraw();
  }
  return handled;
}

/** The prompt before a battle is logged: pay for the sellsword, or don't. */
function askDeployment(g, act, el) {
  const { due, total } = deployCosts(g, catalog());
  const names = due.map(x => { const m = findModel(g, x.uid); return m.name || itemName(catalog(), x.key, lang()); }).join(", ");
  openChoice({
    title: L("deployPayTitle"),
    note: fill(L("deployPayNote"), { names }),
    choices: [{ how: "pay", text: fill(L("deployPay"), { n: total }) }, { how: "skip", text: L("deployNoPay") }],
    fid: el.dataset.fid,
    onPick: (how) => campaignAct(act, el, working(), how === "pay" ? (c) => payDeployment(c, catalog()) : null),
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
  // Logging a battle with a sellsword deployed asks whether to pay for it
  // first (p.74). Nothing is charged unless the player chooses to.
  if (g && (act === "battle-add" || act === "ab-finish") && deployCosts(g, catalog()).total) {
    askDeployment(g, act, el);
    return;
  }
  if (campaignAct(act, el, g)) return;
  switch (act) {
    case "m-pick":     openPicker(uid, list, el.dataset.fid); break;
    case "m-mana": {   // the − / + steppers: 0 to 9, a click at the end changes nothing
      const { aff, by } = el.dataset;
      edit(g => {
        const m = findModel(g, uid);
        const n = Math.min(9, Math.max(0, (Number(m.mana?.[aff]) || 0) + Number(by)));
        m.mana = { ...m.mana, [aff]: n };
      }, act);
      break;
    }
    case "m-del-item": {
      const m = findModel(g, uid);
      // A beast's last weapon stays (its ✕ isn't drawn).
      if (weaponLocked(catalog(), m, list, i)) break;
      // In a campaign, gear coming off a model is sold or kept in the stash:
      // ask which (the free Improvised Weapon just goes).
      if (campaignStarted(g) && GEAR.includes(list) && stashable(m[list][Number(i)])) {
        openRemove(uid, list, i, `${uid}-add-${list}`);
        break;
      }
      const remove = () => edit(g => {
        const m = findModel(g, uid);
        m[list].splice(Number(i), 1);
        // A model always has a weapon: the free Improvised one comes back (as in the engine).
        if (list === "weapons" && !m.weapons.length) m.weapons.push(defaultWeapon(catalog(), m.profile));
      });
      // p.17: traits can't be removed once taken, but a campaign can have a
      // mistake to fix, so it asks rather than refuses. Before it, try freely.
      if (list === "traits" && campaignStarted(g)) {
        openChoice({
          title: fill(L("removeTitle"), { item: itemName(catalog(), m.traits[Number(i)], lang()), model: m.name || itemName(catalog(), m.profile, lang()) }),
          note: L("removeTraitNote"),
          choices: [{ how: "remove", text: L("removeAnyway") }],
          fid: `${uid}-add-traits`,
          onPick: remove,
        });
        break;
      }
      remove();
      break;
    }
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

/** A queue entry as a multiset key: the card and the row it prints. */
const queueKey = (e) => `${e.key}|${e.row?.name ?? ""}`;

/** The gathering's generated cards against the queue: which copies are
 *  missing from it (add only these), and whether all of them are queued. */
function queueStatus(g) {
  const cards = payloadCards(toAppJson(g, catalog()));
  const have = new Map();
  for (const e of state.queue) have.set(queueKey(e), (have.get(queueKey(e)) || 0) + 1);
  const missing = [];
  for (const c of cards) {
    const k = queueKey(c), n = have.get(k) || 0;
    if (n) have.set(k, n - 1); else missing.push(c);
  }
  return { cards, missing, all: cards.length > 0 && !missing.length };
}

/** The "Add / Remove cards to queue" button: always secondary (Print leads). */
function queueButtonHtml(g) {
  const all = queueStatus(g).all;
  return `<button type="button" class="secondary" data-act="cards">${esc(L(all ? "removeCards" : "addCards"))}</button>`;
}

function queueCards(g) {
  const q = queueStatus(g);
  applyPayload(toAppJson(g, catalog()), { queue: false });   // the roster follows this gathering
  if (q.all) {
    // One matching copy per generated card; other queue entries stay.
    for (const c of q.cards) {
      const i = state.queue.findIndex(e => queueKey(e) === queueKey(c));
      if (i >= 0) state.queue.splice(i, 1);
    }
    saveQueue();
    hooks.onChange?.();
    status = `${esc(plural("cardsRemovedN", q.cards.length, lang()))} <button type="button" class="link" data-act="open-queue">${esc(L("openQueue"))}</button>`;
  } else {
    state.queue.push(...q.missing);
    saveQueue();
    hooks.onChange?.();
    status = queuedHtml(q.missing.length);
  }
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
  document.getElementById("bd-more").hidden = $dupBtn.hidden && $importBtn.hidden;
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
  const head = `${viewTabsHtml()}${gatheringHeadHtml(g, ev)}${summaryOpen && hiddenWarnings(ev) ? warningSummaryHtml(g, ev) : ""}`;
  if (view === "roster") {
    $body.innerHTML = `<div class="bd-roster-head">${head}${rosterBarHtml(g)}</div>${draftHtml(g)}`;
  } else if (view === "campaign") {
    // The Campaign view has its own lists: no models sidebar.
    $body.innerHTML = `${head}<div class="bd-main bd-campaign">${g.campaign?.afterBattle ? afterBattleHtml(g, ev) : campaignHtml(g, ev)}</div>${draftHtml(g)}`;
  } else {
    $body.innerHTML = `${head}
      <div class="bd-layout">
        <div class="bd-main">
          ${campaignStarted(g) ? `<p class="bd-hint">${esc(L("campaignShop"))}</p>` : ""}
          ${g.models.length ? g.models.map((m, i) => modelHtml(g, m, ev.models[i], i)).join("") : `<p class="bd-hint">${esc(L("noModels"))}</p>`}
        </div>
        <aside class="bd-side">${modelsNavHtml(g, ev)}</aside>
      </div>${draftHtml(g)}`;
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
        ${queueButtonHtml(g)}
        ${status ? `<div class="bd-status" role="status">${status}</div>` : ""}
      </div>
    </div>`;
}

function draftHtml(g) {
  return dirty(g) ? `
      <div class="bd-draft" role="status">
        <p>${esc(L("unsaved"))}</p>
        <button type="button" class="primary" data-act="save" aria-label="${esc(L("saveChanges"))}"><span class="long">${esc(L("saveChanges"))}</span><span class="short" aria-hidden="true">${esc(L("saveShort"))}</span></button>
        <button type="button" class="secondary" data-act="discard" aria-label="${esc(L("discardChanges"))}"><span class="long">${esc(L("discardChanges"))}</span><span class="short" aria-hidden="true">${esc(L("discardShort"))}</span></button>
      </div>` : "";
}

/** Rule warnings: amber, with a sign and the text, never colour alone. */
const warnList = (ws, cls = "") => ws.length
  ? `<ul class="bd-warn${cls}" aria-label="${esc(L("ruleWarnings"))}">${ws.map(w => `<li>${icon("triangle-alert")}<span>${esc(describe(w, catalog(), lang()))}</span></li>`).join("")}</ul>`
  : "";

/** A model named like its type ("Lich" the Lich) has no name of its own:
 *  the type is shown as the placeholder, and the stored name is untouched. */
const sameAsType = (name, type) => !!name && name.trim().toLowerCase() === String(type).trim().toLowerCase();

/** The field a model warning is about: shown inside that list or control. */
const WARN_FIELD = {
  "affinity-missing": "affinity", "affinity-not-allowed": "affinity", "covenant-keyword": "affinity",
  "duplicate-trait": "traits", "trait-requirement": "traits", "too-many-traits": "traits", "basic-trait-count": "traits",
  "covenant-leader-trait-missing": "traits", "foreign-covenant-trait": "traits", "unique-trait": "traits", "covenant-traits": "traits",
  "spell-count": "spells", "summon-missing": "spells", "spells-on-minion": "spells", "apprentice-spell": "spells", "covenant-spell-school": "spells",
  "mana-split": "mana",
  "weapon-not-allowed": "weapons", "too-many-hands": "weapons", "too-many-weapons": "weapons",
  "multiple-armour": "armour", "multiple-shields": "armour", "too-much-equipment": "equipment",
};
const ITEM_LISTS = ["traits", "spells", "weapons", "armour", "equipment"];
const warnField = (m, w) => WARN_FIELD[w.code] || (w.item && ITEM_LISTS.find(l => (m[l] || []).includes(w.item))) || null;

/** How many warnings are not already beside what they are about: all of
 *  them away from the Gathering view's cards. Zero means the summary has
 *  nothing to add. */
const hiddenWarnings = (ev) => (view === "gathering" ? 0 : ev.warnings.length);

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
        ${hiddenWarnings(ev) ? `<button type="button" class="link bd-warn-toggle" data-act="summary" aria-expanded="${summaryOpen}">
          ${icon("triangle-alert")}<span>${esc(summaryOpen ? L("hideWarnings") : `${n} ${L(n === 1 ? "warning" : "warnings")}: ${L("showAll")}`)}</span></button>` : ""}
      </div>` : `<p class="bd-good">${icon("check")} ${esc(L("noWarnings"))}</p>`;

  return `
    <section class="bd-ghead${full ? "" : " compact"}" aria-label="${esc(L("gathering"))}">
      <input type="text" class="bd-gname" data-act="name" data-fid="g-name" value="${esc(g.name)}"
             placeholder="${esc(L("untitled"))}" aria-label="${esc(L("name"))}">
      ${full ? `<div class="bd-fields">
        <label class="bd-gfield">${esc(L("covenant"))}
          <select data-act="covenant" data-fid="g-cov"><option value="">${esc(L("chooseCovenant"))}</option>${covs}</select></label>
        <label class="bd-gfield">${esc(L("lair"))}
          <input type="text" data-act="lair-name" data-fid="g-lair" value="${esc(g.lair?.name || "")}" placeholder="${esc(L("lairPlaceholder"))}"></label>
        <div class="bd-lair-tools">
          <button type="button" class="link" data-act="lair-roll" data-fid="g-roll">${icon("dices")} ${esc(L("rollLair"))}</button>
          <select data-act="lair-pick" data-fid="g-lair-pick" aria-label="${esc(L("pickLair"))}"><option value="">${esc(L("pickLairShort"))}</option>${lairs}</select>
        </div>
      </div>` : ""}
      <dl class="bd-figs">${figures}</dl>
      ${first && full ? `<p class="bd-hint">${over ? "" : `${esc(L("firstBuildNote"))} `}<button type="button" class="link" data-act="start-built">${esc(L("alreadyBuilt"))}</button></p>` : ""}
      ${warnings}
      <div class="bd-actions">
        ${view === "roster" ? "" : `<button type="button" class="secondary" data-act="roster">${esc(L("viewRoster"))}</button>
        ${queueButtonHtml(g)}`}
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
        ${m.name && !sameAsType(m.name, type) ? `<span class="bd-nav-type">${esc(type)}</span>` : ""}
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
  const force = forced(g, m.profile);
  const affChoices = [null, ...allowedAffinities(m.profile)];
  const shown = new Set();
  const inline = (field) => { shown.add(field); return warnList(e.warnings.filter(w => warnField(m, w) === field), " bd-warn-inline"); };
  const affinityHtml = force
    ? `<div class="bd-affinity-control bd-affinity-forced"><span class="bd-affinity-label">${esc(L("affinity"))}</span> ` +
      `<span class="bd-affinity-option aff-${force}"><span>${esc(L(force))}</span></span></div>`
    : `<fieldset class="bd-affinity-control"><legend>${esc(L("affinity"))}</legend>` +
    affChoices.map(a => {
      const val = a || "";
      const title = a ? L(a) : L("noAffinity");
      return `<label class="bd-affinity-option${a ? ` aff-${a}` : ""}">` +
        `<input type="radio" name="aff-${uid}" value="${esc(val)}" data-act="m-aff" data-uid="${uid}" ` +
        `data-fid="${uid}-aff-${esc(val || "none")}"${(m.affinity || "") === val ? " checked" : ""}` +
        `${a ? "" : ` aria-label="${esc(title)}"`}>` +
        `<span>${a ? esc(title) : "—"}</span></label>`;
    }).join("") + `</fieldset>`;
  const affinityWarn = inline("affinity");
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
      ? list(L("mana"), manaHtml(m, e.mana), inline("mana"))
      : list(L(l.list), chipsHtml(m, l.list, g), inline(l.list) + addButtonHtml(m, l)));
  }

  return `
    <section class="bd-model${leader ? " leader" : ""}${m.affinity ? ` aff-${m.affinity}` : ""}" id="bd-model-${uid}" tabindex="-1" aria-label="${esc(m.name || typeName)}">
      <header class="bd-model-head">
        <div class="bd-model-title">
          <input type="text" class="bd-model-name" data-act="m-name" data-uid="${uid}" data-fid="${uid}-name"
                 value="${esc(sameAsType(m.name, typeName) ? "" : m.name || "")}" placeholder="${esc(typeName)}" aria-label="${esc(L("modelName"))}">
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
      ${affinityWarn}
      <dl class="bd-stats">${stats}</dl>
      ${warnList(e.warnings.filter(w => !shown.has(warnField(m, w))))}
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
    // A beast's last weapon has no ✕: it needs one, and no free one replaces it.
    const locked = weaponLocked(catalog(), m, list, i);
    return `<span class="bd-item"${locked ? ` title="${esc(L("weaponLocked"))}"` : ""}>${esc(name)}${cost ? `<small>${cost}</small>` : ""}${bonus}` +
      (locked ? "" : `<button type="button" data-act="m-del-item" data-uid="${uid}" data-list="${list}" data-i="${i}" aria-label="${esc(L("remove"))} ${esc(name)}">${icon("x")}</button>`) + `</span>`;
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

/** What the picker adds: "list|key" through addItem, or
 *  "stash|i" from the campaign's gear stash, free. */
function pickerAdd(g, uid, value) {
  const [list, key] = value.split("|");
  if (list === "stash") takeGear(g, uid, Number(key));
  else if (list && key) addItem(g, findModel(g, uid), list, key);
}

function manaHtml(m, allowed) {
  const uid = esc(m.uid);
  const split = AFFINITIES.reduce((n, a) => n + (Number(m.mana?.[a]) || 0), 0);
  const left = allowed - split;
  const step = (a, by, v) => {
    const off = by < 0 ? v <= 0 : v >= 9;
    return `<button type="button" class="bd-step" data-act="m-mana" data-uid="${uid}" data-aff="${a}" data-by="${by}" ` +
      `data-fid="${uid}-mana-${a}${by < 0 ? "-dec" : "-inc"}" aria-label="${esc(L(by < 0 ? "manaLess" : "manaMore").replace("{k}", L(a)))}"` +
      `${off ? ' aria-disabled="true"' : ""}>${icon(by < 0 ? "minus" : "plus")}</button>`;
  };
  return `<span class="bd-mana">` + AFFINITIES.map(a => {
    const v = Number(m.mana?.[a]) || 0;
    return `<span class="bd-mana-row aff-${a}"><span class="bd-mana-name">${esc(L(a))}</span>` +
      `${step(a, -1, v)}<output class="bd-mana-n" data-aff="${a}">${v}</output>${step(a, 1, v)}</span>`;
  }).join("") +
    `<span class="bd-mana-left${left ? " off" : ""}" role="status">${esc(L(left >= 0 ? "manaLeft" : "manaOver").replace("{n}", Math.abs(left)).replace("{total}", allowed))}</span></span>`;
}

function addModelHtml(g) {
  const hasLeader = g.models.some(m => isLeaderKey(m.profile));
  // The price includes the weapon a new model starts with (a beast's Claws and Fangs).
  const opts = (cat) => (catalog().bundle.categories[cat]?.rows || []).map(r => {
    const key = `${cat}/${slug(r.name)}`;
    return `<option value="${esc(key)}">${esc(pickField(r, "name", lang()))} (${recruitPrice(campaignStarted(g) ? g : {}, catalog(), key)})</option>`;
  }).join("");
  return `
    <div class="bd-add-model">
      <select data-act="add-model" data-fid="add-model" class="bd-add" aria-label="${esc(L(hasLeader ? "addModel" : "addLeader"))}">
        <option value="">${esc(L(hasLeader ? "addModel" : "addLeader"))}</option>
        ${hasLeader ? "" : `<optgroup label="${esc(L("leaders"))}">${opts("leaders")}</optgroup>`}
        <optgroup label="${esc(L("minions"))}">${opts("minions")}</optgroup>
      </select>
    </div>`;
}
