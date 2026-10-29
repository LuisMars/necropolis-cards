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
import { addEntries, removeRef, removeEntry, migrateModel, maladyEntries, maladiesOf } from "./ledger.js";

export const d = (sides, rng = Math.random) => 1 + Math.floor(rng() * sides);

/** Today's date in the player's own time zone, "YYYY-MM-DD" (toISOString would give UTC's). */
export function today(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Fill in campaign fields older saves don't have. */
export function ensureCampaign(g, catalog = null) {
  g.stash ||= [];
  g.gearStash ||= [];
  g.lair ||= { name: "", upgrades: [] };
  g.lair.upgrades ||= [];
  g.ambitions = { active: [], progress: {}, completed: 0, greaterClaimed: 0, log: [], ...(g.ambitions || {}) };
  g.campaign = { opponentHigher: false, freeRabbleUsed: false, transactions: [], ...(g.campaign || {}) };
  g.campaign.transactions ||= [];
  g.history ||= [];
  // Pre-ledger saves: bare improvement numbers and maladies become entries.
  for (const m of g.models || []) migrateModel(m, catalog?.rules || {});
  for (const [i, e] of (g.ambitions.log || []).entries()) e.id ||= `a${i + 1}`;
  return g;
}

/**
 * Record a purchase or sale. They collect here until the next battle is
 * logged, which takes them into its entry, so every change to the
 * treasury between two battles can be traced.
 *   { type, item?, uid?, obols }   obols signed: - spent, + received
 */
export function record(g, type, { item = null, uid = null, obols = 0 } = {}) {
  ensureCampaign(g);
  g.campaign.transactions.push({ type, item, uid, obols: Number(obols) || 0 });
}
const pay = (g, n) => { g.treasury = (Number(g.treasury) || 0) + n; };

/**
 * Start the campaign: the obols left from the 300 become the treasury.
 * A band built before it reached the Builder (an import) has a treasury
 * we can't know, so `alreadyBuilt` starts it at 0 for the player to set.
 */
export function startCampaign(g, catalog, { alreadyBuilt = false } = {}) {
  ensureCampaign(g, catalog);
  const ev = evaluate(g, catalog);
  g.treasury = alreadyBuilt ? 0 : (ev.budget ?? 0) - ev.total;
  return g.treasury;
}

/**
 * Set the deployment limit's base from a typed value. Blank goes back to
 * the rulebook default (null); 0 is a number like any other, not a blank.
 * Anything that isn't a whole number leaves it as it was.
 */
export function setDeploymentBase(g, value) {
  const s = String(value ?? "").trim();
  if (s === "") { g.deploymentLimit = null; return null; }
  const n = Number(s);
  if (Number.isInteger(n) && n >= 0) g.deploymentLimit = n;
  return g.deploymentLimit;
}

/* ---- lair upgrades (p.71): 50 obols, once each ----------------------------- */

export function buyUpgrade(g, key, catalog) {
  ensureCampaign(g, catalog);
  if (g.lair.upgrades.includes(key)) return false;
  g.lair.upgrades.push(key);
  const cost = Number(catalog.row(key)?.obols) || 0;
  pay(g, -cost);
  record(g, "upgrade", { item: key, obols: -cost });
  return true;
}

/** Undo a purchase (a mis-click): the obols go back. */
export function refundUpgrade(g, key, catalog) {
  ensureCampaign(g, catalog);
  const i = g.lair.upgrades.indexOf(key);
  if (i < 0) return false;
  g.lair.upgrades.splice(i, 1);
  const cost = Number(catalog.row(key)?.obols) || 0;
  pay(g, cost);
  record(g, "upgrade-undo", { item: key, obols: cost });
  return true;
}

/* ---- ambitions (p.67-68) --------------------------------------------------- */

const isLeader = (m) => categoryOf(m.profile) === "leaders";
const leaderOf = (g) => (g.models || []).find(isLeader);
/** Which battle and date a change belongs to: the one being closed, if any. */
function when(g) {
  const ab = g.campaign?.afterBattle;
  return { battle: (g.history || []).length + (ab ? 1 : 0),
           date: ab?.battle?.date || today() };
}
function nextLogId(g) {
  const used = new Set((g.ambitions?.log || []).map(e => e.id));
  let n = used.size + 1;
  while (used.has(`a${n}`)) n++;
  return `a${n}`;
}

/** A manual change to a model's stat, with the reason for it. */
export function addManualEntry(g, uid, stat, amount, note = "") {
  const m = g.models.find(x => x.uid === uid);
  return addEntries(m, { [stat]: Number(amount) }, { type: "manual", note }, when(g));
}
export function removeLedgerEntry(g, uid, id) {
  removeEntry(g.models.find(x => x.uid === uid), id);
}

/** Spells a "spell of your choice" reward (Master Abyssal Artillery) may go to: the leader's. */
export function spellTargets(g, catalog, key) {
  return [...new Set(leaderOf(g)?.spells || [])];
}

/**
 * The channelling bonuses completed ambitions give, by spell key
 * ({ "spells/wither": 1 }). Completing the ambition twice stacks.
 */
export function channelBonuses(g) {
  const out = {};
  for (const e of g.ambitions?.log || []) {
    const k = e.applied?.channel;
    if (k) out[k] = (out[k] || 0) + 1;
  }
  return out;
}

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
  ensureCampaign(g, catalog);
  const goal = Number(catalog.row(key)?.goal) || 1;
  const now = Math.max(0, (g.ambitions.progress[key] || 0) + step);
  g.ambitions.progress[key] = Math.min(now, goal);
  return g.ambitions.progress[key] >= goal;
}

