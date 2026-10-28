/**
 * Companion App JSON ↔ builder gatherings.
 *
 * Import takes the app's export as it is today (2026-10-28): covenant name,
 * then per model a `profile` plus traits, spells, weapons and armour, all by
 * name. Older exports also carried `modelName`, `totalObols` and `manaPool`,
 * and our own export adds them back, because the Warband roster reads them.
 * Names are matched with the importer's `normName`, which already knows the
 * app's spellings ("Claws/Fangs 2h", "Polearm 1h", "Regenating Soul").
 */

import { normName } from "../matching.js";
import { categoryOf, TRAIT_CATEGORIES } from "./catalog.js";
import { newGathering, newModel } from "./gathering.js";
import { evaluate, AFFINITIES } from "./rules.js";
import { defaultWeapon } from "./codec.js";
import { maladiesOf } from "./ledger.js";

/** Sources a campaign adds (the card's keyword and traits are already in its stats). */
const CAMPAIGN_SOURCES = ["ambition", "malady", "manual", "lair"];

const LISTS = {
  profile:   ["leaders", "minions"],
  traits:    TRAIT_CATEGORIES,
  spells:    ["spells"],
  weapons:   ["melee-weapons", "ranged-weapons", "thrown-weapons"],
  colossal:  ["colossal-weapons"],
  armour:    ["armours"],
  equipment: ["miscellaneous-equipment", "thrown-weapons"],
};

/** First key in `categories` (in order) whose row name matches `name`. */
function lookup(catalog, categories, name) {
  const n = normName(name);
  for (const cat of categories) {
    for (const [key, r] of catalog.rows) {
      if (r.category === cat && normName(r.row.name) === n) return key;
    }
  }
  return null;
}

/** Covenant key for the app's covenant string ("Cairn-born, Faithful of …"). */
function covenantKey(catalog, text) {
  const first = normName(String(text || "").split(",")[0]);
  for (const c of catalog.rules.covenants || []) {
    if (normName(String(c.app_name || "").split(",")[0]) === first) return c.key;
    if (normName(catalog.row(c.key)?.name) === first) return c.key;
  }
  return null;
}

/**
 * @param {object} json  the app's export (parsed)
 * @returns {{gathering, unmatched: {where, name}[]}}
 */
export function fromAppJson(json, catalog) {
  const unmatched = [];
  const g = newGathering();
  g.covenant = covenantKey(catalog, json.covenant);
  if (json.covenant && !g.covenant) unmatched.push({ where: "covenant", name: json.covenant });

  for (const entry of json.gathering || []) {
    const p = entry.profile || {};
    const profile = lookup(catalog, LISTS.profile, p.name);
    if (!profile) { unmatched.push({ where: "profile", name: p.name }); continue; }
    const colossal = (catalog.profileRules(profile).weapons_only || []).includes("colossal-weapons/*");
    const aff = String(p.affinity || "").toLowerCase();
    const m = newModel(g, {
      name: entry.modelName || "",
      profile,
      affinity: AFFINITIES.includes(aff) ? aff : null,
    });
    const take = (where, list, cats) => {
      for (const it of list || []) {
        const name = it?.name ?? it;
        const key = lookup(catalog, cats, name);
        if (key) m[where].push(key); else unmatched.push({ where, name });
      }
    };
    take("traits", entry.traits, LISTS.traits);
    take("spells", entry.spells, LISTS.spells);
    take("weapons", entry.weapons, colossal ? LISTS.colossal : LISTS.weapons);
    take("armour", entry.armour, LISTS.armour);
    take("equipment", entry.miscEquipment || entry.equipment, LISTS.equipment);
    if (!m.weapons.length) m.weapons.push(defaultWeapon(catalog, profile));
    g.models.push(m);
  }

  // Older exports carry the leader's mana pool at the top level.
  const leader = g.models.find(m => categoryOf(m.profile) === "leaders");
  if (leader && json.manaPool) {
    for (const a of AFFINITIES) {
      const v = Number(json.manaPool[a] ?? json.manaPool[a.charAt(0).toUpperCase() + a.slice(1)]);
      if (v) leader.mana[a] = v;
    }
  }
  return { gathering: g, unmatched };
}

