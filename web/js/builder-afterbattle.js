/**
 * Builder tab, after-battle sequence (rulebook p.65): a step-by-step wizard
 * run after each game — the battle, then 1 Reconstitution Maladies,
 * 2 Victory Rewards, 3 Minor Ambitions, 4 Ambitions, 5 Total Ambitions —
 * finishing with one battle-log entry. The Bazaar and the next scenario are
 * folds of the Campaign view (builder-bazaar.js), not steps.
 *
 * The sequence lives in the gathering (`campaign.afterBattle`), so leaving
 * the page and coming back resumes it at the same step. Every roll has a
 * Roll button and a field for a physical die. Applying goes through
 * builder/campaign.js; ambitions, treasures and lair upgrades reuse the
 * Campaign view's panels.
 */

import { icon } from "./lucide.js";
import { state } from "./state.js";
import { escapeHtml } from "./util.js";
import { pickField } from "./i18n.js";
import { treasureKind, evaluate } from "./builder/rules.js";
import { label, itemName } from "./builder/messages.js";
import {
  d, ensureCampaign, startAfterBattle, maladyFor, applyMalady, applyVictoryRewards, incomeUpgrades,
  applyLairIncome, applyPurloiner, finishAfterBattle, greaterOwed, rollTreasure,
} from "./builder/campaign.js";
import { val, select, opts, rollBtn } from "./builder-bazaar.js";
import { ambitionsHtml, pendingHtml, setPending, pendingTreasure, noticeHtml, uiError, deployNoteHtml } from "./builder-campaign.js";

const esc = escapeHtml;
const lang = () => state.lang || "en";
const L = (k) => label(k, lang());
const catalog = () => state.catalog;
const name = (key) => itemName(catalog(), key, lang());
const modelTitle = (m) => (m.name ? `${m.name} (${name(m.profile)})` : name(m.profile));
const isLeader = (m) => String(m.profile).startsWith("leaders/");

/* ---- checks before applying -------------------------------------------------- */

/** A die typed or rolled: a whole number from 1 to 10. */
const isDie = (v) => /^\s*(10|[1-9])\s*$/.test(String(v ?? ""));
/** The dice in these fields as numbers; a blank or a 0 is never applied. */
function readDice(...ids) {
  const vs = ids.map(val);
  if (!vs.every(isDie)) throw uiError("diceInvalid");
  return vs.map(Number);
}
/** `data-requires` on an Apply button: the fields it needs filled in. */
const requires = (...ids) => ` data-requires="${ids.join(" ")}"`;
const filled = (el) => !!el && (el.type === "number" ? isDie(el.value) : el.value !== "");

/**
 * Enable each Apply button only while the fields it needs hold a valid
 * value: every die 1-10, every choice made. Called after each redraw and on
 * every input, since typing a die doesn't redraw.
 */
export function syncRequired(root) {
  root.querySelectorAll("button[data-requires]").forEach(b => {
    b.disabled = !b.dataset.requires.split(" ").every(id => filled(document.getElementById(id)));
  });
}

/* ---- events ---------------------------------------------------------------- */

export function afterBattleChange(act, el, g) {
  const a = g.campaign?.afterBattle;
  if (!a) return false;
  const v = el.value;
  switch (act) {
    case "ab-field":       a.battle[el.dataset.field] = el.type === "checkbox" ? el.checked : (v || null); return true;
    case "ab-malady-roll": a.maladyRoll = Math.min(10, Math.max(1, parseInt(v, 10) || 1)); return true;
  }
  return false;
}

