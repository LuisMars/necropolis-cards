/**
 * The builder's own save format ("necropolis-gathering", version 1).
 *
 * It stores what the player chose, by catalog key, and nothing derived:
 * costs, stats and warnings come from rules.js on every read. What the
 * Companion App can't hold (model names, a uid per model, the leader's mana
 * split, campaign state) is part of the format itself.
 *
 *   { format, version, id, name, covenant, lair, treasury, deploymentLimit,
 *     bonusTraits, uidSeq, models: [Model], stash, gearStash, ambitions, campaign, history }
 *   `treasury` is null until the campaign starts; from then on it replaces
 *   the 300-obol build budget.
 *   Model = { uid, name, profile, affinity, mana, traits, spells, weapons,
 *             armour, equipment, treasures, maladies, improvements, status }
 */

export const FORMAT = "necropolis-gathering";
export const VERSION = 1;

export function newGathering(fields = {}) {
  return {
    format: FORMAT,
    version: VERSION,
    id: fields.id || newId(),
    name: "",
    covenant: null,
    lair: { name: "", upgrades: [] },
    treasury: null,          // set once the campaign starts
    deploymentLimit: null,   // null = the rulebook default (350)
    bonusTraits: 0,
    models: [],
    stash: [],               // treasures no model is carrying
    gearStash: [],           // gear no model is carrying: { key, list } (an app convenience)
    ambitions: { active: [], progress: {}, completed: 0, greaterClaimed: 0, log: [] },
    campaign: { opponentHigher: false, freeRabbleUsed: false },
    history: [],
    ...fields,
  };
}

export function newModel(gathering, fields = {}) {
  return {
    uid: nextUid(gathering),
    name: "",
    profile: null,
    affinity: null,
    mana: {},
    traits: [],
    spells: [],
    weapons: [],
    armour: [],
    equipment: [],
    treasures: [],
    maladies: [],
    improvements: {},
    status: "active",
    ...fields,
  };
}

/**
 * "m1", "m2", … — a uid never used before in `gathering`, so a removed
 * model's uid is not handed to a new one: the battle log, the ambitions log
 * and the transactions keep pointing at the model they were written for.
 * `gathering.uidSeq` remembers the highest number handed out; saves from
 * before it existed are scanned for every uid they still mention. Existing
 * uids are never changed.
 */
export function nextUid(gathering) {
  let n = Number(gathering.uidSeq) || 0;
  const see = (s) => { const m = /^m(\d+)$/.exec(s); if (m) n = Math.max(n, Number(m[1])); };
  for (const m of gathering.models || []) see(String(m.uid));
  const walk = (v) => {
    if (typeof v === "string") see(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { see(k); walk(x); }
  };
  walk([gathering.history, gathering.ambitions?.log, gathering.campaign]);
  gathering.uidSeq = n + 1;
  return `m${n + 1}`;
}

function newId() {
  return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
