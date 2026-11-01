/**
 * Builder tab, Campaign view: the Bazaar (rulebook p.72) and the next
 * scenario (p.65). Both are folds of the Campaign view, open to use any time
 * the after-battle wizard isn't, so a gathering can shop before its first
 * battle or between two.
 *
 * Their state lives on `g.campaign`, not on an after-battle sequence:
 * `tombRoll`, `alchemyBought`, `omenAgreed`, `omenRerolled` and
 * `nextScenario` ({environment, mission, omen}, filled as it's picked and
 * cleared when the battle it was for is logged). Purchases are recorded as
 * transactions and land in the next battle's log entry.
 */

import { icon } from "./lucide.js";
import { state } from "./state.js";
import { escapeHtml } from "./util.js";
import { pickField } from "./i18n.js";
import { slug } from "./builder/catalog.js";
import { treasureKind } from "./builder/rules.js";
import { label, itemName } from "./builder/messages.js";
import {
  ensureCampaign, buyGear, buyPrice, recruit, recruitPrice, sellGear, sellValue, sellTreasure,
  soulBinder, tombRobber, hasAlchemy, buyAlchemy, price, rollScenarioPart, canRerollOmen,
  rollTreasure, treasureTable, weaponLocked,
} from "./builder/campaign.js";
import { maladiesOf } from "./builder/ledger.js";

const esc = escapeHtml;
const lang = () => state.lang || "en";
const L = (k) => label(k, lang());
const catalog = () => state.catalog;
const name = (key) => itemName(catalog(), key, lang());
const rows = (cat) => (catalog().bundle.categories[cat]?.rows || []).map(r => [`${cat}/${slug(r.name)}`, r]);
const modelTitle = (m) => (m.name ? `${m.name} (${name(m.profile)})` : name(m.profile));

/** Value of a form control by id. */
export const val = (id) => document.getElementById(id)?.value ?? "";