export function afterBattleClick(act, el, g) {
  ensureCampaign(g, catalog());
  if (act === "ab-open") { startAfterBattle(g, {}); return true; }
  const a = g.campaign.afterBattle;
  if (!a) return false;
  const { uid, key } = el.dataset;
  switch (act) {
    case "ab-step":    a.step = Math.max(0, Math.min(LAST, Math.min(a.step, LAST) + Number(el.dataset.by))); return true;
    case "ab-goto":    a.step = Math.max(0, Math.min(LAST, Number(el.dataset.step))); return true;
    case "ab-discard": if (confirm(L("confirmDiscard"))) delete g.campaign.afterBattle; return true;
    // 1 Maladies
    case "ab-roll-malady": a.maladyRoll = d(10); return true;
    case "ab-apply-malady": {
      const t = val("ab-mal-t");
      if (maladyFor(catalog(), a.maladyRoll)?.stat_by && !val("ab-mal-stat")) throw uiError("chooseStatFirst");
      applyMalady(g, catalog(), a.maladyRoll, { stat: val("ab-mal-stat") || null, treasure: t === "" ? null : Number(t) });
      return true;
    }
    // 2 Rewards
    case "ab-roll-rewards": a.rewardDice = [d(10), d(10)]; return true;
    case "ab-apply-rewards": applyVictoryRewards(g, catalog(), readDice("ab-d1", "ab-d2")); return true;
    case "ab-roll-treasure": setPending(g, { kind: "minor", source: "rewards", choices: rollTreasure(catalog(), "minor") }); return true;
    case "ab-income-roll": (a.incomeRolls ||= {})[key] = d(10); return true;
    case "ab-income": applyLairIncome(g, catalog(), key, readDice(`ab-inc-${key}`)[0]); return true;
    case "ab-purl-roll": (a.purlRolls ||= {})[uid] = [d(10), d(10)]; return true;
    case "ab-purl": {
      const move = evaluate(g, catalog()).models.find(x => x.uid === uid)?.stats.move ?? 0;
      applyPurloiner(g, uid, move, ...readDice(`ab-pr1-${uid}`, `ab-pr2-${uid}`));
      return true;
    }
    case "ab-finish": finishAfterBattle(g); return true;
  }
  return false;
}

/* ---- rendering ------------------------------------------------------------- */

/** "Roll" button + a field to type a physical die. */
const dieInput = (id, value, n = 1) =>
  `<input type="number" min="1" max="10" id="${id}" value="${value ?? ""}" class="bd-die" placeholder="d10" aria-label="${esc(L("die"))} ${n}">`;

/** The last step; Next stops here, where Finish is. */
const LAST = 5;

export function afterBattleHtml(g, ev) {
  const a = g.campaign.afterBattle;
  // A gathering saved when there were seven steps may be on a step that is gone.
  const step = Math.min(Math.max(0, Number(a.step) || 0), LAST);
  const steps = catalog().rules.after_battle || [];
  // The steps are a sequence, so they're numbered; the ones behind the
  // current step are marked done.
  const crumb = (n, text) => `<li class="${step === n ? "now" : step > n ? "done" : ""}">
      <button type="button" data-act="ab-goto" data-step="${n}"${step === n ? ' aria-current="step"' : ""}>${esc(text)}</button></li>`;
  const crumbs = `<ol class="bd-crumbs">${crumb(0, L("battle"))}${steps.map((s, n) => crumb(n + 1, pickField(s, "name", lang()))).join("")}</ol>`;
  // Phones show one progress line, "Step 4 of 5: …", instead of the full list
  // (the CSS picks one by width); Back and Next are the buttons below the step.
  const now = step === 0 ? L("battle")
    : L("stepOf").replace("{n}", step).replace("{total}", steps.length).replace("{name}", pickField(steps[step - 1] || {}, "name", lang()));
  const stepper = `<p class="bd-stepper" role="status" aria-label="${esc(L("afterBattleSteps"))}"><span class="bd-stepper-now">${esc(now)}</span></p>`;
  const body = STEPS[step](g, a, ev);
  return `
    <div class="bd-panel bd-wizard">
      <h3>${esc(L("afterBattleT"))}</h3>
      <p class="bd-hint">${esc(L("treasury"))} ${Number(g.treasury) || 0} ${esc(L("obols"))}, +${a.obols} ${esc(L("obolsAdded"))}.</p>
      ${crumbs}
      ${stepper}
      <div class="bd-step">${noticeHtml(g)}${body}</div>
      <div class="bd-inline bd-wizard-nav">
        <button type="button" class="secondary" data-act="ab-step" data-by="-1"${step === 0 ? " disabled" : ""}>${esc(L("back"))}</button>
        ${step < LAST ? `<button type="button" class="primary" data-act="ab-step" data-by="1">${esc(L(step === 0 ? "begin" : "next"))}</button>` : ""}
        <span class="spacer"></span>
        <button type="button" class="link danger" data-act="ab-discard">${esc(L("discardSequence"))}</button>
      </div>
    </div>`;
}

