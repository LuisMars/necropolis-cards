/**
 * Builder tab, Campaign view — what a gathering carries between games
 * (rulebook pp.65-76): treasury and deployment, sellswords, lair upgrades,
 * ambitions, treasures, improvements and the battle log.
 *
 * Renders HTML for builder-tab.js and handles the `data-act` events it
 * forwards. Every change goes through builder/campaign.js on the clone that
 * builder-tab's `edit` hands over, so this module holds no gathering state
 * of its own — only, per gathering, the treasure a reward or a roll has left
 * to give out, the model picked for each ambition's reward, and the notice
 * saying why the last action didn't happen.
 */

import { icon } from "./lucide.js";
import { state } from "./state.js";
import { escapeHtml } from "./util.js";
import { pickField } from "./i18n.js";
import { slug } from "./builder/catalog.js";
import { campaignStarted, treasureKind, lairMods } from "./builder/rules.js";
import { label, itemName } from "./builder/messages.js";
import {
  ensureCampaign, startCampaign, buyUpgrade, refundUpgrade, tickAmbition, completeAmbition,
  greaterOwed, rewardTargets, rollTreasure, treasureTable, giveTreasure, moveTreasure,
  freeSellsword, hireSellsword, addBattle, removeBattle, undoAmbition, addManualEntry, removeLedgerEntry,
  takeGear, sellStashedGear, discardStashedGear, sellValue, spellTargets,
  setDeploymentBase, today,
} from "./builder/campaign.js";
import { maladiesOf } from "./builder/ledger.js";

const esc = escapeHtml;
const lang = () => state.lang || "en";
const L = (k) => label(k, lang());
const catalog = () => state.catalog;
const name = (key) => itemName(catalog(), key, lang());
const rows = (cat) => (catalog().bundle.categories[cat]?.rows || []).map(r => [`${cat}/${slug(r.name)}`, r]);
const modelTitle = (m) => (m.name ? `${m.name} (${name(m.profile)})` : name(m.profile));

/** A treasure waiting to be given out, by gathering id:
 *  {kind, choices?, greater?, source?}. Another gathering never sees it. */
const pendings = new Map();
const pendingOf = (g) => pendings.get(g.id) || null;
/** Queue a treasure to roll or pick (the after-battle rewards step uses it). */
export function setPending(g, p) { if (p) pendings.set(g.id, p); else pendings.delete(g.id); }
export const pendingTreasure = (g) => pendingOf(g);
/** Model (or spell) chosen for each completed ambition's reward, by
 *  gathering id and ambition key. */
const rewardPicks = new Map();
const pickKey = (g, key) => `${g.id}|${key}`;

/** Why the last action didn't happen, shown above the view it came from. */
let notice = null;   // {gid, text}
export function setNotice(g, text) { notice = g && text ? { gid: g.id, text } : null; }
export const noticeHtml = (g) => notice && notice.gid === g.id
  ? `<p class="bd-notice" role="alert">${icon("triangle-alert")}<span>${esc(notice.text)}</span></p>` : "";
/** An error whose message is already the player's words. */
export const uiError = (k) => Object.assign(new Error(L(k)), { ui: true });
/** The words for an action that threw: a UI check's own, then the label for
 *  the engine's error code ({code: "invalidDie"}) if it has one, else by
 *  action (the engine's own messages are for developers, in English). */
export function failText(act, err) {
  if (err?.ui) return err.message;
  if (err?.code && L(err.code) !== err.code) return L(err.code);
  const k = {
    "amb-complete": "chooseRewardFirst", "ab-apply-malady": "chooseStatFirst",
    "ab-apply-rewards": "diceInvalid", "ab-income": "diceInvalid", "ab-purl": "diceInvalid",
  }[act];
  return k ? L(k) : `${L("actionFailed")} ${err?.message || err}`;
}

/* ---- events ---------------------------------------------------------------- */

/** Handle a change event; returns true when it was a Campaign one. */
export function campaignChange(act, el, g) {
  const v = el.value;
  const { uid, from, i, key, stat } = el.dataset;
  ensureCampaign(g, catalog());
  switch (act) {
    case "treasury":    g.treasury = parseInt(v, 10) || 0; return true;
    case "deploy-base": setDeploymentBase(g, v); return true;
    case "opp-higher":  g.campaign.opponentHigher = el.checked; return true;
    case "field":       g.models.find(m => m.uid === uid).status = el.checked ? "active" : "reserve"; return true;
    case "hire":        if (v) hireSellsword(g, v, catalog()); return true;
    case "amb-add":     if (v && !g.ambitions.active.includes(v)) g.ambitions.active.push(v); return true;
    case "amb-target":  if (v) rewardPicks.set(pickKey(g, key), v); else rewardPicks.delete(pickKey(g, key)); return true;
    case "t-move":      if (v !== "") moveTreasure(g, from || null, Number(i), v === "stash" ? null : v); return true;
    case "t-add":       if (v) giveTreasure(g, v, null); return true;
    case "t-pick":      if (v && pendingOf(g)) setPending(g, { ...pendingOf(g), choices: [v] }); return true;
    case "g-give":      if (v) takeGear(g, v, Number(i)); return true;
  }
  return false;
}