/** "1 / 3" → [1, 3]. */
function damage(s) {
  const [glance, hit] = String(s ?? "").split("/").map(x => parseInt(x, 10));
  return { damageGlance: glance || 0, damageHit: hit || 0 };
}
const int = (v) => { const n = parseInt(String(v ?? ""), 10); return Number.isFinite(n) ? n : 0; };
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** The English text of a row field, without "—" placeholders. */
const text = (row, k) => { const v = String(row?.[k] ?? "").trim(); return v === "—" ? "" : v; };

/**
 * Export in the app's JSON shape, plus `modelName`, `totalObols` and
 * `manaPool` for the Warband roster. This is also what the roster renders.
 */
export function toAppJson(gathering, catalog) {
  const ev = evaluate(gathering, catalog);
  const cov = catalog.covenant(gathering.covenant);
  const leaderIdx = ev.models.findIndex(m => m.isLeader);
  const leader = leaderIdx >= 0 ? gathering.models[leaderIdx] : null;

  const out = {
    covenant: cov?.app_name || catalog.row(gathering.covenant)?.name || "",
    // The roster compares its total against this: the 300 to build, or the
    // deployment limit once the campaign has started.
    totalObols: ev.budget ?? ev.deploymentLimit,
    gathering: gathering.models.map((m, i) => {
      const e = ev.models[i];
      const row = catalog.row(m.profile) || {};
      const profile = {
        name: row.name || "",
        affinity: m.affinity ? capital(m.affinity) : "Blood/Bone/Plasm",
        hp: e.stats.hp,
        ...(e.isLeader ? { mana: e.mana, maxSpells: Math.max(0, e.spellsAllowed - 1) } : {}),
        actionPoints: e.stats.ap,
        move: e.stats.move,
        violence: e.stats.violence ?? 0,
        ranged: e.stats.ranged ?? 0,
        keywords: e.keywords.filter(k => k !== "Leader" && !AFFINITIES.includes(k.toLowerCase())),
        obols: int(row.obols),
      };
      const named = (keys, fn) => (keys || []).map(k => fn(catalog.row(k) || { name: k }));
      const entry = {
        ...(m.name ? { modelName: m.name } : {}),
        profile,
        traits: named(m.traits, r => ({ name: r.name, effect: text(r, "effect") })),
        spells: named(m.spells, r => ({
          name: r.name, school: r.school, apCost: int(r.ap), channel: int(r.channel),
          effect: text(r, "effect"),
        })),
        weapons: named(m.weapons, r => ({
          name: r.name, attacks: int(r.attacks), ...damage(r.damage), range: int(r.range),
          obols: int(r.obols), ...(text(r, "special") ? { special: [text(r, "special")] } : {}),
        })),
        armour: named(m.armour, r => ({ name: r.name, armour: int(r.armour), obols: int(r.obols) })),
        miscEquipment: named(m.equipment, r => ({ name: r.name, obols: int(r.obols) })),
      };
      // Like the app, leave out empty lists.
      for (const k of ["traits", "spells", "weapons", "armour", "miscEquipment"]) {
        if (!entry[k].length) delete entry[k];
      }
      // Our addition, which the app ignores: what the campaign changed and
      // why, for the Warband roster to mark and list.
      const changes = {};
      for (const [stat, list] of Object.entries(e.sources || {})) {
        const c = list.filter(x => CAMPAIGN_SOURCES.includes(x.type))
          .map(x => ({ amount: x.amount, type: x.type, key: x.key || null, note: x.note || null }));
        if (c.length) changes[stat] = c;
      }
      const maladies = maladiesOf(m, catalog.rules).map(x => ({ key: x.key, stat: x.stat }));
      if (Object.keys(changes).length || maladies.length) entry.builder = { changes, maladies };
      return entry;
    }),
  };
  if (leader && Object.values(leader.mana || {}).some(Number)) {
    out.manaPool = Object.fromEntries(AFFINITIES.filter(a => leader.mana[a]).map(a => [a, leader.mana[a]]));
  }
  return out;
}
