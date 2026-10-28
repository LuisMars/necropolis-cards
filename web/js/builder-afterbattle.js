/**
 * Builder tab, after-battle sequence (rulebook p.65): a step-by-step wizard
 * run after each game — the battle, then 1 Reconstitution Maladies,
 * 2 Victory Rewards, 3 Minor Ambitions, 4 Ambitions, 5 Total Ambitions,
 * 6 The Bazaar, 7 Roll New Scenario — finishing with one battle-log entry.
 *
 * The sequence lives in the gathering (`campaign.afterBattle`), so leaving
 * the page and coming back resumes it at the same step. Every roll has a
 * Roll button and a field for a physical die. Applying goes through
 * builder/campaign.js; ambitions, treasures and lair upgrades reuse the
 * Campaign view's panels.
 */

import { state } from "./state.js";
import { escapeHtml } from "./util.js";
import { pickField } from "./i18n.js";
import { slug } from "./builder/catalog.js";
import { treasureKind, evaluate } from "./builder/rules.js";
import { label, itemName } from "./builder/messages.js";
import { defaultWeapon } from "./builder/codec.js";
import {
  d, ensureCampaign, startAfterBattle, maladyFor, applyMalady, applyVictoryRewards, incomeUpgrades,
  applyLairIncome, applyPurloiner, buyGear, buyPrice, recruit, sellGear, sellValue, sellTreasure,
  soulBinder, tombRobber, hasAlchemy, buyAlchemy, price, rollScenarioPart, canRerollOmen,
  finishAfterBattle, greaterOwed, rollTreasure, treasureTable,
} from "./builder/campaign.js";
import { ambitionsHtml, pendingHtml, upgradesHtml, setPending, pendingTreasure } from "./builder-campaign.js";
import { maladiesOf } from "./builder/ledger.js";

const esc = escapeHtml;
const lang = () => state.lang || "en";
const L = (k) => label(k, lang());
const catalog = () => state.catalog;
const name = (key) => itemName(catalog(), key, lang());
const rows = (cat) => (catalog().bundle.categories[cat]?.rows || []).map(r => [`${cat}/${slug(r.name)}`, r]);
const modelTitle = (m) => (m.name ? `${m.name} (${name(m.profile)})` : name(m.profile));
const val = (id) => document.getElementById(id)?.value ?? "";
const isLeader = (m) => String(m.profile).startsWith("leaders/");

/* ---- events ---------------------------------------------------------------- */

export function afterBattleChange(act, el, g) {
  const a = g.campaign?.afterBattle;
  if (!a) return false;
  const v = el.value;
  switch (act) {
    case "ab-field":       a.battle[el.dataset.field] = el.type === "checkbox" ? el.checked : (v || null); return true;
    case "ab-malady-roll": a.maladyRoll = Math.min(10, Math.max(1, parseInt(v, 10) || 1)); return true;
    case "ab-next":        a.next = { ...(a.next || {}), [el.dataset.part]: v || null }; return true;
    case "ab-omen-agree":  a.omenAgreed = el.checked; if (!el.checked) a.next = { ...(a.next || {}), omen: null }; return true;
    case "ab-tomb-pick":   a.tombRoll = v || null; return true;
  }
  return false;
}