/**
 * Complete an ambition at its goal and apply its reward.
 * @param {string|object} [uid]  the model a "model of your choice" reward goes
 *        to; or, in its place, the options object below
 * @param {{uid?: string, spell?: string}} [opts]  `spell`: the leader's spell a
 *        "spell of your choice" reward (+1 to channel, p.67) goes to
 * @returns {{treasure?: "minor"}}  a treasure still to roll, if the reward is one
 */
export function completeAmbition(g, key, catalog, uid = null, opts = {}) {
  if (uid && typeof uid === "object") { opts = uid; uid = opts.uid ?? null; }
  const { spell = null } = opts || {};
  ensureCampaign(g, catalog);
  const eff = catalog.row(key)?.reward_effect || {};
  const id = nextLogId(g);
  const meta = { ...when(g), ref: id };
  const src = { type: "ambition", key };
  const applied = { models: [] };
  let to = null;
  const give = (m) => { addEntries(m, eff.improvements, src, meta); applied.models.push(m.uid); };
  switch (eff.target) {
    case "all":
      for (const m of g.models) if (categoryOf(m.profile) !== "sellswords") give(m);
      break;
    case "leader": {
      const l = g.models.find(isLeader);
      if (l) { give(l); to = l.uid; }
      break;
    }
    case "choose": {
      const m = rewardTargets(g, catalog, key).find(x => x.uid === uid);
      if (!m) throw new Error("Choose a model for this reward");
      give(m);
      to = m.uid;
      break;
    }
    case "spell": {
      if (!spell || !spellTargets(g, catalog, key).includes(spell)) {
        throw new Error("Choose one of the leader's spells for this reward");
      }
      applied.channel = spell;
      to = leaderOf(g).uid;
      break;
    }
    case "gathering":
      if (eff.deployment) {
        g.deploymentLimit = (g.deploymentLimit ?? catalog.rules.gathering?.deployment_limit ?? 350) + eff.deployment;
        applied.deployment = eff.deployment;
      }
      if (eff.bonus_traits) {
        g.bonusTraits = (g.bonusTraits || 0) + eff.bonus_traits;
        applied.bonus_traits = eff.bonus_traits;
      }
      break;
  }
  g.ambitions.progress[key] = 0;
  g.ambitions.completed += 1;
  g.ambitions.log.push({ id, ambition: key, to, ...when(g), applied });
  return eff.target === "treasure" ? { treasure: eff.treasure || "minor", ambition: id } : {};
}

/**
 * Undo a completed ambition (a mis-click): its entries come off, its
 * deployment, bonus trait and channelling bonus go back (the bonus lives
 * only in its log entry, so removing the entry removes it), its progress
 * returns to the goal, and
 * a treasure it gave is taken back from whoever holds it (if it still does).
 */
