/**
 * The builder's own save format ("necropolis-gathering", version 1).
 *
 * It stores what the player chose, by catalog key, and nothing derived:
 * costs, stats and warnings come from rules.js on every read. What the
 * Companion App can't hold (model names, a uid per model, the leader's mana
 * split, campaign state) is part of the format itself.
 *
 *   { format, version, id, name, covenant, lair, treasury, deploymentLimit,
 *     bonusTraits, models: [Model], ambitions, history }
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
    ambitions: { active: [], progress: {}, completed: 0 },
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

/** "m1", "m2", … — the first number no model in `gathering` uses yet. */
export function nextUid(gathering) {
  const used = new Set((gathering.models || []).map(m => m.uid));
  let n = 1;
  while (used.has(`m${n}`)) n++;
  return `m${n}`;
}

function newId() {
  return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