export function afterBattleClick(act, el, g) {
  ensureCampaign(g, catalog());
  if (act === "ab-open") { startAfterBattle(g, {}); return true; }
  const a = g.campaign.afterBattle;
  if (!a) return false;
  const { uid, list, i, key, part } = el.dataset;
  switch (act) {
    case "ab-step":    a.step = Math.max(0, Math.min(7, a.step + Number(el.dataset.by))); return true;
    case "ab-goto":    a.step = Number(el.dataset.step); return true;
    case "ab-discard": if (confirm(L("confirmDiscard"))) delete g.campaign.afterBattle; return true;
    // 1 Maladies
    case "ab-roll-malady": a.maladyRoll = d(10); return true;
    case "ab-apply-malady": {
      const t = val("ab-mal-t");
      applyMalady(g, catalog(), a.maladyRoll, { stat: val("ab-mal-stat") || null, treasure: t === "" ? null : Number(t) });
      return true;
    }
    // 2 Rewards
    case "ab-roll-rewards": a.rewardDice = [d(10), d(10)]; return true;
    case "ab-apply-rewards": applyVictoryRewards(g, catalog(), [val("ab-d1"), val("ab-d2")]); return true;
    case "ab-roll-treasure": setPending({ kind: "minor", source: "rewards", choices: rollTreasure(catalog(), "minor") }); return true;
    case "ab-income-roll": (a.incomeRolls ||= {})[key] = d(10); return true;
    case "ab-income": applyLairIncome(g, catalog(), key, val(`ab-inc-${key}`)); return true;
    case "ab-purl-roll": (a.purlRolls ||= {})[uid] = [d(10), d(10)]; return true;
    case "ab-purl": {
      const move = evaluate(g, catalog()).models.find(x => x.uid === uid)?.stats.move ?? 0;
      applyPurloiner(g, uid, move, val(`ab-pr1-${uid}`), val(`ab-pr2-${uid}`));
      return true;
    }
    // 6 Bazaar
    case "ab-buy": {
      const [lst, k] = val("ab-buy-item").split("|");
      if (lst && k && val("ab-buy-model")) buyGear(g, catalog(), val("ab-buy-model"), lst, k);
      return true;
    }
    case "ab-recruit": if (val("ab-recruit-key")) recruit(g, catalog(), val("ab-recruit-key"), defaultWeapon(catalog(), val("ab-recruit-key"))); return true;
    case "ab-sell":    sellGear(g, catalog(), uid, list, i); return true;
    case "ab-sell-t":  sellTreasure(g, catalog(), el.dataset.from || null, i); return true;
    case "ab-soul":    soulBinder(g, catalog(), uid, el.dataset.ref); return true;
    case "ab-tomb-roll": a.tombRoll = rollTreasure(catalog(), "minor")[0]; return true;
    case "ab-tomb-take": if (a.tombRoll) tombRobber(g, catalog(), a.tombRoll, { pay: true, to: val("ab-tomb-to") || null }); return true;
    case "ab-tomb-decline": tombRobber(g, catalog(), a.tombRoll, { pay: false }); return true;
    case "ab-alchemy": if (val("ab-alc-key")) buyAlchemy(g, catalog(), val("ab-alc-key"), val("ab-alc-to") || null); return true;
    // 7 Scenario
    case "ab-roll-scn": {
      a.next = { ...(a.next || {}), [part]: rollScenarioPart(catalog(), part) };
      if (el.dataset.reroll) a.omenRerolled = true;
      return true;
    }
    case "ab-finish": {
      const n = a.next || {};
      finishAfterBattle(g, { environment: n.environments || null, mission: n.missions || null, omen: n["dread-omens"] || null });
      return true;
    }
  }
  return false;
}

/* ---- rendering ------------------------------------------------------------- */

/** "Roll" button + a field to type a physical die. */
const dieInput = (id, value) =>
  `<input type="number" min="1" max="10" id="${id}" value="${value ?? ""}" class="bd-die">`;
const rollBtn = (act, attrs = "") =>
  `<button type="button" class="secondary" data-act="${act}"${attrs}>🎲 ${esc(L("roll"))}</button>`;

export function afterBattleHtml(g, ev) {
  const a = g.campaign.afterBattle;
  const steps = catalog().rules.after_battle || [];
  const crumbs = [`<button type="button" class="${a.step === 0 ? "primary" : "secondary"}" data-act="ab-goto" data-step="0">${esc(L("battle"))}</button>`,
    ...steps.map((s, n) => `<button type="button" class="${a.step === n + 1 ? "primary" : "secondary"}" data-act="ab-goto" data-step="${n + 1}">${n + 1}. ${esc(pickField(s, "name", lang()))}</button>`)].join("");
  const body = [battleStep, maladiesStep, rewardsStep, minorStep, ambitionsStep, totalStep, bazaarStep, scenarioStep][a.step](g, a, ev);
  return `
    <div class="bd-panel bd-wizard">
      <h3>${esc(L("afterBattleT"))} <small>${esc(L("treasury"))} ${Number(g.treasury) || 0} · +${a.obols} ${esc(L("obolsAdded"))}</small></h3>
      <div class="bd-crumbs">${crumbs}</div>
      <div class="bd-step">${body}</div>
      <div class="bd-inline bd-wizard-nav">
        <button type="button" class="secondary" data-act="ab-step" data-by="-1"${a.step === 0 ? " disabled" : ""}>← ${esc(L("back"))}</button>
        ${a.step < 7 ? `<button type="button" class="primary" data-act="ab-step" data-by="1">${esc(L(a.step === 0 ? "begin" : "next"))} →</button>` : ""}
        <span class="spacer"></span>
        <button type="button" class="secondary" data-act="ab-discard">${esc(L("discard"))}</button>
      </div>
    </div>`;
}