/** Handle a click; returns true when it was a Campaign one. */
export function campaignClick(act, el, g) {
  const { uid, key, i, step, from } = el.dataset;
  ensureCampaign(g, catalog());
  switch (act) {
    case "start":          startCampaign(g, catalog()); return true;
    case "start-built":    startCampaign(g, catalog(), { alreadyBuilt: true }); return true;
    case "upgrade-buy":    buyUpgrade(g, key, catalog()); return true;
    case "upgrade-refund": refundUpgrade(g, key, catalog()); return true;
    case "free-rabble":    hireSellsword(g, "sellswords/desperate-rabble", catalog(), { free: true }); return true;
    case "amb-tick":       tickAmbition(g, key, catalog(), Number(step)); return true;
    case "amb-drop":       g.ambitions.active = g.ambitions.active.filter(k => k !== key); return true;
    case "amb-complete": {
      const spellReward = catalog().row(key)?.reward_effect?.target === "spell";
      const pick = rewardPicks.get(pickKey(g, key)) || null;
      const r = completeAmbition(g, key, catalog(), spellReward ? { spell: pick } : pick);
      rewardPicks.delete(pickKey(g, key));
      if (r.treasure) setPending(g, { kind: r.treasure, ambition: r.ambition });
      return true;
    }
    case "t-roll": {
      // A roll from the Treasures panel (data-manual) is a treasure from a
      // scenario or a house rule: it never counts as a greater treasure
      // claimed from ambitions. A re-roll in the pending strip keeps what
      // the pending treasure was for.
      const keep = el.dataset.manual ? {} : (pendingOf(g) || { greater: el.dataset.kind === "greater" });
      setPending(g, { ...keep, kind: el.dataset.kind, choices: rollTreasure(catalog(), el.dataset.kind) });
      return true;
    }
    case "t-claim-greater": setPending(g, { kind: "greater", greater: true }); return true;
    case "t-take": {
      const pending = pendingOf(g);
      const to = document.getElementById(`t-to-${el.dataset.take}`)?.value || null;
      giveTreasure(g, key, to, { greaterClaim: !!pending?.greater, ambition: pending?.ambition || null });
      if (pending?.source === "rewards" && g.campaign.afterBattle) g.campaign.afterBattle.treasuresLeft -= 1;
      setPending(g, null);
      return true;
    }
    case "t-cancel":       setPending(g, null); return true;
    case "g-sell":         sellStashedGear(g, catalog(), Number(i)); return true;
    case "g-discard":      discardStashedGear(g, Number(i)); return true;
    case "t-del": {
      const list = from ? g.models.find(m => m.uid === from).treasures : g.stash;
      list.splice(Number(i), 1);
      return true;
    }
    case "battle-add": {
      const val = (id) => document.getElementById(id)?.value || "";
      addBattle(g, {
        date: val("bl-date"), environment: val("bl-env"), mission: val("bl-mission"), omen: val("bl-omen"),
        result: val("bl-result"), obols: val("bl-obols"), notes: val("bl-notes").trim(),
      }, catalog());
      return true;
    }
    case "battle-del":     removeBattle(g, Number(i)); return true;
    case "led-add": {
      const amt = parseInt(document.getElementById("led-amt")?.value, 10);
      const who = document.getElementById("led-model")?.value;
      if (amt && who) addManualEntry(g, who, document.getElementById("led-stat")?.value,
                                     amt, (document.getElementById("led-note")?.value || "").trim());
      return true;
    }
    case "led-del":        removeLedgerEntry(g, uid, el.dataset.id); return true;
    case "amb-undo":       undoAmbition(g, el.dataset.id, catalog()); return true;
    case "amb-activate":   if (!g.ambitions.active.includes(key)) g.ambitions.active.push(key); return true;
  }
  return false;
}

/* ---- rendering ------------------------------------------------------------- */

