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
import { defaultWeapon } from "./codec.js";

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

/* ---- after-battle sequence (p.65) ------------------------------------------
 *
 * `g.campaign.afterBattle` holds a sequence in progress, so it can be left
 * and resumed: the battle being closed, the current step, what each step
 * has already applied (`done`), and the obols the battle brought in. The
 * treasury moves as each step applies; finishing writes the battle log.
 */

const num = (v) => { const m = /-?\d+/.exec(String(v ?? "")); return m ? parseInt(m[0], 10) : 0; };
/** Price of a row: `obols`, else the number in its `cost` ("10 obols"). */
export const price = (row) => (row?.obols != null ? Number(row.obols) : num(row?.cost));

export function startAfterBattle(g, battle) {
  ensureCampaign(g);
  const next = g.campaign.nextScenario || {};
  g.campaign.afterBattle = {
    step: 0,
    battle: {
      date: battle.date || new Date().toISOString().slice(0, 10),
      environment: battle.environment ?? next.environment ?? null,
      mission: battle.mission ?? next.mission ?? null,
      omen: battle.omen ?? next.omen ?? null,
      result: battle.result || "win",
      leaderShattered: !!battle.leaderShattered,
      notes: battle.notes || "",
    },
    done: {},
    obols: 0,
    treasuresLeft: 0,
    alchemyBought: false,
  };
  return g.campaign.afterBattle;
}

const ab = (g) => {
  const a = g.campaign?.afterBattle;
  if (!a) throw new Error("No after-battle sequence in progress");
  return a;
};
const gain = (g, n) => { g.treasury = (Number(g.treasury) || 0) + n; ab(g).obols += n; };
const leaderOf = (g) => g.models.find(isLeader);

/** The malady a D10 roll gives (p.66). */
export const maladyFor = (catalog, roll) => (catalog.rules.maladies || []).find(m => m.rolls.includes(Number(roll)));

/**
 * Step 1: apply the malady for `roll` to the leader. `stat` is the stat
 * Cursed/Incomplete Form worsens; `treasure` the index of the minor
 * treasure Pilfered takes.
 */
export function applyMalady(g, catalog, roll, { stat = null, treasure = null } = {}) {
  const a = ab(g);
  if (a.done.maladies) return null;
  const def = maladyFor(catalog, roll);
  const leader = leaderOf(g);
  if (!def || !leader) return null;
  if (def.stat_by) {
    if (!["move", "violence", "ranged"].includes(stat)) throw new Error("Choose Move, Violence or Ranged");
    (leader.maladies ||= []).push({ key: def.key, stat });
  } else if (def.modifiers) {
    (leader.maladies ||= []).push({ key: def.key });
  } else if (def.improvements) {
    addTo(leader, def.improvements);
  } else if (def.lose_minor_treasure && treasure != null) {
    leader.treasures.splice(Number(treasure), 1);
  }
  a.done.maladies = { roll: Number(roll), key: def.key, stat };
  return def;
}

/** Step 2: victory rewards (30/20 + 2d10, and 2/1 minor treasure rolls). */
export function applyVictoryRewards(g, catalog, dice) {
  const a = ab(g);
  if (a.done.rewards) return 0;
  const r = catalog.rules.victory_rewards?.[a.battle.result === "loss" ? "loss" : "win"] || { obols: 0, treasures: 0 };
  const n = r.obols + dice.reduce((s, x) => s + Number(x || 0), 0);
  gain(g, n);
  a.treasuresLeft += r.treasures;
  a.done.rewards = { dice: dice.map(Number), obols: n };
  return n;
}

/** Lair upgrades that bring +d10 obols after each scenario (p.71). */
export const incomeUpgrades = (g, catalog) =>
  (g.lair?.upgrades || []).filter(k => catalog.row(k)?.modifiers?.income);

export function applyLairIncome(g, catalog, key, roll) {
  const a = ab(g);
  a.done.income ||= {};
  if (a.done.income[key] != null || !incomeUpgrades(g, catalog).includes(key)) return 0;
  gain(g, Number(roll) || 0);
  a.done.income[key] = Number(roll) || 0;
  return a.done.income[key];
}

/** Purloiner (p.25): roll a d10; if ≤ the model's Move, gain d10 obols. */
export function applyPurloiner(g, uid, move, roll, obols) {
  const a = ab(g);
  a.done.purloiner ||= {};
  if (a.done.purloiner[uid] != null) return 0;
  const n = Number(roll) <= Number(move) ? Number(obols) || 0 : 0;
  gain(g, n);
  a.done.purloiner[uid] = n;
  return n;
}

/* Step 6: the Bazaar (p.72) and the Alchemy Workshop (p.73). */

const GEAR_LISTS = { weapons: true, armour: true, equipment: true };
const discounted = (g, catalog, key) => {
  const cat = categoryOf(key);
  const off = (g.lair?.upgrades || []).reduce((n, k) => n + (catalog.row(k)?.modifiers?.gear_discount || 0), 0);
  const base = price(catalog.row(key));
  // Forgotten Forge: weapons and armour cost 20% less, rounding down.
  if (off && (cat.endsWith("-weapons") || cat === "armours")) return Math.floor(base * (100 - off) / 100);
  return base;
};
export const buyPrice = discounted;