function select(id, opts, current, { act = "", attrs = "", empty = null } = {}) {
  return `<select id="${id}"${act ? ` data-act="${act}"` : ""}${attrs}>` +
    (empty != null ? `<option value="">${esc(empty)}</option>` : "") +
    opts.map(([v, t]) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(t)}</option>`).join("") + `</select>`;
}
const opts = (cat) => rows(cat).map(([k, r]) => [k, pickField(r, "name", lang())]);

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
    </div>`;
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
    return `${head}<p class="bd-good">✓ ${esc(L("applied"))}: ${done.roll} · <b>${esc(pickField(def, "name", lang()))}</b>${done.stat ? ` (${esc(L(done.stat))})` : ""}</p>
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
      <input type="number" min="1" max="10" class="bd-die" data-act="ab-malady-roll" value="${a.maladyRoll ?? ""}"></div>
    ${def ? `<p><b>${a.maladyRoll} · ${esc(pickField(def, "name", lang()))}</b> — ${esc(pickField(def, "effect", lang()))}</p>
      <div class="bd-inline">${choice}<button type="button" class="primary" data-act="ab-apply-malady">${esc(L("apply"))}</button></div>` : ""}
    ${hp}`;
}

function rewardsStep(g, a) {
  const r = catalog().rules.victory_rewards?.[a.battle.result === "loss" ? "loss" : "win"] || {};
  const done = a.done.rewards;
  const dice = a.rewardDice || done?.dice || [];
  const main = done
    ? `<p class="bd-good">✓ +${done.obols} ${esc(L("obolsAdded"))} (${r.obols} + ${done.dice.join(" + ")})</p>`
    : `<p>${esc(L(a.battle.result === "loss" ? "loss" : "win"))}: ${r.obols} + 2d10</p>
       <div class="bd-inline">${rollBtn("ab-roll-rewards")} ${esc(L("orType"))} ${dieInput("ab-d1", dice[0])} ${dieInput("ab-d2", dice[1])}
         <button type="button" class="primary" data-act="ab-apply-rewards">${esc(L("apply"))}</button></div>`;
  // While a rolled treasure waits to be handed out, its own panel holds the
  // roll; a second Roll button here would quietly re-roll it.
  const treasures = done && a.treasuresLeft > 0 && !pendingTreasure()
    ? `<div class="bd-inline"><b>${a.treasuresLeft}</b> ${esc(L("treasureRolls"))}
         <button type="button" class="secondary" data-act="ab-roll-treasure">🎲 ${esc(L("rollTreasure"))}</button></div>` : "";

  const income = incomeUpgrades(g, catalog()).map(k => {
    const got = a.done.income?.[k];
    return `<div class="bd-inline">${esc(name(k))}: ${got != null
      ? `<span class="bd-good">✓ +${got}</span>`
      : `${rollBtn("ab-income-roll", ` data-key="${esc(k)}"`)} ${dieInput(`ab-inc-${k}`, a.incomeRolls?.[k])}
         <button type="button" class="primary" data-act="ab-income" data-key="${esc(k)}">${esc(L("apply"))}</button>`}</div>`;
  }).join("");
  const purl = g.models.filter(m => (m.traits || []).includes("wretched-undead-traits/purloiner")).map(m => {
    const got = a.done.purloiner?.[m.uid];
    const r2 = a.purlRolls?.[m.uid] || [];
    return `<div class="bd-inline">${esc(modelTitle(m))}: ${got != null
      ? `<span class="bd-good">✓ +${got}</span>`
      : `${rollBtn("ab-purl-roll", ` data-uid="${esc(m.uid)}"`)} ${dieInput(`ab-pr1-${m.uid}`, r2[0])} ${dieInput(`ab-pr2-${m.uid}`, r2[1])}
         <small>${esc(L("ifUnderMove"))}</small>
         <button type="button" class="primary" data-act="ab-purl" data-uid="${esc(m.uid)}">${esc(L("apply"))}</button>`}</div>`;
  }).join("");
  return `${stepText("rewards")}${main}${treasures}${pendingHtml(g)}
    ${income ? `<h4>${esc(L("lairIncome"))}</h4>${income}` : ""}
    ${purl ? `<h4>${esc(L("purloiner"))}</h4>${purl}` : ""}`;
}