export function campaignHtml(g, ev) {
  ensureCampaign(g, catalog());
  if (!campaignStarted(g)) {
    const left = (ev.budget ?? 0) - ev.total;
    return `${noticeHtml(g)}
      <div class="bd-panel">
        <p>${esc(L("notStarted"))} <b>${left} ${esc(L("obols"))}</b>.</p>
        <button type="button" class="primary" data-act="start">${esc(L("startCampaign"))}</button>
      </div>`;
  }
  const lead = `
    <div class="bd-lead">
      <button type="button" class="primary" data-act="ab-open">${esc(L("afterBattle"))}</button>
      <p>${esc(L("afterBattleLead"))}</p>
    </div>`;
  const changes = ev.models.reduce((n, e) => n + Object.values(e.sources || {}).flat()
    .filter(x => ["ambition", "malady", "manual"].includes(x.type)).length, 0);
  return [
    lead,
    noticeHtml(g),
    pendingHtml(g),
    fold("treasury", deploymentPanel(g, ev)),
    fold("ambitions", ambitionsPanel(g)),
    fold("treasures", treasuresPanel(g)),
    fold("upgrades", upgradesPanel(g), `${g.lair.upgrades.length} ${L("ownedCount")}`),
    fold("improvements", improvementsPanel(g, ev), changes ? `${changes} ${L(changes === 1 ? "changesCount1" : "changesCount")}` : ""),
    fold("history", historyPanel(g)),
    fold("log", battleLogPanel(g), `${g.history.length} ${L(g.history.length === 1 ? "battleCount1" : "battleCount")}`),
  ].join("");
}

/* Sections fold so the view leads with what's used every game. Their open
 * state survives redraws; these start open. */
const openFolds = new Set(["treasury", "ambitions", "treasures", "log"]);
export function setFold(id, open) { if (open) openFolds.add(id); else openFolds.delete(id); }

/** A panel's parts, {title, body} (the title as HTML), as a `.bd-panel`. */
const panel = ({ title, body }) => `<div class="bd-panel"><h3>${title}</h3>${body}</div>`;
/** The Ambitions and Lair upgrades panels, which the after-battle steps show too. */
export const ambitionsHtml = (g) => panel(ambitionsPanel(g));
export const upgradesHtml = (g) => panel(upgradesPanel(g));

/** A panel's parts as a folding section. */
function fold(id, { title, body }, meta = "") {
  return `<details class="bd-fold" data-fold="${id}"${openFolds.has(id) ? " open" : ""}>
    <summary><h3>${title}</h3>${meta ? `<span class="bd-fold-meta">${esc(meta)}</span>` : ""}</summary>
    <div class="bd-fold-body">${body}</div></details>`;
}

/** Purchases and sales, one line each: "Bought Blade (Aberrant Husk) −10". */
export function transactionsHtml(g, list) {
  if (!list?.length) return "";
  return `<ul class="bd-tx">${list.map(t => {
    const found = t.uid ? g.models.find(x => x.uid === t.uid) : null;
    // "Recruited Skeletal Husk" needs no "(Skeletal Husk)" after it.
    const m = found && !(t.item === found.profile && !found.name) ? found : null;
    const what = t.item ? (catalog().row(t.item) ? name(t.item)
      : pickField((catalog().rules.maladies || []).find(x => x.key === t.item) || {}, "name", lang()) || t.item) : "";
    const n = Number(t.obols) || 0;
    return `<li><span>${esc(L(`tx-${t.type}`))}</span> ${esc(what)}${m ? ` <small>(${esc(modelTitle(m))})</small>` : ""}` +
      `<b class="${n < 0 ? "down" : n > 0 ? "up" : ""}">${n > 0 ? "+" : ""}${n || ""}</b></li>`;
  }).join("")}</ul>`;
}

