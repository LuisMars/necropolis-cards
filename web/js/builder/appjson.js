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
  // Thrown weapons are Miscellaneous Equipment (p.41): read from either
  // list, they are filed under `equipment` (see `take` below).
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
        if (key) m[categoryOf(key) === "thrown-weapons" ? "equipment" : where].push(key);
        else unmatched.push({ where, name });
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

  // Our own export's gathering-level block: the gear stash (by key).
  for (const e of json.builder?.gearStash || []) {
    if (e && GEAR_LISTS.includes(e.list) && catalog.row(e.key)) g.gearStash.push({ key: e.key, list: e.list });
    else unmatched.push({ where: "gearStash", name: e?.name || e?.key || String(e) });
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

const GEAR_LISTS = ["weapons", "armour", "equipment"];

/* ---- profile special rules ----------------------------------------------
 *
 * The Companion App exports each profile's special rules as
 * `profile.special: [{name?, effect}]`, and the Warband roster reads them
 * from there (warband.js `profileSpecials`): a rule with a card is shown from
 * its card, a named one without from the glossary (data/app-glossary.yaml),
 * an unnamed restriction from the glossary by its exact text. To give a
 * gathering built here the same lines, we rebuild that list from the
 * catalogue: each paragraph of the profile's `special_rules`, named after
 * its card or glossary rule when it has one; the app's own wording (the
 * glossary phrases) for the unnamed restrictions; and, for leaders, the
 * Bone/Blood/Plasm Leader rule their affinity gives (builder-rules.yaml
 * `leader_affinity_mods`). Affinity rules that don't match the model's
 * chosen affinity are left out, as the roster hides them anyway; rules the
 * card marks "(already factored in)" are left out too, as the app does
 * (a Skeletal Husk's Bone Warrior is in its base stats).
 */

const AFFINITY_RULE = /^\s*(bone|blood|plasm)\s+(?:warrior|leader)\b/i;
/** The app's spellings of a subject in its unnamed restrictions. */
const PHRASE_SUBJECTS = { familliar: "familiar", "necrotic remnant": "necromantic remnant" };

const specialCache = new WeakMap();
function specialIndex(catalog) {
  if (specialCache.has(catalog)) return specialCache.get(catalog);
  const cards = new Map();
  for (const r of catalog.rows.values()) {
    if (r.category === "special-rules") cards.set(normName(r.row.name), r.row);
  }
  const gl = catalog.bundle?.glossary || {};
  const rules = new Map((gl.rules || []).filter(r => r?.en).map(r => [normName(r.en), r]));
  const phrases = new Map();
  for (const ph of gl.phrases || []) {
    const subject = /^(.*?)\s+can(?:not)?\b/i.exec(ph?.en || "")?.[1];
    if (!subject) continue;
    const n = normName(subject);
    const who = PHRASE_SUBJECTS[n] || n;
    phrases.set(who, [...(phrases.get(who) || []), ph.en]);
  }
  const idx = { cards, rules, phrases };
  specialCache.set(catalog, idx);
  return idx;
}

/** Numbers in a rule text, unsigned ("-2 HP" → "2"). */
const numbersIn = (s) => new Set(String(s || "").match(/\d+/g) || []);

/**
 * A profile's own wording of a shared rule, when it disagrees with the card.
 * One card can serve several profiles with different values: Plasm Warrior's
 * card is the Necromantic Remnant's "-1 HP", while the Small Beast, Aberrant
 * Husk and Gigantic Horror lose 2 (pp.32-35). The profile's paragraph wins
 * when it holds a number the card's text doesn't; otherwise the card does.
 * @param {object} row  the profile's data row (leaders / minions)
 * @param {string} name  the rule's English name ("Plasm Warrior")
 * @param {object} card  the rule's special-rules row
 * @returns {{en: string, es: string}|null}  the paragraph's text after its name
 */
export function ownRuleText(row, name, card) {
  if (!row || !name || !card) return null;
  const paras = (v) => String(v || "").split(/\n+/).map(x => x.trim()).filter(Boolean);
  const split = (p) => /^([^.:]+)[.:]\s*(.*)$/s.exec(p);
  const en = paras(row.special_rules);
  const i = en.findIndex(p => normName(split(p)?.[1] || "") === normName(name));
  if (i < 0) return null;
  const own = split(en[i])[2];
  const cardNums = numbersIn(card.effect);
  if (![...numbersIn(own)].some(n => !cardNums.has(n))) return null;
  const es = split(paras(row.special_rules_es)[i] || "")?.[2] || "";
  return { en: own, es: es || own };
}

/**
 * A profile's special rules in the app's `profile.special` shape.
 * @param {string|null} affinity  the model's chosen affinity ("bone"), if any
 */
export function profileSpecial(catalog, profileKey, affinity = null) {
  const row = catalog.row(profileKey);
  if (!row) return [];
  const { cards, rules, phrases } = specialIndex(catalog);
  const out = [];
  const applies = (name) => {
    const cond = AFFINITY_RULE.exec(name || "")?.[1]?.toLowerCase();
    return !cond || !affinity || cond === affinity;
  };
  let ownPhrases = phrases.get(normName(row.name)) || [];
  for (const para of String(row.special_rules || "").split(/\n+/).map(x => x.trim()).filter(Boolean)) {
    if (/already factored in/i.test(para)) continue;
    const m = /^([^.:]+)[.:]\s*(.*)$/s.exec(para);
    const name = m?.[1]?.trim() || "";
    const card = cards.get(normName(name));
    const gloss = rules.get(normName(name));
    if (card || gloss) {
      const ruleName = card?.name || gloss.en;
      // The card's text, else this profile's own (the glossary's "Unique"
      // effect is the Familiar's). A profile whose values differ from the
      // card's (Plasm Warrior -2 HP) keeps its own.
      const own = card && ownRuleText(row, ruleName, card);
      if (applies(ruleName)) out.push({ name: ruleName, effect: own?.en || (card && text(card, "effect")) || m[2] });
    } else if (ownPhrases.length) {
      // An unnamed restriction: the app's own wording, which the glossary keys.
      out.push(...ownPhrases.map(effect => ({ effect })));
      ownPhrases = [];
    } else if (m && m[2] && name.split(/\s+/).length <= 3) {
      out.push({ name, effect: m[2] });
    } else {
      out.push({ effect: para });
    }
  }
  if (categoryOf(profileKey) === "leaders") {
    for (const a of AFFINITIES) {
      const card = cards.get(normName(`${a} leader`));
      if (card && applies(card.name)) out.push({ name: card.name, effect: text(card, "effect") });
    }
  }
  return out;
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
 * `manaPool` for the Warband roster, and `builder` blocks the app ignores
 * (per model: the campaign's changes; per gathering: the gear stash). This is also what the roster renders.
 */
export function toAppJson(gathering, catalog) {
  const ev = evaluate(gathering, catalog);
  const cov = catalog.covenant(gathering.covenant);
  const leaderIdx = ev.models.findIndex(m => m.isLeader);
  const leader = leaderIdx >= 0 ? gathering.models[leaderIdx] : null;
  // Channelling bonuses from completed ambitions (as campaign.js's channelBonuses).
  const channel = {};
  for (const e of gathering.ambitions?.log || []) if (e.applied?.channel) channel[e.applied.channel] = (channel[e.applied.channel] || 0) + 1;

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
      // The profile's special rules (Caster, Bone Leader, …), as the app exports them.
      const special = profileSpecial(catalog, m.profile, m.affinity);
      if (special.length) profile.special = special;
      const named = (keys, fn) => (keys || []).map(k => fn(catalog.row(k) || { name: k }));
      const entry = {
        ...(m.name ? { modelName: m.name } : {}),
        profile,
        traits: named(m.traits, r => ({ name: r.name, effect: text(r, "effect") })),
        spells: named(m.spells, r => ({
          name: r.name, school: r.school, apCost: int(r.ap), channel: int(r.channel),
          effect: text(r, "effect"),
        // Our addition, which the app ignores: an ambition's +N to channel
        // it (Master Abyssal Artillery), for the roster's spell line.
        })).map((s, j) => (channel[m.spells[j]] ? { ...s, channelBonus: channel[m.spells[j]] } : s)),
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
  // Our gathering-level addition, which the app ignores: the gear stash.
  if ((gathering.gearStash || []).length) {
    out.builder = { gearStash: gathering.gearStash.map(e => ({
      key: e.key, list: e.list, name: catalog.row(e.key)?.name || e.key })) };
  }
  if (leader && Object.values(leader.mana || {}).some(Number)) {
    out.manaPool = Object.fromEntries(AFFINITIES.filter(a => leader.mana[a]).map(a => [a, leader.mana[a]]));
  }
  return out;
}