const minorStep = (g) => `${stepText("minor")}<p class="bd-hint">${esc(L("stepMinor"))}</p>${ambitionsHtml(g)}`;
const ambitionsStep = (g) => `${stepText("ambitions")}<p class="bd-hint">${esc(L("stepAmbitions"))}</p>${pendingHtml(g)}${ambitionsHtml(g)}`;
function totalStep(g) {
  const owed = greaterOwed(g);
  return `${stepText("total")}<p class="bd-hint">${esc(L("stepTotal"))}</p>
    <p>${g.ambitions.completed} ${esc(L("completed"))}</p>
    ${owed > 0 ? pendingHtml(g) : `<p>${esc(L("noneOwed"))}</p>${pendingHtml(g)}`}`;
}

function bazaarStep(g, a) {
  const locs = Object.fromEntries((catalog().rules.bazaar?.locations || []).map(l => [l.key, l]));
  const text = (k) => `<p class="bd-hint">${esc(pickField(locs[k] || {}, "effect", lang()))}</p>`;
  const models = g.models.map(m => [m.uid, modelTitle(m)]);

  // Markets: buy gear, recruit, sell gear and treasures.
  const gear = [["weapons", ["melee-weapons", "ranged-weapons", "thrown-weapons", "colossal-weapons"]],
                ["armour", ["armours"]], ["equipment", ["miscellaneous-equipment"]]]
    .flatMap(([lst, cats]) => cats.flatMap(cat => rows(cat)
      .filter(([k]) => buyPrice(g, catalog(), k) > 0)       // nothing to buy in a free Improvised Weapon
      .map(([k, r]) => [`${lst}|${k}`, `${pickField(r, "name", lang())} · ${buyPrice(g, catalog(), k)}`])));
  const recruits = rows("minions").map(([k, r]) => [k, `${pickField(r, "name", lang())} · ${price(r)}`]);
  const sells = g.models.flatMap(m => ["weapons", "armour"].flatMap(lst => (m[lst] || []).map((k, n) =>
    sellValue(catalog(), k) > 0 ? `<span class="bd-item">${esc(modelTitle(m))}: ${esc(name(k))}
      <button type="button" class="bd-sell" data-act="ab-sell" data-uid="${esc(m.uid)}" data-list="${lst}" data-i="${n}">${esc(L("sell"))} ${sellValue(catalog(), k)}</button></span>` : "")));
  const b = catalog().rules.bazaar || {};
  const tVal = (k) => treasureKind(catalog(), k) === "greater" ? b.sell_greater_treasure : b.sell_minor_treasure;
  const tsells = [[null, g.stash], ...g.models.map(m => [m.uid, m.treasures || []])].flatMap(([from, list]) => list.map((k, n) =>
    `<span class="bd-item">${esc(name(k))}
      <button type="button" class="bd-sell" data-act="ab-sell-t" data-from="${esc(from || "")}" data-i="${n}">${esc(L("sell"))} ${tVal(k)}</button></span>`));

  // Soul Binder: the leader's maladies.
  const souls = g.models.flatMap(m => maladiesOf(m, catalog().rules).map(mal => {
    const def = (catalog().rules.maladies || []).find(x => x.key === mal.key) || {};
    return `<span class="bd-item">${esc(modelTitle(m))}: ${esc(pickField(def, "name", lang()) || mal.key)}${mal.stat ? ` (${esc(L(mal.stat))})` : ""}
      <button type="button" class="bd-sell" data-act="ab-soul" data-uid="${esc(m.uid)}" data-ref="${esc(mal.ref)}">${esc(L("remove"))} · ${b.soul_binder}</button></span>`;
  }));

  // Tomb Robber: once per gathering.
  const tomb = g.campaign.tombRobberUsed ? `<p>${esc(L("tombUsed"))}</p>` : `
    <div class="bd-inline">${rollBtn("ab-tomb-roll")}
      ${select("ab-tomb-pick", treasureTable(catalog(), "minor").map(k => [k, name(k)]), a.tombRoll, { act: "ab-tomb-pick", empty: L("pickTreasure") })}
      ${a.tombRoll ? `${esc(L("giveTo"))} ${select("ab-tomb-to", models, null, { empty: L("stash") })}
        <button type="button" class="primary" data-act="ab-tomb-take">${esc(L("payTake"))} · ${b.tomb_robber}</button>
        <button type="button" class="secondary" data-act="ab-tomb-decline">${esc(L("decline"))}</button>` : ""}
    </div>`;

  const alchemy = !hasAlchemy(g, catalog()) ? "" : `
    <h4>${esc(L("alchemy"))}</h4>
    ${a.alchemyBought ? `<p>${esc(L("alchemyDone"))}</p>` : `<div class="bd-inline">
      ${select("ab-alc-key", [...rows("potions"), ...rows("throwing-pots")].map(([k, r]) => [k, `${pickField(r, "name", lang())} · ${price(r)}`]), null)}
      ${esc(L("giveTo"))} ${select("ab-alc-to", models, null, { empty: L("stash") })}
      <button type="button" class="primary" data-act="ab-alchemy">${esc(L("buyGear"))}</button></div>`}`;

  return `${stepText("bazaar")}
    <h4>${esc(L("markets"))}</h4>${text("markets")}
    <div class="bd-inline">${select("ab-buy-item", gear, null)} ${esc(L("forModel"))} ${select("ab-buy-model", models, null)}
      <button type="button" class="primary" data-act="ab-buy">${esc(L("buyGear"))}</button></div>
    <div class="bd-inline">${select("ab-recruit-key", recruits, null)}
      <button type="button" class="primary" data-act="ab-recruit">${esc(L("recruit"))}</button></div>
    <div class="bd-items">${sells.join("")}${tsells.join("")}</div>
    <h4>${esc(L("soulBinder"))}</h4>${text("soul-binder")}
    <div class="bd-items">${souls.join("") || `<small>${esc(L("noMaladies"))}</small>`}</div>
    <h4>${esc(L("tombRobber"))}</h4>${text("tomb-robber")}${tomb}
    ${alchemy}
    ${upgradesHtml(g)}`;
}