function deploymentPanel(g, ev) {
  const lm = lairMods(g, catalog());
  const base = g.deploymentLimit ?? catalog().rules.gathering?.deployment_limit ?? 350;
  const over = ev.fielded > ev.deploymentLimit;
  const fieldRows = g.models.map((m, i) => {
    const e = ev.models[i];
    const sw = e.isSellsword ? ` <span class="bd-tag">${esc(L("sellsword"))}</span>` : "";
    const cost = e.isSellsword
      ? `${e.cost} ${esc(L("rosterCost"))} · ${Number(catalog().row(m.profile)?.deploy_obols) || 0} ${esc(L("deployCost"))}`
      : e.cost;
    return `<label class="bd-field-row">
      <input type="checkbox" data-act="field" data-uid="${esc(m.uid)}" data-fid="${esc(m.uid)}-field"${(m.status || "active") === "active" ? " checked" : ""}>
      <span>${esc(modelTitle(m))}${sw}</span><small>${cost}</small></label>`;
  }).join("");
  const hires = rows("sellswords").filter(([, r]) => r.obols != null).map(([k, r]) =>
    `<option value="${esc(k)}">${esc(pickField(r, "name", lang()))} · ${r.obols} / ${r.deploy_obols}</option>`).join("");
  const free = freeSellsword(g, catalog());
  const rabble = free && !g.campaign.freeRabbleUsed
    ? `<button type="button" class="secondary" data-act="free-rabble">${esc(L("freeRabble"))}</button>` : "";
  return { title: `${esc(L("treasuryAndBattle"))}`, body: `
      <div class="bd-grid2">
      <div>
        <h4>${esc(L("treasury"))}</h4>
        <label class="bd-num"><input type="number" data-act="treasury" data-fid="c-treasury" value="${Number(g.treasury) || 0}"> ${esc(L("obols"))}</label>
        <label class="bd-num">${esc(L("deployBase"))} <input type="number" step="50" data-act="deploy-base" data-fid="c-deploy" value="${base}"></label>
        ${lm.deployment ? `<small>+${lm.deployment} ${esc(L("lairBonus"))}</small>` : ""}
        <p><span class="wb-chip ${over ? "over" : "good"}"><b>${ev.fielded}</b> / ${ev.deploymentLimit} ${esc(L("fielded"))}</span></p>
        ${g.campaign.transactions.length ? `<h4>${esc(L("sinceLastBattle"))}</h4>${transactionsHtml(g, g.campaign.transactions)}` : ""}
      </div>
      <div>
        <h4>${esc(L("nextBattle"))}</h4>
        <label class="bd-check"><input type="checkbox" data-act="opp-higher" data-fid="c-opp"${g.campaign.opponentHigher ? " checked" : ""}> ${esc(L("oppHigher"))}</label>
        ${free ? `<p class="bd-good">${esc(L("freeSellsword"))}</p>${rabble}` : ""}
        <div class="bd-fielded">${fieldRows}</div>
        <select data-act="hire" data-fid="c-hire" aria-label="${esc(L("hire"))}"><option value="">${esc(L("hire"))}</option>${hires}</select>
      </div>
      </div>` };
}

/** Modal-ish strip for a treasure waiting to be handed out. */
export function pendingHtml(g) {
  const pending = pendingOf(g);
  const owed = greaterOwed(g);
  const owedHtml = owed > 0 && !pending
    ? `<div class="bd-panel bd-callout"><b>${owed}</b> ${esc(L("greaterOwed"))}
         <button type="button" class="secondary" data-act="t-claim-greater">${esc(L("treasureToTake"))}</button></div>` : "";
  if (!pending) return owedHtml;
  const kind = pending.kind;
  const recipients = [`<option value="">${esc(L("stash"))}</option>`,
    ...g.models.map(m => `<option value="${esc(m.uid)}">${esc(modelTitle(m))}</option>`)].join("");
  const choices = (pending.choices || []).map((k, n) => `
      <span class="bd-choice">${esc(name(k))}
        <select id="t-to-${n}" aria-label="${esc(L("treasureFor").replace("{item}", name(k)))}">${recipients}</select>
        <button type="button" class="secondary" data-act="t-take" data-key="${esc(k)}" data-take="${n}">${esc(L("add").replace("…", ""))}</button>
      </span>`).join("");
  const table = treasureTable(catalog(), kind).map((k, n) =>
    `<option value="${esc(k)}">${["I","II","III","IV","V","VI","VII","VIII","IX","X"][n] || n + 1} · ${esc(name(k))}</option>`).join("");
  return `
    <div class="bd-panel bd-callout">
      <h3>${esc(L("treasureToTake"))} (${esc(L(kind === "greater" ? "greaterT" : "minorT"))})</h3>
      <div class="bd-inline">
        <button type="button" class="secondary" data-act="t-roll" data-kind="${kind}">${icon("dices")} ${esc(L(kind === "greater" ? "rollGreater" : "rollMinor"))}</button>
        <select data-act="t-pick" data-fid="c-tpick" aria-label="${esc(L("pickTreasure"))}"><option value="">${esc(L("pickTreasure"))}</option>${table}</select>
        <button type="button" class="secondary" data-act="t-cancel" aria-label="${esc(L("cancel"))}" title="${esc(L("cancel"))}">${icon("x")}</button>
      </div>
      ${choices ? `<div class="bd-choices">${choices}</div>` : ""}
    </div>`;
}