function battleStep(g, a) {
  const b = a.battle;
  const field = (f) => ` data-field="${f}"`;
  return `
    <div class="bd-form">
      <label>${esc(L("date"))} <input type="date" data-act="ab-field"${field("date")} value="${esc(b.date || "")}"></label>
      <label>${esc(L("environment"))} ${select("ab-env", opts("environments"), b.environment, { act: "ab-field", attrs: field("environment"), empty: L("none") })}</label>
      <label>${esc(L("mission"))} ${select("ab-mission", opts("missions"), b.mission, { act: "ab-field", attrs: field("mission"), empty: L("none") })}</label>
      <label>${esc(L("omen"))} ${select("ab-omen", opts("dread-omens"), b.omen, { act: "ab-field", attrs: field("omen"), empty: L("none") })}</label>
      <label>${esc(L("result"))} ${select("ab-result", ["win", "loss", "draw"].map(r => [r, L(r)]), b.result, { act: "ab-field", attrs: field("result") })}</label>
      <label class="bd-check"><input type="checkbox" data-act="ab-field"${field("leaderShattered")}${b.leaderShattered ? " checked" : ""}> ${esc(L("leaderShattered"))}</label>
      <label>${esc(L("notes"))} <input type="text" data-act="ab-field"${field("notes")} value="${esc(b.notes || "")}"></label>
    </div>
    ${deployNoteHtml(g)}`;
}

function stepText(key) {
  const s = (catalog().rules.after_battle || []).find(x => x.key === key);
  return s ? `<h4>${esc(pickField(s, "name", lang()))}</h4>` : "";
}

function maladiesStep(g, a) {
  const head = stepText("maladies");
  const hp = `<p class="bd-hint">${esc(L("fullHp"))}</p>`;
  if (!a.battle.leaderShattered) return `${head}<p>${esc(L("notShattered"))}</p>${hp}`;
  const done = a.done.maladies;
  if (done) {
    const def = maladyFor(catalog(), done.roll);
    return `${head}<p class="bd-good">${icon("check")} ${esc(L("applied"))}: ${done.roll} · <b>${esc(pickField(def, "name", lang()))}</b>${done.stat ? ` (${esc(L(done.stat))})` : ""}</p>
      <p>${esc(pickField(def, "effect", lang()))}</p>${hp}`;
  }
  const def = a.maladyRoll ? maladyFor(catalog(), a.maladyRoll) : null;
  const leader = g.models.find(isLeader);
  let choice = "";
  if (def?.stat_by) {
    choice = `<label>${esc(L(def.stat_by === "opponent" ? "opponentPicks" : "youPick"))}
      ${select("ab-mal-stat", ["move", "violence", "ranged"].map(s => [s, L(s)]), null, { empty: L("chooseAffinity") })}</label>`;
  } else if (def?.lose_minor_treasure) {
    const minor = (leader?.treasures || []).map((k, n) => [String(n), name(k)]).filter(([n]) => treasureKind(catalog(), leader.treasures[n]) === "minor");
    choice = minor.length
      ? `<label>${esc(L("opponentPicks"))} ${select("ab-mal-t", minor, null)}</label>`
      : `<p>${esc(L("noMinorOnLeader"))}</p>`;
  }
  return `${head}
    <div class="bd-inline">${rollBtn("ab-roll-malady")} ${esc(L("orType"))}
      <input type="number" min="1" max="10" class="bd-die" data-act="ab-malady-roll" value="${a.maladyRoll ?? ""}" placeholder="d10" aria-label="${esc(L("die"))}"></div>
    ${def ? `<p><b>${a.maladyRoll} · ${esc(pickField(def, "name", lang()))}</b> — ${esc(pickField(def, "effect", lang()))}</p>
      <div class="bd-inline">${choice}<button type="button" class="secondary" data-act="ab-apply-malady"${def.stat_by ? requires("ab-mal-stat") : ""}>${esc(L("apply"))}</button></div>` : ""}
    ${hp}`;
}

