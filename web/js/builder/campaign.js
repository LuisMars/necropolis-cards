/**
 * Campaign actions on a gathering (rulebook pp.65-76).
 *
 * Each function changes the gathering it is given (the Builder tab hands
 * it a clone) and returns what the caller needs to finish the step, e.g. a
 * treasure still to be rolled. Dice take an optional `rng` so a typed-in
 * physical roll or a test can replace Math.random.
 */

import { categoryOf, slug } from "./catalog.js";
import { evaluate, treasureKind } from "./rules.js";
import { newModel } from "./gathering.js";

export const d = (sides, rng = Math.random) => 1 + Math.floor(rng() * sides);

/** Fill in campaign fields older saves don't have. */
export function ensureCampaign(g) {
  g.stash ||= [];
  g.lair ||= { name: "", upgrades: [] };
  g.lair.upgrades ||= [];
  g.ambitions = { active: [], progress: {}, completed: 0, greaterClaimed: 0, log: [], ...(g.ambitions || {}) };
  g.campaign = { opponentLimit: null, freeRabbleUsed: false, ...(g.campaign || {}) };
  g.history ||= [];
  return g;
}

/**
 * Start the campaign: the obols left from the 300 become the treasury.
 * A band built before it reached the Builder (an import) has a treasury
 * we can't know, so `alreadyBuilt` starts it at 0 for the player to set.
 */
export function startCampaign(g, catalog, { alreadyBuilt = false } = {}) {
  ensureCampaign(g);
  const ev = evaluate(g, catalog);
  g.treasury = alreadyBuilt ? 0 : (ev.budget ?? 0) - ev.total;
  return g.treasury;
}

/* ---- lair upgrades (p.71): 50 obols, once each ----------------------------- */

export function buyUpgrade(g, key, catalog) {
  ensureCampaign(g);
  if (g.lair.upgrades.includes(key)) return false;
  g.lair.upgrades.push(key);
  g.treasury = (Number(g.treasury) || 0) - (Number(catalog.row(key)?.obols) || 0);
  return true;
}

/** Undo a purchase (a mis-click): the obols go back. */
export function refundUpgrade(g, key, catalog) {
  ensureCampaign(g);
  const i = g.lair.upgrades.indexOf(key);
  if (i < 0) return false;
  g.lair.upgrades.splice(i, 1);
  g.treasury = (Number(g.treasury) || 0) + (Number(catalog.row(key)?.obols) || 0);
  return true;
}

/* ---- ambitions (p.67-68) --------------------------------------------------- */

const isLeader = (m) => categoryOf(m.profile) === "leaders";
const addTo = (m, imps) => {
  m.improvements ||= {};
  for (const [k, v] of Object.entries(imps || {})) m.improvements[k] = (m.improvements[k] || 0) + v;
};

/** Models a "model of your choice" reward may go to. */
export function rewardTargets(g, catalog, key) {
  const eff = catalog.row(key)?.reward_effect || {};
  return g.models.filter(m => categoryOf(m.profile) !== "sellswords" && (!eff.only || eff.only.includes(m.profile)));
}

/**
 * Count one step of progress; at the goal the ambition completes.
 * @returns {boolean} true when this step completed it
 */
export function tickAmbition(g, key, catalog, step = 1) {
  ensureCampaign(g);
  const goal = Number(catalog.row(key)?.goal) || 1;
  const now = Math.max(0, (g.ambitions.progress[key] || 0) + step);
  g.ambitions.progress[key] = Math.min(now, goal);
  return g.ambitions.progress[key] >= goal;
}

/**
 * Complete an ambition at its goal and apply its reward.
 * @param {string} [uid]  the model a "model of your choice" reward goes to
 * @returns {{treasure?: "minor"}}  a treasure still to roll, if the reward is one
 */
export function completeAmbition(g, key, catalog, uid = null) {
  ensureCampaign(g);
  const eff = catalog.row(key)?.reward_effect || {};
  let to = null;
  switch (eff.target) {
    case "all":
      for (const m of g.models) if (categoryOf(m.profile) !== "sellswords") addTo(m, eff.improvements);
      break;
    case "leader": {
      const l = g.models.find(isLeader);
      if (l) { addTo(l, eff.improvements); to = l.uid; }
      break;
    }
    case "choose": {
      const m = rewardTargets(g, catalog, key).find(x => x.uid === uid);
      if (!m) throw new Error("Choose a model for this reward");
      addTo(m, eff.improvements);
      to = m.uid;
      break;
    }
    case "gathering":
      if (eff.deployment) g.deploymentLimit = (g.deploymentLimit ?? catalog.rules.gathering?.deployment_limit ?? 350) + eff.deployment;
      if (eff.bonus_traits) g.bonusTraits = (g.bonusTraits || 0) + eff.bonus_traits;
      break;
  }
  g.ambitions.progress[key] = 0;
  g.ambitions.completed += 1;
  g.ambitions.log.push({ ambition: key, to });
  return eff.target === "treasure" ? { treasure: eff.treasure || "minor" } : {};
}