function ambitionsPanel(g) {
  const a = g.ambitions;
  const active = a.active.map(key => {
    const r = catalog().row(key) || {};
    const goal = Number(r.goal) || 1;
    const prog = a.progress[key] || 0;
    const eff = r.reward_effect || {};
    const done = prog >= goal;
    // A model for "choose" rewards; one of the leader's spells for "spell"
    // (Master Abyssal Artillery, p.67). Either goes to completeAmbition.
    const chooses = eff.target === "choose" || eff.target === "spell";
    const targets = eff.target === "choose"
      ? rewardTargets(g, catalog(), key).map(m => [m.uid, modelTitle(m)])
      : eff.target === "spell"
        ? spellTargets(g, catalog(), key).map(s => [s, name(s)])
        : [];
    // A pick only counts while it's still one of the choices (a model can
    // be removed, a spell forgotten, after it was picked).
    const picked = rewardPicks.get(pickKey(g, key));
    const chosen = targets.some(([v]) => v === picked) ? picked : null;
    const choose = L(eff.target === "spell" ? "chooseSpell" : "chooseModel_");
    const pick = chooses ? `<select data-act="amb-target" data-key="${esc(key)}" data-fid="c-amb-${esc(key)}" aria-label="${esc(choose)}">
        <option value="">${esc(choose)}</option>
        ${targets.map(([v, t]) => `<option value="${esc(v)}"${chosen === v ? " selected" : ""}>${esc(t)}</option>`).join("")}
      </select>` : "";
    const canComplete = done && (!chooses || chosen);
    return `
      <div class="bd-amb${done ? " done" : ""}">
        <div class="bd-amb-head">
          <b>${esc(name(key))}</b> <small>${esc(pickField(r, "restrictions", lang()) || "")}</small>
          <span class="spacer"></span>
          <button type="button" class="secondary" data-act="amb-tick" data-key="${esc(key)}" data-step="-1">−</button>
          <span class="bd-prog">${prog} / ${goal}</span>
          <button type="button" class="secondary" data-act="amb-tick" data-key="${esc(key)}" data-step="1">+</button>
          <button type="button" class="secondary" data-act="amb-drop" data-key="${esc(key)}" title="${esc(L("remove"))}" aria-label="${esc(L("remove"))}">${icon("x")}</button>
        </div>
        <div class="bd-amb-text">${esc(pickField(r, "condition", lang()) || "")} → ${esc(pickField(r, "reward", lang()) || "")}</div>
        ${done ? `<div class="bd-inline">${pick}<button type="button" class="secondary" data-act="amb-complete" data-key="${esc(key)}"${canComplete ? "" : " disabled"}>${esc(L("complete"))}</button></div>` : ""}
      </div>`;
  }).join("");
  const groups = new Map();
  for (const [k, r] of rows("ambitions")) {
    if (a.active.includes(k)) continue;
    const path = pickField(r, "restrictions", lang()) || "";
    if (!groups.has(path)) groups.set(path, []);
    groups.get(path).push(`<option value="${esc(k)}">${esc(pickField(r, "name", lang()))} (${r.goal})</option>`);
  }
  const add = [...groups].map(([p, os]) => `<optgroup label="${esc(p)}">${os.join("")}</optgroup>`).join("");
  return { title: `${esc(L("ambitions"))}`, body: `
      <p class="bd-hint">${a.active.length} ${esc(L("ofFourActive"))}, ${a.completed} ${esc(L("completed"))}.</p>
      ${active}
      <select data-act="amb-add" data-fid="c-amb-add" aria-label="${esc(L("addAmbition"))}"><option value="">${esc(L("addAmbition"))}</option>${add}</select>` };
}