/** A <select>; `label` names it when no <label> around it does. */
export function select(id, opts, current, { act = "", attrs = "", empty = null, label = "" } = {}) {
  return `<select id="${id}"${act ? ` data-act="${act}"` : ""}${label ? ` aria-label="${esc(label)}"` : ""}${attrs}>` +
    (empty != null ? `<option value="">${esc(empty)}</option>` : "") +
    opts.map(([v, t]) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(t)}</option>`).join("") + `</select>`;
}
/** The rows of a category as select options. */
export const opts = (cat) => rows(cat).map(([k, r]) => [k, pickField(r, "name", lang())]);
/** A "Roll" button. */
export const rollBtn = (act, attrs = "") =>
  `<button type="button" class="secondary" data-act="${act}"${attrs}>${icon("dices")} ${esc(L("roll"))}</button>`;

/* ---- events ---------------------------------------------------------------- */

/** The scenario parts as the table categories name them → the keys kept on `nextScenario`. */
const PART = { environments: "environment", missions: "mission", "dread-omens": "omen" };
const setPart = (g, part, v) => { g.campaign.nextScenario = { ...(g.campaign.nextScenario || {}), [PART[part]]: v || null }; };

export function bazaarChange(act, el, g) {
  if (!["ab-next", "ab-omen-agree", "ab-tomb-pick"].includes(act)) return false;
  ensureCampaign(g, catalog());
  const c = g.campaign;
  switch (act) {
    case "ab-next":       setPart(g, el.dataset.part, el.value); return true;
    // An omen only stands while both players agree to one.
    case "ab-omen-agree": c.omenAgreed = el.checked; if (!el.checked) setPart(g, "dread-omens", null); return true;
    case "ab-tomb-pick":  c.tombRoll = el.value || null; return true;
  }
  return false;
}

export function bazaarClick(act, el, g) {
  if (!["ab-buy", "ab-recruit", "ab-sell", "ab-sell-t", "ab-soul", "ab-tomb-roll", "ab-tomb-take",
        "ab-tomb-decline", "ab-alchemy", "ab-roll-scn"].includes(act)) return false;
  ensureCampaign(g, catalog());
  const c = g.campaign;
  const { uid, list, i, part } = el.dataset;
  switch (act) {
    case "ab-buy": {
      const [lst, k] = val("ab-buy-item").split("|");
      if (lst && k && val("ab-buy-model")) buyGear(g, catalog(), val("ab-buy-model"), lst, k);
      return true;
    }
    case "ab-recruit": if (val("ab-recruit-key")) recruit(g, catalog(), val("ab-recruit-key")); return true;
    case "ab-sell":    sellGear(g, catalog(), uid, list, i); return true;
    case "ab-sell-t":  sellTreasure(g, catalog(), el.dataset.from || null, i); return true;
    case "ab-soul":    soulBinder(g, catalog(), uid, el.dataset.ref); return true;
    case "ab-tomb-roll": c.tombRoll = rollTreasure(catalog(), "minor")[0]; return true;
    case "ab-tomb-take": if (c.tombRoll) tombRobber(g, catalog(), c.tombRoll, { pay: true, to: val("ab-tomb-to") || null }); c.tombRoll = null; return true;
    case "ab-tomb-decline": tombRobber(g, catalog(), c.tombRoll, { pay: false }); c.tombRoll = null; return true;
    case "ab-alchemy": if (val("ab-alc-key")) buyAlchemy(g, catalog(), val("ab-alc-key"), val("ab-alc-to") || null); return true;
    case "ab-roll-scn":
      setPart(g, part, rollScenarioPart(catalog(), part));
      if (el.dataset.reroll) c.omenRerolled = true;
      return true;
  }
  return false;
}

/* ---- panels ---------------------------------------------------------------- */

/** Markets, Soul Binder, Tomb Robber and Alchemy, as {title, body}. */
export function bazaarPanel(g) {
  const c = g.campaign;
  const locs = Object.fromEntries((catalog().rules.bazaar?.locations || []).map(l => [l.key, l]));
  const text = (k) => `<p class="bd-hint">${esc(pickField(locs[k] || {}, "effect", lang()))}</p>`;
  const models = g.models.map(m => [m.uid, modelTitle(m)]);

  // Markets: buy gear, recruit, sell gear and treasures.
  // Thrown weapons are Miscellaneous Equipment (p.41).
  const gear = [["weapons", ["melee-weapons", "ranged-weapons", "colossal-weapons"]],
                ["armour", ["armours"]], ["equipment", ["miscellaneous-equipment", "thrown-weapons"]]]
    .flatMap(([lst, cats]) => cats.flatMap(cat => rows(cat)
      .filter(([k]) => buyPrice(g, catalog(), k) > 0)       // nothing to buy in a free Improvised Weapon
      .map(([k, r]) => [`${lst}|${k}`, `${pickField(r, "name", lang())} · ${buyPrice(g, catalog(), k)}`])));
  // The price includes the weapon a new minion starts with (a beast's Claws and Fangs).
  const recruits = rows("minions").map(([k, r]) => [k, `${pickField(r, "name", lang())} · ${recruitPrice(g, catalog(), k)}`]);
  // Anything with a cost sells (the house rule at campaign.js `sellValue`), but
  // not a beast's last weapon.
  const sells = g.models.flatMap(m => ["weapons", "armour", "equipment"].flatMap(lst => (m[lst] || []).map((k, n) =>
    sellValue(catalog(), k) > 0 && !weaponLocked(catalog(), m, lst, n) ? `<span class="bd-item">${esc(modelTitle(m))}: ${esc(name(k))}
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
  const tomb = c.tombRobberUsed ? `<p>${esc(L("tombUsed"))}</p>` : `
    <div class="bd-inline">${rollBtn("ab-tomb-roll")}
      ${select("ab-tomb-pick", treasureTable(catalog(), "minor").map(k => [k, name(k)]), c.tombRoll, { act: "ab-tomb-pick", empty: L("pickTreasure"), label: L("pickTreasure") })}
      ${c.tombRoll ? `${esc(L("giveTo"))} ${select("ab-tomb-to", models, null, { empty: L("stash"), label: L("giveTo") })}
        <button type="button" class="secondary" data-act="ab-tomb-take">${esc(L("payTake"))} · ${b.tomb_robber}</button>
        <button type="button" class="secondary" data-act="ab-tomb-decline">${esc(L("decline"))}</button>` : ""}
    </div>`;

  const alchemy = !hasAlchemy(g, catalog()) ? "" : `
    <h4>${esc(L("alchemy"))}</h4>
    ${c.alchemyBought ? `<p>${esc(L("alchemyDone"))}</p>` : `<div class="bd-inline">
      ${select("ab-alc-key", [...rows("potions"), ...rows("throwing-pots")].map(([k, r]) => [k, `${pickField(r, "name", lang())} · ${price(r)}`]), null, { label: L("itemToBuy") })}
      ${esc(L("giveTo"))} ${select("ab-alc-to", models, null, { empty: L("stash"), label: L("giveTo") })}
      <button type="button" class="secondary" data-act="ab-alchemy">${esc(L("buyGear"))}</button></div>`}`;

  return { title: esc(L("bazaarT")), body: `
    <h4>${esc(L("markets"))}</h4>${text("markets")}
    <div class="bd-inline">${select("ab-buy-item", gear, null, { label: L("itemToBuy") })} ${esc(L("forModel"))} ${select("ab-buy-model", models, null, { label: L("buyFor") })}
      <button type="button" class="secondary" data-act="ab-buy">${esc(L("buyGear"))}</button></div>
    <div class="bd-inline">${select("ab-recruit-key", recruits, null, { label: L("minionToRecruit") })}
      <button type="button" class="secondary" data-act="ab-recruit">${esc(L("recruit"))}</button></div>
    <div class="bd-items">${sells.join("")}${tsells.join("")}</div>
    <h4>${esc(L("soulBinder"))}</h4>${text("soul-binder")}
    <div class="bd-items">${souls.join("") || `<small>${esc(L("noMaladies"))}</small>`}</div>
    <h4>${esc(L("tombRobber"))}</h4>${text("tomb-robber")}${tomb}
    ${alchemy}` };
}

/** Environment, mission and (if both players agree) dread omen for the next battle, as {title, body}. */
export function scenarioPanel(g) {
  const c = g.campaign;
  const next = c.nextScenario || {};
  const part = (p, labelKey, extra = "") => `
    <div class="bd-inline"><b>${esc(L(labelKey))}</b>
      ${rollBtn("ab-roll-scn", ` data-part="${p}"`)}
      ${select(`ab-next-${p}`, opts(p), next[PART[p]], { act: "ab-next", attrs: ` data-part="${p}"`, empty: L("none"), label: L(labelKey) })}${extra}</div>`;
  const reroll = c.omenAgreed && next.omen && canRerollOmen(g) && !c.omenRerolled
    ? ` <button type="button" class="secondary" data-act="ab-roll-scn" data-part="dread-omens" data-reroll="1">${esc(L("rerollOmen"))}</button>` : "";
  return { title: esc(L("nextScenarioT")), body: `
    <p class="bd-hint">${esc(L("nextScenarioHint"))}</p>
    ${part("environments", "environment")}
    ${part("missions", "mission")}
    <label class="bd-check"><input type="checkbox" data-act="ab-omen-agree"${c.omenAgreed ? " checked" : ""}> ${esc(L("bothAgree"))}</label>
    ${c.omenAgreed ? part("dread-omens", "omen", reroll) : ""}` };
}