export function undoAmbition(g, logId, catalog) {
  ensureCampaign(g, catalog);
  const i = g.ambitions.log.findIndex(e => e.id === logId);
  if (i < 0) return false;
  const [e] = g.ambitions.log.splice(i, 1);
  for (const m of g.models) removeRef(m, logId);
  if (e.applied?.deployment) g.deploymentLimit = (g.deploymentLimit ?? catalog.rules.gathering?.deployment_limit ?? 350) - e.applied.deployment;
  if (e.applied?.bonus_traits) g.bonusTraits = Math.max(0, (g.bonusTraits || 0) - e.applied.bonus_traits);
  if (e.applied?.treasure) {
    const { key, to } = e.applied.treasure;
    // Where it was given first, else wherever it has been moved since.
    const lists = [to ? g.models.find(m => m.uid === to)?.treasures : g.stash, g.stash, ...g.models.map(m => m.treasures)];
    const list = lists.find(l => l?.includes(key));
    if (list) list.splice(list.indexOf(key), 1);
  }
  g.ambitions.completed = Math.max(0, g.ambitions.completed - 1);
  g.ambitions.progress[e.ambition] = Number(catalog.row(e.ambition)?.goal) || 1;
  return true;
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

/**
 * Add a treasure to a model, or to the gathering's stash (`to` = null).
 * `ambition`: the completed ambition (log id) whose reward this is, so
 * undoing the ambition can take it back.
 */
export function giveTreasure(g, key, to = null, { greaterClaim = false, ambition = null } = {}) {
  ensureCampaign(g);
  const m = to ? g.models.find(x => x.uid === to) : null;
  (m ? (m.treasures ||= []) : g.stash).push(key);
  if (greaterClaim) g.ambitions.greaterClaimed += 1;
  const log = ambition && g.ambitions.log.find(e => e.id === ambition);
  if (log) log.applied = { ...log.applied, treasure: { key, to: m ? to : null } };
}

/** Move a treasure: `from`/`to` are model uids, or null for the stash. */
export function moveTreasure(g, from, index, to) {
  ensureCampaign(g);
  const list = (uid) => (uid ? (g.models.find(x => x.uid === uid).treasures ||= []) : g.stash);
  const [key] = list(from).splice(index, 1);
  if (key) list(to).push(key);
  return key;
}

/* ---- sellswords (p.74) ----------------------------------------------------- */

/** Has the player ticked that the opponent's deployment limit is 100+ higher? */
export function freeSellsword(g) {
  return !!g.campaign?.opponentHigher;
}

/**
 * Add a sellsword to the roster, paying its roster cost unless `free`
 * (the Desperate Rabble, the first time the gathering faces such an opponent).
 */
export function hireSellsword(g, key, catalog, { free = false } = {}) {
  ensureCampaign(g, catalog);
  const rules = catalog.profileRules(key);
  const m = newModel(g, { profile: key, status: "reserve",
    affinity: (rules.affinity || []).length === 1 ? rules.affinity[0] : null });
  g.models.push(m);
  const cost = free ? 0 : Number(catalog.row(key)?.obols) || 0;
  if (free) g.campaign.freeRabbleUsed = true;
  pay(g, -cost);
  record(g, free ? "hire-free" : "hire", { item: key, uid: m.uid, obols: -cost });
  return m;
}

/* ---- battle log ------------------------------------------------------------ */

/** Log a battle; the obols it brought in go into the treasury. */
export function addBattle(g, entry, catalog) {
  ensureCampaign(g, catalog);
  if (g.treasury == null) startCampaign(g, catalog);   // before the first entry ends the build budget
  g.history.push({
    date: entry.date || today(),
    environment: entry.environment || null,
    mission: entry.mission || null,
    omen: entry.omen || null,
    result: entry.result || null,          // "win" | "loss" | "draw"
    obols: Number(entry.obols) || 0,
    notes: entry.notes || "",
    transactions: takeTransactions(g),
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
      date: battle.date || today(),
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
  let ref = null;
  if (def.stat_by && !["move", "violence", "ranged"].includes(stat)) throw new Error("Choose Move, Violence or Ranged");
  const changes = Object.fromEntries(maladyEntries(catalog.rules, def.key, stat).map(e => [e.stat, e.amount]));
  if (Object.keys(changes).length) {
    ref = addEntries(leader, changes, { type: "malady", key: def.key }, when(g));
  } else if (def.lose_minor_treasure && treasure != null) {
    a.done.lostTreasure = leader.treasures.splice(Number(treasure), 1)[0] || null;
  }
  a.done.maladies = { roll: Number(roll), key: def.key, stat, ref };
  return def;
}

/**
 * A typed-in d10: a whole number from 1 to 10. Anything else (blank, 0,
 * 11, 4.5, "x") throws an error with `code: "invalidDie"` (messages.js has
 * its text) and nothing is recorded, so the step can be applied again.
 */
export function d10(v) {
  const s = String(v ?? "").trim();
  const n = /^\d+$/.test(s) ? Number(s) : NaN;
  if (!(n >= 1 && n <= 10)) {
    const err = new Error(`Enter each die as a whole number from 1 to 10 (got "${s}")`);
    err.code = "invalidDie";
    throw err;
  }
  return n;
}

/** Step 2: victory rewards (30/20 + 2d10, and 2/1 minor treasure rolls). */
export function applyVictoryRewards(g, catalog, dice) {
  const a = ab(g);
  if (a.done.rewards) return 0;
  const r = catalog.rules.victory_rewards?.[a.battle.result === "loss" ? "loss" : "win"] || { obols: 0, treasures: 0 };
  const rolled = (dice || []).map(d10);
  if (r.dice != null && rolled.length !== r.dice) d10(null);
  const n = r.obols + rolled.reduce((s, x) => s + x, 0);
  gain(g, n);
  a.treasuresLeft += r.treasures;
  a.done.rewards = { dice: rolled, obols: n };
  return n;
}

/** Lair upgrades that bring +d10 obols after each scenario (p.71). */
export const incomeUpgrades = (g, catalog) =>
  (g.lair?.upgrades || []).filter(k => catalog.row(k)?.modifiers?.income);

export function applyLairIncome(g, catalog, key, roll) {
  const a = ab(g);
  a.done.income ||= {};
  if (a.done.income[key] != null || !incomeUpgrades(g, catalog).includes(key)) return 0;
  const n = d10(roll);
  gain(g, n);
  a.done.income[key] = n;
  return n;
}

/**
 * Purloiner (p.25): roll a d10; if ≤ the model's Move, gain d10 obols.
 * The second die is only needed (and only checked) when the first passes.
 */
export function applyPurloiner(g, uid, move, roll, obols) {
  const a = ab(g);
  a.done.purloiner ||= {};
  if (a.done.purloiner[uid] != null) return 0;
  const n = d10(roll) <= Number(move) ? d10(obols) : 0;
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

const isImprovised = (key) => /improvised-weapon$/.test(key || "");
/** Give a model a piece of gear; a real weapon replaces the free Improvised one. */
function equip(m, list, key) {
  if (list === "weapons" && m.weapons.length === 1 && isImprovised(m.weapons[0]) &&
      categoryOf(key) !== "thrown-weapons") m.weapons = [];
  (m[list] ||= []).push(key);
}
/** Take gear off a model; a model left with no weapon gets its free Improvised one back. */
function unequip(catalog, m, list, index) {
  const [key] = m[list].splice(Number(index), 1);
  if (list === "weapons" && !m.weapons.length) m.weapons.push(defaultWeapon(catalog, m.profile));
  return key;
}

/** Buy gear for a model in the Markets. */
export function buyGear(g, catalog, uid, list, key) {
  if (!GEAR_LISTS[list]) throw new Error("Not a gear list");
  const m = g.models.find(x => x.uid === uid);
  const cost = discounted(g, catalog, key);
  equip(m, list, key);
  pay(g, -cost);
  record(g, "buy", { item: key, uid, obols: -cost });
  return cost;
}

/** Recruit a new minion in the Markets. */
export function recruit(g, catalog, key, defaultWeapon) {
  const rules = catalog.profileRules(key);
  const m = newModel(g, { profile: key, weapons: [defaultWeapon],
    affinity: (rules.affinity || []).length === 1 ? rules.affinity[0] : null });
  g.models.push(m);
  const cost = price(catalog.row(key));
  pay(g, -cost);
  record(g, "recruit", { item: key, uid: m.uid, obols: -cost });
  return m;
}

/** Sell a weapon or armour for half its value, rounding down. */
export const sellValue = (catalog, key) => Math.floor(price(catalog.row(key)) / 2);
export function sellGear(g, catalog, uid, list, index) {
  if (list !== "weapons" && list !== "armour") throw new Error("Only weapons and armour sell");
  const m = g.models.find(x => x.uid === uid);
  // A model always has at least its free Improvised Weapon.
  const key = unequip(catalog, m, list, index);
  if (!key) return 0;
  const v = sellValue(catalog, key);
  pay(g, v);
  record(g, "sell", { item: key, uid, obols: v });
  return v;
}

/* ---- the gear stash ---------------------------------------------------------
 *
 * Not in the rulebook: p.72 (Markets) covers buying gear and selling weapons
 * and armour for half their value, and p.73 lets the gathering keep treasures
 * no model carries, but nothing says where gear taken off a model goes. The
 * gear stash is an app convenience for that: `g.gearStash` holds
 * `{ key, list }` entries (list = "weapons" | "armour" | "equipment", the list
 * it came off), separate from the treasure stash `g.stash`. Moving gear in and
 * out is free; from the stash, weapons and armour can still be sold for half
 * their value, and anything can be discarded. Each move is recorded like a
 * purchase, so it shows in the battle log and the ledger. Like buying and
 * selling, these moves have no undo of their own: the Builder's draft
 * (Discard) covers that.
 */

/**
 * Move a model's weapon, armour or equipment into the gear stash, for free.
 * The free Improvised Weapon is never stashed, only removed (and a model left
 * with no weapon gets it back, so removing a lone one changes nothing).
 * @returns {string|null}  the key stashed, or null if nothing was
 */
export function stashGear(g, catalog, uid, list, index) {
  if (!GEAR_LISTS[list]) throw new Error("Not a gear list");
  ensureCampaign(g, catalog);
  const m = g.models.find(x => x.uid === uid);
  if (!m?.[list]?.[Number(index)]) return null;
  const key = unequip(catalog, m, list, index);
  if (isImprovised(key)) return null;
  g.gearStash.push({ key, list });
  record(g, "stash", { item: key, uid, obols: 0 });
  return key;
}

/** Move gear from the stash to a model, for free (it replaces a lone Improvised Weapon). */
export function takeGear(g, uid, stashIndex) {
  ensureCampaign(g);
  const m = g.models.find(x => x.uid === uid);
  if (!m) throw new Error("No such model");
  const [e] = g.gearStash.splice(Number(stashIndex), 1);
  if (!e) return null;
  equip(m, e.list, e.key);
  record(g, "take", { item: e.key, uid, obols: 0 });
  return e.key;
}

/** Sell a stashed weapon or armour for half its value; equipment can't be sold (p.72). */
export function sellStashedGear(g, catalog, stashIndex) {
  ensureCampaign(g, catalog);
  const e = g.gearStash[Number(stashIndex)];
  if (!e) return 0;
  if (e.list !== "weapons" && e.list !== "armour") throw new Error("Only weapons and armour sell");
  g.gearStash.splice(Number(stashIndex), 1);
  const v = sellValue(catalog, e.key);
  pay(g, v);
  record(g, "sell", { item: e.key, uid: null, obols: v });
  return v;
}

/** Throw away a piece of stashed gear. */
export function discardStashedGear(g, stashIndex) {
  ensureCampaign(g);
  const [e] = g.gearStash.splice(Number(stashIndex), 1);
  if (!e) return null;
  record(g, "discard", { item: e.key, uid: null, obols: 0 });
  return e.key;
}

/** Sell a treasure: minor 10 obols, greater 50. `from` = uid, or null for the stash. */
export function sellTreasure(g, catalog, from, index) {
  const list = from ? g.models.find(x => x.uid === from).treasures : g.stash;
  const [key] = list.splice(Number(index), 1);
  if (!key) return 0;
  const b = catalog.rules.bazaar || {};
  const v = treasureKind(catalog, key) === "greater" ? b.sell_greater_treasure ?? 50 : b.sell_minor_treasure ?? 10;
  pay(g, v);
  record(g, "sell", { item: key, uid: from, obols: v });
  return v;
}

/** Soul Binder: 50 obols removes a malady, and with it its effect. */
export function soulBinder(g, catalog, uid, ref) {
  const m = g.models.find(x => x.uid === uid);
  if (!maladiesOf(m, catalog.rules).some(x => x.ref === ref)) return false;
  const key = maladiesOf(m, catalog.rules).find(x => x.ref === ref).key;
  removeRef(m, ref);
  const cost = catalog.rules.bazaar?.soul_binder ?? 50;
  pay(g, -cost);
  record(g, "soul-binder", { item: key, uid, obols: -cost });
  return true;
}

/** Tomb Robber: once per gathering, pay 30 for the minor treasure rolled. */
export function tombRobber(g, catalog, key, { pay: buy = true, to = null } = {}) {
  ensureCampaign(g, catalog);
  if (g.campaign.tombRobberUsed) return false;
  g.campaign.tombRobberUsed = true;
  if (!buy) return false;
  const cost = catalog.rules.bazaar?.tomb_robber ?? 30;
  g.treasury = (Number(g.treasury) || 0) - cost;
  record(g, "tomb-robber", { item: key, uid: to, obols: -cost });
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
  const cost = price(catalog.row(key));
  pay(g, -cost);
  record(g, "alchemy", { item: key, uid: to, obols: -cost });
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

/** The purchases and sales since the last battle, handed to its log entry. */
function takeTransactions(g) {
  const t = g.campaign?.transactions || [];
  if (g.campaign) g.campaign.transactions = [];
  return t;
}

/** Finish: log the battle (its obols are already in the treasury). */
export function finishAfterBattle(g, nextScenario = null) {
  const a = ab(g);
  g.history.push({
    date: a.battle.date, environment: a.battle.environment, mission: a.battle.mission,
    omen: a.battle.omen, result: a.battle.result, obols: a.obols, notes: a.battle.notes,
    transactions: takeTransactions(g),
  });
  g.campaign.nextScenario = nextScenario;
  delete g.campaign.afterBattle;
}