function treasuresPanel(g) {
  const dests = (from) => [`<option value="">${esc(L("moveTo"))}</option>`,
    ...(from ? [`<option value="stash">${esc(L("stash"))}</option>`] : []),
    ...g.models.filter(m => m.uid !== from).map(m => `<option value="${esc(m.uid)}">${esc(modelTitle(m))}</option>`)].join("");
  const chip = (key, idx, from) => {
    const kind = treasureKind(catalog(), key);
    return `<span class="bd-item">${esc(name(key))} <small>${esc(L(kind === "greater" ? "greaterT" : "minorT"))}</small>
      <select data-act="t-move" data-from="${esc(from || "")}" data-i="${idx}" aria-label="${esc(L("moveTo"))}">${dests(from)}</select>
      <button type="button" data-act="t-del" data-from="${esc(from || "")}" data-i="${idx}" title="${esc(L("remove"))}" aria-label="${esc(L("remove"))}">${icon("x")}</button></span>`;
  };
  // Who holds treasures, the stash first: only those holding any.
  const shownHolders = [
    [L("stash"), null, g.stash],
    ...g.models.map(m => [modelTitle(m), m.uid, m.treasures || []]),
  ].filter(([, , list]) => list.length);
  const all = ["minor-treasures", "greater-treasures", "potions", "throwing-pots"].map(cat =>
    `<optgroup label="${esc(catalog().bundle.categories[cat]?.title || cat)}">` +
    rows(cat).map(([k, r]) => `<option value="${esc(k)}">${esc(pickField(r, "name", lang()))}</option>`).join("") + `</optgroup>`).join("");
  // The gear stash (not in the rulebook; see builder/campaign.js).
  const givers = (n, list) => `<select data-act="g-give" data-i="${n}" data-list="${list}" data-fid="c-gg-${n}" aria-label="${esc(L("giveTo"))}">` +
    `<option value="">${esc(L("giveTo"))}…</option>` +
    g.models.filter(m => !m.profile.startsWith("sellswords/")).map(m => `<option value="${esc(m.uid)}">${esc(modelTitle(m))}</option>`).join("") + `</select>`;
  const gear = (g.gearStash || []).map((e, n) => {
    const sells = e.list === "weapons" || e.list === "armour";
    return `<span class="bd-item">${esc(name(e.key))} <small>${esc(L(e.list))}</small>
      ${givers(n, e.list)}
      ${sells ? `<button type="button" class="bd-sell" data-act="g-sell" data-i="${n}">${esc(L("sell"))} +${sellValue(catalog(), e.key)}</button>` : ""}
      <button type="button" data-act="g-discard" data-i="${n}" title="${esc(L("discard"))}" aria-label="${esc(L("discard"))} ${esc(name(e.key))}">${icon("x")}</button></span>`;
  }).join("");
  const gearHtml = `
      <div class="bd-list bd-gear-stash"><h4>${esc(L("gearStash"))}</h4>
        <p class="bd-hint">${esc(L("gearStashHint"))}</p>
        <div class="bd-items">${gear || `<span class="bd-none">${esc(L("gearStashEmpty"))}</span>`}</div></div>`;
  return { title: `${esc(L("treasures"))}`, body: `
      ${shownHolders.length ? shownHolders.map(([title, uid, list]) => `
        <div class="bd-list"><h4>${esc(title)}</h4>
          <div class="bd-items">${list.map((k, n) => chip(k, n, uid)).join("")}</div></div>`).join("")
        : `<p class="bd-hint">${esc(L("noTreasures"))}</p>`}
      <div class="bd-inline">
        <select data-act="t-add" data-fid="c-tadd" aria-label="${esc(L("addTreasure"))}"><option value="">${esc(L("addTreasure"))}</option>${all}</select>
        <button type="button" class="secondary" data-act="t-roll" data-kind="minor" data-manual="1">${icon("dices")} ${esc(L("rollMinorTreasure"))}</button>
        <button type="button" class="secondary" data-act="t-roll" data-kind="greater" data-manual="1">${icon("dices")} ${esc(L("rollGreaterTreasure"))}</button>
      </div>
      ${greaterOwed(g) > 0 ? `<p class="bd-hint bd-owed">${esc(L("greaterOwedNote").replace("{n}", greaterOwed(g)))}
        <button type="button" class="link" data-act="t-claim-greater">${esc(L("claimIt"))}</button></p>` : ""}
      ${gearHtml}` };
}

function upgradesPanel(g) {
  const owned = new Set(g.lair.upgrades);
  const items = rows("lair-upgrades").map(([k, r]) => `
    <div class="bd-upgrade${owned.has(k) ? " owned" : ""}">
      <div><b>${esc(pickField(r, "name", lang()))}</b> <small>${r.obols}</small></div>
      <div class="bd-amb-text">${esc(String(pickField(r, "effect", lang()) || "").trim())}</div>
      ${owned.has(k)
        ? `<div class="bd-upgrade-act"><span class="bd-good">${icon("check")} ${esc(L("owned"))}</span> <button type="button" class="link" data-act="upgrade-refund" data-key="${esc(k)}">${esc(L("refundUpgrade"))}</button></div>`
        : `<button type="button" class="secondary" data-act="upgrade-buy" data-key="${esc(k)}">${esc(L("buy"))} · ${r.obols}</button>`}
    </div>`).join("");
  return { title: esc(L("lairUpgrades")), body: `<div class="bd-upgrades">${items}</div>` };
}

/** Who or what a stat change comes from, in words. */
function sourceLabel(src) {
  switch (src.type) {
    case "affinity": return `${L(src.key)} (${L("affinity")})`;
    case "manual":   return src.note || L("manualEntry");
    case "trait": case "lair": case "ambition": return name(src.key);
    case "malady": {
      const def = (catalog().rules.maladies || []).find(m => m.key === src.key);
      return def ? pickField(def, "name", lang()) : src.key;
    }
    default: return src.key || src.type;
  }
}
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/**
 * Per model: each stat's base, every change behind its value and the result
 * (W5-4). Manual entries can be removed here; an ambition's come off with
 * its Undo in the history, a malady's with the Soul Binder.
 */