/** Greater treasures earned (1 per 5 completed ambitions) and not yet taken. */
export const greaterOwed = (g) =>
  Math.floor((g.ambitions?.completed || 0) / 5) - (g.ambitions?.greaterClaimed || 0);

/* ---- treasures (p.66-73) --------------------------------------------------- */

/** Rows of the table a treasure kind is rolled on (I–X, in book order). */
export function treasureTable(catalog, kind) {
  const cat = kind === "greater" ? "greater-treasures" : "minor-treasures";
  return (catalog.bundle.categories[cat]?.rows || []).map(r => `${cat}/${slug(r.name)}`);
}

/** Minor: one d10. Greater: 2d10, the player keeps the one they prefer (p.69). */
export function rollTreasure(catalog, kind, rng = Math.random) {
  const table = treasureTable(catalog, kind);
  const pick = () => table.at(d(table.length, rng) - 1);
  return kind === "greater" ? [pick(), pick()] : [pick()];
}

/** Add a treasure to a model, or to the gathering's stash (`to` = null). */
export function giveTreasure(g, key, to = null, { greaterClaim = false } = {}) {
  ensureCampaign(g);
  const m = to ? g.models.find(x => x.uid === to) : null;
  (m ? (m.treasures ||= []) : g.stash).push(key);
  if (greaterClaim) g.ambitions.greaterClaimed += 1;
}

/** Move a treasure: `from`/`to` are model uids, or null for the stash. */
export function moveTreasure(g, from, index, to) {
  ensureCampaign(g);
  const list = (uid) => (uid ? (g.models.find(x => x.uid === uid).treasures ||= []) : g.stash);
  const [key] = list(from).splice(index, 1);
  if (key) list(to).push(key);
  return key;
}

export const isTreasure = (catalog, key) => treasureKind(catalog, key) != null;

/* ---- sellswords (p.74) ----------------------------------------------------- */

/** Is the opponent's deployment limit 100+ higher than ours? */
export function freeSellsword(g, catalog) {
  const opp = Number(g.campaign?.opponentLimit);
  if (!opp) return false;
  return opp >= evaluate(g, catalog).deploymentLimit + 100;
}

/**
 * Add a sellsword to the roster, paying its roster cost unless `free`
 * (the Desperate Rabble, the first time the gathering faces such an opponent).
 */
export function hireSellsword(g, key, catalog, { free = false } = {}) {
  ensureCampaign(g);
  const rules = catalog.profileRules(key);
  const m = newModel(g, { profile: key, status: "reserve",
    affinity: (rules.affinity || []).length === 1 ? rules.affinity[0] : null });
  g.models.push(m);
  if (free) g.campaign.freeRabbleUsed = true;
  else g.treasury = (Number(g.treasury) || 0) - (Number(catalog.row(key)?.obols) || 0);
  return m;
}

/* ---- battle log ------------------------------------------------------------ */

/** Log a battle; the obols it brought in go into the treasury. */
export function addBattle(g, entry, catalog) {
  ensureCampaign(g);
  if (g.treasury == null) startCampaign(g, catalog);   // before the first entry ends the build budget
  g.history.push({
    date: entry.date || new Date().toISOString().slice(0, 10),
    environment: entry.environment || null,
    mission: entry.mission || null,
    omen: entry.omen || null,
    result: entry.result || null,          // "win" | "loss" | "draw"
    obols: Number(entry.obols) || 0,
    notes: entry.notes || "",
  });
  g.treasury += Number(entry.obols) || 0;
}

/** Remove a log entry, taking its obols back out of the treasury. */
export function removeBattle(g, index) {
  ensureCampaign(g);
  const [e] = g.history.splice(index, 1);
  if (e) g.treasury = (Number(g.treasury) || 0) - (Number(e.obols) || 0);
}