function scenarioStep(g, a) {
  const next = a.next || {};
  const part = (p, labelKey, extra = "") => `
    <div class="bd-inline"><b>${esc(L(labelKey))}</b>
      ${rollBtn("ab-roll-scn", ` data-part="${p}"`)}
      ${select(`ab-next-${p}`, opts(p), next[p], { act: "ab-next", attrs: ` data-part="${p}"`, empty: L("none") })}${extra}</div>`;
  const reroll = a.omenAgreed && next["dread-omens"] && canRerollOmen(g) && !a.omenRerolled
    ? ` <button type="button" class="secondary" data-act="ab-roll-scn" data-part="dread-omens" data-reroll="1">${esc(L("rerollOmen"))}</button>` : "";
  return `${stepText("scenario")}
    ${part("environments", "environment")}
    ${part("missions", "mission")}
    <label class="bd-check"><input type="checkbox" data-act="ab-omen-agree"${a.omenAgreed ? " checked" : ""}> ${esc(L("bothAgree"))}</label>
    ${a.omenAgreed ? part("dread-omens", "omen", reroll) : ""}
    ${a.treasuresLeft > 0 ? `<p class="bd-warn-line">${a.treasuresLeft} ${esc(L("treasureRolls"))} — ${esc(L("rollsLost"))}</p>` : ""}
    <p><button type="button" class="primary" data-act="ab-finish">${esc(L("finish"))}</button></p>`;
}