function improvementsPanel(g, ev) {
  const shown = (st, v) => (v == null ? "—" : (st === "violence" || st === "ranged") ? `${v}+` : String(v));
  const CAMPAIGN = ["ambition", "malady", "manual", "lair"];
  const unchanged = [];
  const cards = g.models.map((m, i) => {
    const e = ev.models[i];
    if (e.isSellsword) return "";
    if (!Object.values(e.sources || {}).flat().some(x => CAMPAIGN.includes(x.type))) {
      unchanged.push(modelTitle(m));
      return "";
    }
    const stats = ["ap", "move", "violence", "ranged", "hp", ...(e.isLeader ? ["mana", "spells"] : [])];
    const final = { ...e.stats, mana: e.mana, spells: e.spellsAllowed };
    const capped = new Set(e.warnings.filter(w => w.code === "improvement-cap").map(w => w.params.stat));
    // Only stats something changed get a row, with every source behind them.
    const rowsHtml = stats.filter(st => (e.sources[st] || []).length).map(st => {
      const chips = (e.sources[st] || []).map(src => {
        const cls = src.amount > 0 ? "up" : "down";
        const when = src.battle ? ` <small>${esc(L("battle"))} ${src.battle}</small>` : "";
        const del = src.type === "manual"
          ? `<button type="button" data-act="led-del" data-uid="${esc(m.uid)}" data-id="${esc(src.id)}" aria-label="${esc(L("remove"))}">${icon("x")}</button>` : "";
        return `<span class="bd-src ${cls} t-${src.type}">${signed(src.amount)} ${esc(sourceLabel(src))}${when}${del}</span>`;
      }).join("");
      const base = st === "mana" || st === "spells" ? "" : shown(st, e.base[st]);
      return `<tr${capped.has(st) ? ' class="over"' : ""}><th>${esc(L(st))}</th><td>${base}</td>
        <td>${chips}</td><td><b>${shown(st, final[st])}</b></td></tr>`;
    }).join("");
    return `
      <div class="bd-ledger">
        <h4>${esc(modelTitle(m))}</h4>
        <table class="bd-table"><tr><th></th><th>${esc(L("base"))}</th><th>${esc(L("changes"))}</th><th>${esc(L("total"))}</th></tr>${rowsHtml}</table>
      </div>`;
  }).join("");
  const models = g.models.filter((m, i) => !ev.models[i].isSellsword)
    .map(m => `<option value="${esc(m.uid)}">${esc(modelTitle(m))}</option>`).join("");
  const statOpts = ["ap", "move", "violence", "ranged", "hp", "mana", "spells"]
    .map(st => `<option value="${st}">${esc(L(st))}</option>`).join("");
  return { title: `${esc(L("improvements"))}`, body: `
      <p class="bd-hint">${esc(L("improvementsHint"))}</p>
      ${cards}
      ${unchanged.length ? `<p class="bd-hint">${esc(L("noChangesYet"))} ${esc(unchanged.join(", "))}.</p>` : ""}
      <div class="bd-inline bd-led-form">
        <select id="led-model" aria-label="${esc(L("modelsLabel"))}">${models}</select>
        <select id="led-stat" aria-label="${esc(L("stat"))}">${statOpts}</select>
        <input type="number" id="led-amt" value="1" class="bd-die" aria-label="${esc(L("amount"))}">
        <input type="text" id="led-note" placeholder="${esc(L("reason"))}" aria-label="${esc(L("reason"))}">
        <button type="button" class="secondary" data-act="led-add">${esc(L("addChange"))}</button>
      </div>` };
}

/**
 * Completed ambitions (with Undo), maladies carried, and the progress kept
 * on ambitions that aren't active (W5-5).
 */