function rewardsStep(g, a) {
  const r = catalog().rules.victory_rewards?.[a.battle.result === "loss" ? "loss" : "win"] || {};
  const done = a.done.rewards;
  const dice = a.rewardDice || done?.dice || [];
  const main = done
    ? `<p class="bd-good">${icon("check")} +${done.obols} ${esc(L("obolsAdded"))} (${r.obols} + ${done.dice.join(" + ")})</p>`
    : `<p>${esc(L(a.battle.result === "loss" ? "loss" : "win"))}: ${r.obols} + 2d10</p>
       <div class="bd-inline">${rollBtn("ab-roll-rewards")} ${esc(L("orType"))} ${dieInput("ab-d1", dice[0])} ${dieInput("ab-d2", dice[1], 2)}
         <button type="button" class="secondary" data-act="ab-apply-rewards"${requires("ab-d1", "ab-d2")}>${esc(L("apply"))}</button></div>`;
  // While a rolled treasure waits to be handed out, its own panel holds the
  // roll; a second Roll button here would quietly re-roll it.
  const treasures = done && a.treasuresLeft > 0 && !pendingTreasure(g)
    ? `<div class="bd-inline"><b>${a.treasuresLeft}</b> ${esc(L("treasureRolls"))}
         <button type="button" class="secondary" data-act="ab-roll-treasure">${icon("dices")} ${esc(L("rollTreasure"))}</button></div>` : "";

  const income = incomeUpgrades(g, catalog()).map(k => {
    const got = a.done.income?.[k];
    return `<div class="bd-inline">${esc(name(k))}: ${got != null
      ? `<span class="bd-good">${icon("check")} +${got}</span>`
      : `${rollBtn("ab-income-roll", ` data-key="${esc(k)}"`)} ${dieInput(`ab-inc-${k}`, a.incomeRolls?.[k])}
         <button type="button" class="secondary" data-act="ab-income" data-key="${esc(k)}"${requires(`ab-inc-${esc(k)}`)}>${esc(L("apply"))}</button>`}</div>`;
  }).join("");
  const purl = g.models.filter(m => (m.traits || []).includes("wretched-undead-traits/purloiner")).map(m => {
    const got = a.done.purloiner?.[m.uid];
    const r2 = a.purlRolls?.[m.uid] || [];
    return `<div class="bd-inline">${esc(modelTitle(m))}: ${got != null
      ? `<span class="bd-good">${icon("check")} +${got}</span>`
      : `${rollBtn("ab-purl-roll", ` data-uid="${esc(m.uid)}"`)} ${dieInput(`ab-pr1-${m.uid}`, r2[0])} ${dieInput(`ab-pr2-${m.uid}`, r2[1], 2)}
         <small>${esc(L("ifUnderMove"))}</small>
         <button type="button" class="secondary" data-act="ab-purl" data-uid="${esc(m.uid)}"${requires(`ab-pr1-${esc(m.uid)}`, `ab-pr2-${esc(m.uid)}`)}>${esc(L("apply"))}</button>`}</div>`;
  }).join("");
  return `${stepText("rewards")}${main}${treasures}${pendingHtml(g)}
    ${income ? `<h4>${esc(L("lairIncome"))}</h4>${income}` : ""}
    ${purl ? `<h4>${esc(L("purloiner"))}</h4>${purl}` : ""}`;
}

const minorStep = (g) => `${stepText("minor")}<p class="bd-hint">${esc(L("stepMinor"))}</p>${ambitionsHtml(g)}`;
const ambitionsStep = (g) => `${stepText("ambitions")}<p class="bd-hint">${esc(L("stepAmbitions"))}</p>${pendingHtml(g)}${ambitionsHtml(g)}`;

function totalStep(g) {
  const owed = greaterOwed(g);
  const lost = g.campaign.afterBattle.treasuresLeft;
  return `${stepText("total")}<p class="bd-hint">${esc(L("stepTotal"))}</p>
    <p>${g.ambitions.completed} ${esc(L("completed"))}</p>
    ${owed > 0 ? "" : `<p>${esc(L("noneOwed"))}</p>`}${pendingHtml(g)}
    ${lost > 0 ? `<p class="bd-warn-line">${lost} ${esc(L("treasureRolls"))} — ${esc(L("rollsLost"))}</p>` : ""}
    ${deployNoteHtml(g)}
    <p><button type="button" class="primary" data-act="ab-finish" data-fid="ab-finish">${esc(L("finish"))}</button></p>`;
}

const STEPS = [battleStep, maladiesStep, rewardsStep, minorStep, ambitionsStep, totalStep];