/** Buy gear for a model in the Markets. */
export function buyGear(g, catalog, uid, list, key) {
  if (!GEAR_LISTS[list]) throw new Error("Not a gear list");
  const m = g.models.find(x => x.uid === uid);
  const cost = discounted(g, catalog, key);
  // A real weapon replaces the free Improvised one.
  if (list === "weapons" && m.weapons.length === 1 && /improvised-weapon$/.test(m.weapons[0]) &&
      categoryOf(key) !== "thrown-weapons") m.weapons = [];
  m[list].push(key);
  g.treasury = (Number(g.treasury) || 0) - cost;
  return cost;
}

/** Recruit a new minion in the Markets. */
export function recruit(g, catalog, key, defaultWeapon) {
  const rules = catalog.profileRules(key);
  const m = newModel(g, { profile: key, weapons: [defaultWeapon],
    affinity: (rules.affinity || []).length === 1 ? rules.affinity[0] : null });
  g.models.push(m);
  g.treasury = (Number(g.treasury) || 0) - price(catalog.row(key));
  return m;
}

/** Sell a weapon or armour for half its value, rounding down. */
export const sellValue = (catalog, key) => Math.floor(price(catalog.row(key)) / 2);
export function sellGear(g, catalog, uid, list, index) {
  if (list !== "weapons" && list !== "armour") throw new Error("Only weapons and armour sell");
  const m = g.models.find(x => x.uid === uid);
  const [key] = m[list].splice(Number(index), 1);
  if (!key) return 0;
  // A model always has at least its free Improvised Weapon.
  if (list === "weapons" && !m.weapons.length) m.weapons.push(defaultWeapon(catalog, m.profile));
  const v = sellValue(catalog, key);
  g.treasury = (Number(g.treasury) || 0) + v;
  return v;
}

/** Sell a treasure: minor 10 obols, greater 50. `from` = uid, or null for the stash. */
export function sellTreasure(g, catalog, from, index) {
  const list = from ? g.models.find(x => x.uid === from).treasures : g.stash;
  const [key] = list.splice(Number(index), 1);
  if (!key) return 0;
  const b = catalog.rules.bazaar || {};
  const v = treasureKind(catalog, key) === "greater" ? b.sell_greater_treasure ?? 50 : b.sell_minor_treasure ?? 10;
  g.treasury = (Number(g.treasury) || 0) + v;
  return v;
}

/** Soul Binder: 50 obols removes a malady, and with it its effect. */
export function soulBinder(g, catalog, uid, index) {
  const m = g.models.find(x => x.uid === uid);
  const [mal] = (m.maladies || []).splice(Number(index), 1);
  if (!mal) return false;
  g.treasury = (Number(g.treasury) || 0) - (catalog.rules.bazaar?.soul_binder ?? 50);
  return true;
}

/** Tomb Robber: once per gathering, pay 30 for the minor treasure rolled. */
export function tombRobber(g, catalog, key, { pay = true, to = null } = {}) {
  ensureCampaign(g);
  if (g.campaign.tombRobberUsed) return false;
  g.campaign.tombRobberUsed = true;
  if (!pay) return false;
  g.treasury = (Number(g.treasury) || 0) - (catalog.rules.bazaar?.tomb_robber ?? 30);
  giveTreasure(g, key, to);
  return true;
}

/** Alchemy Workshop: 1 potion or throwing pot per after-battle sequence. */
export const hasAlchemy = (g, catalog) =>
  (g.lair?.upgrades || []).some(k => catalog.row(k)?.modifiers?.shop === "alchemy");
export function buyAlchemy(g, catalog, key, to = null) {
  const a = ab(g);
  if (a.alchemyBought || !hasAlchemy(g, catalog)) return false;
  a.alchemyBought = true;
  g.treasury = (Number(g.treasury) || 0) - price(catalog.row(key));
  giveTreasure(g, key, to);
  return true;
}

/* Step 7: the next scenario. */

/** Has "Read the Omens" been completed (one omen reroll per scenario)? */
export const canRerollOmen = (g) => (g.ambitions?.log || []).some(e => e.ambition === "ambitions/read-the-omens");

export function rollScenarioPart(catalog, part, rng = Math.random) {
  const rows = (catalog.bundle.categories[part]?.rows || []);
  const n = catalog.rules.scenario_dice?.[part] || rows.length;
  return `${part}/${slug(rows.at(d(n, rng) - 1)?.name)}`;
}

/** Finish: log the battle (its obols are already in the treasury). */
export function finishAfterBattle(g, nextScenario = null) {
  const a = ab(g);
  g.history.push({
    date: a.battle.date, environment: a.battle.environment, mission: a.battle.mission,
    omen: a.battle.omen, result: a.battle.result, obols: a.obols, notes: a.battle.notes,
  });
  g.campaign.nextScenario = nextScenario;
  delete g.campaign.afterBattle;
}