function historyPanel(g) {
  const log = [...g.ambitions.log].reverse().map(e => {
    const to = e.to ? g.models.find(m => m.uid === e.to) : null;
    const target = to ? modelTitle(to)
      : e.applied?.models?.length > 1 ? L("allModels")
      : e.applied?.deployment ? `+${e.applied.deployment} ${L("deployment")}`
      : e.applied?.bonus_traits ? L("bonusTrait") : "";
    return `<tr><td>${esc(e.date || "")}</td><td>${e.battle ? `${esc(L("battle"))} ${e.battle}` : ""}</td>
      <td>${esc(name(e.ambition))}</td><td>${esc(target)}</td>
      <td>${e.id ? `<button type="button" class="link" data-act="amb-undo" data-id="${esc(e.id)}">${esc(L("undo"))}</button>` : ""}</td></tr>`;
  }).join("");
  const maladies = g.models.flatMap(m => maladiesOf(m, catalog().rules).map(x => {
    const def = (catalog().rules.maladies || []).find(d => d.key === x.key) || {};
    return `<li>${esc(modelTitle(m))}: <b>${esc(pickField(def, "name", lang()) || x.key)}</b>${x.stat ? ` (${esc(L(x.stat))})` : ""}` +
      `${x.date ? ` · ${esc(x.date)}` : ""}${x.battle ? ` · ${esc(L("battle"))} ${x.battle}` : ""}</li>`;
  })).join("");
  const inactive = Object.entries(g.ambitions.progress || {})
    .filter(([k, n]) => n > 0 && !g.ambitions.active.includes(k))
    .map(([k, n]) => `<li>${esc(name(k))} · ${n} / ${Number(catalog().row(k)?.goal) || 1}
      <button type="button" class="secondary" data-act="amb-activate" data-key="${esc(k)}">${esc(L("makeActive"))}</button></li>`).join("");
  return { title: `${esc(L("history"))}`, body: `
      <h4>${esc(L("completedAmbitions"))}</h4>
      ${log ? `<div class="bd-table-wrap"><table class="bd-table">${log}</table></div>` : `<small>—</small>`}
      <h4>${esc(L("maladies"))}</h4>
      ${maladies ? `<ul class="bd-plain">${maladies}</ul>` : `<small>${esc(L("noMaladies"))}</small>`}
      <h4>${esc(L("inactiveProgress"))}</h4>
      ${inactive ? `<ul class="bd-plain">${inactive}</ul>` : `<small>—</small>`}` };
}

function battleLogPanel(g) {
  const opt = (cat, none) => `${none ? `<option value="">${esc(L("none"))}</option>` : ""}` +
    rows(cat).map(([k, r]) => `<option value="${esc(k)}">${esc(pickField(r, "name", lang()))}</option>`).join("");
  const res = (r) => (r ? L(r) : "—");
  const entries = g.history.map((e, n) => [e, n]).reverse().map(([e, n]) => `
    <tr><td>${esc(e.date || "")}</td><td>${esc(e.environment ? name(e.environment) : "—")}</td>
      <td>${esc(e.mission ? name(e.mission) : "—")}</td><td>${esc(e.omen ? name(e.omen) : "—")}</td>
      <td>${esc(res(e.result))}</td><td>${e.obols || 0}</td><td>${esc(e.notes || "")}</td>
      <td><button type="button" class="secondary" data-act="battle-del" data-i="${n}" title="${esc(L("remove"))}" aria-label="${esc(L("remove"))}">${icon("x")}</button></td></tr>
    ${(e.transactions || []).length ? `<tr class="bd-tx-row"><td></td><td colspan="7">${transactionsHtml(g, e.transactions)}</td></tr>` : ""}`).join("");
  return { title: `${esc(L("battleLog"))}`, body: `
      <div class="bd-table-wrap"><table class="bd-table bd-log">
        <tr><th>${esc(L("date"))}</th><th>${esc(L("environment"))}</th><th>${esc(L("mission"))}</th><th>${esc(L("omen"))}</th>
            <th>${esc(L("result"))}</th><th>${esc(L("obolsGained"))}</th><th>${esc(L("notes"))}</th><th></th></tr>
        ${entries || `<tr><td colspan="8"><small>${esc(L("noBattles"))}</small></td></tr>`}
      </table></div>
      <h4>${esc(L("logNew"))}</h4>
      <div class="bd-form bd-log-form">
        <label>${esc(L("date"))} <input type="date" id="bl-date" value="${today()}"></label>
        <label>${esc(L("environment"))} <select id="bl-env">${opt("environments", true)}</select></label>
        <label>${esc(L("mission"))} <select id="bl-mission">${opt("missions", true)}</select></label>
        <label>${esc(L("omen"))} <select id="bl-omen">${opt("dread-omens", true)}</select></label>
        <label>${esc(L("result"))} <select id="bl-result"><option value="win">${esc(L("win"))}</option><option value="loss">${esc(L("loss"))}</option><option value="draw">${esc(L("draw"))}</option></select></label>
        <label>${esc(L("obolsGained"))} <input type="number" id="bl-obols" value="0"></label>
        <label class="bd-log-notes">${esc(L("notes"))} <input type="text" id="bl-notes"></label>
      </div>
      <p><button type="button" class="secondary" data-act="battle-add">${esc(L("logBattle"))}</button></p>` };
}
