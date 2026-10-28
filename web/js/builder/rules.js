/**
 * Builder rules engine — costs, effective stats and warnings for a gathering.
 *
 * The builder warns rather than blocks: `evaluate` never refuses a
 * gathering, it reports every rule it breaks as a warning
 * `{code, model?, item?, params?}` (model = the model's uid, item = a row key)
 * and the UI decides how to show it. Nothing here is stored: a save holds
 * only the player's choices, and this recomputes the rest from data.json.
 *
 * Rules: WIP Necropolis Rules 0.9, pp. 17-41 (creation) and p.65 (limits).
 */

import { categoryOf, matches, TRAIT_CATEGORIES, WEAPON_CATEGORIES } from "./catalog.js";

export const AFFINITIES = ["blood", "bone", "plasm"];
const STATS = ["ap", "move", "violence", "ranged", "hp"];

/** "7+" → 7, "—" → null, 3 → 3. */
function num(v) {
  if (typeof v === "number") return v;
  const m = /-?\d+/.exec(String(v ?? ""));
  return m ? parseInt(m[0], 10) : null;
}

const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Sum stat modifier objects ({hp: 2}, {violence: 1}, …) into one. */
function addMods(...mods) {
  const out = {};
  for (const m of mods) {
    for (const [k, v] of Object.entries(m || {})) {
      if (typeof v === "number") out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}

/** Every gear key a model carries, weapons first. */
const gearOf = (m) => [...(m.weapons || []), ...(m.armour || []), ...(m.equipment || [])];

/**
 * Evaluate one model.
 * @returns {{uid, key, isLeader, affinity, keywords, stats, mana, spellsAllowed,
 *            cost, warnings}}
 */
export function evaluateModel(model, catalog, gathering = {}) {
  const warnings = [];
  const warn = (code, extra = {}) => warnings.push({ code, model: model.uid, ...extra });
  const rules = catalog.rules;
  const key = model.profile;
  const row = catalog.row(key);
  const isLeader = categoryOf(key) === "leaders";
  const pr = catalog.profileRules(key);

  if (!row) {
    warn("unknown-item", { item: key });
    return { uid: model.uid, key, isLeader, affinity: null, keywords: [], stats: {},
             mana: 0, spellsAllowed: 0, cost: 0, warnings };
  }

  // Affinity: leaders choose any of the three; minions what their rules allow.
  const allowed = isLeader ? AFFINITIES : (pr.affinity || AFFINITIES);
  let affinity = model.affinity || (allowed.length === 1 ? allowed[0] : null);
  if (!affinity) warn("affinity-missing");
  else if (!allowed.includes(affinity)) warn("affinity-not-allowed", { params: { affinity } });

  const affMods = (isLeader ? rules.leader_affinity_mods : pr.affinity_mods)?.[affinity] || {};

  // Traits: unknown keys, duplicates, requirements, stat modifiers.
  const traitRows = [];
  const seen = new Set();
  for (const t of model.traits || []) {
    const tr = catalog.row(t);
    if (!tr) { warn("unknown-item", { item: t }); continue; }
    if (seen.has(t)) warn("duplicate-trait", { item: t });
    seen.add(t);
    traitRows.push({ key: t, row: tr });
  }
  const traitMods = addMods(...traitRows.map(t => t.row.modifiers));
  const imp = model.improvements || {};

  // Keywords: the type's own, its affinity, and any a modifier grants (Fly).
  const keywords = [...new Set([
    ...(pr.keywords || (isLeader ? ["Leader"] : [])),
    ...(affinity ? [capital(affinity)] : []),
    ...(affMods.keywords || []),
  ])];

  for (const t of traitRows) {
    const req = t.row.requires || {};
    const kwOk = !req.keywords || req.keywords.some(k => keywords.includes(k));
    const affOk = !req.affinity || req.affinity.includes(capital(affinity));
    const leaderOk = !req.not_leader || !isLeader;
    if (!kwOk || !affOk || !leaderOk) warn("trait-requirement", { item: t.key });
  }

  // Stats: card base + affinity + traits + campaign improvements (capped).
  const s = row.stats || {};
  const base = { ap: num(s.AP), move: num(s.M), violence: num(s.VIOL), ranged: num(s.RNGD), hp: num(s.HP) };
  const mod = addMods(affMods, traitMods, imp);
  const caps = rules.improvement_caps || {};
  for (const k of STATS) {
    if (caps[k] != null && (imp[k] || 0) > caps[k]) warn("improvement-cap", { params: { stat: k, max: caps[k] } });
  }
  const stats = {
    ap: base.ap + (mod.ap || 0),
    move: base.move + (mod.move || 0),
    // Violence and Ranged are target numbers: improving by 1 lowers the target.
    violence: base.violence == null ? null : base.violence - (mod.violence || 0),
    ranged: base.ranged == null ? null : base.ranged - (mod.ranged || 0),
    hp: base.hp + (mod.hp || 0),
  };

  // Gear: forbidden items, whitelists, hands, one body armour / shield / misc item.
  const forbid = [...(pr.forbid || []), ...(affMods.forbid || [])];
  const except = pr.except || [];
  let hands = 0, bodies = 0, shields = 0, misc = 0;
  for (const g of gearOf(model)) {
    const gr = catalog.row(g);
    if (!gr) { warn("unknown-item", { item: g }); continue; }
    if (forbid.some(sel => matches(catalog, g, sel)) && !except.includes(g)) {
      warn("forbidden-item", { item: g });
    }
    const cat = categoryOf(g);
    if (WEAPON_CATEGORIES.includes(cat)) {
      if (pr.weapons_only && !pr.weapons_only.some(sel => matches(catalog, g, sel))) {
        warn("weapon-not-allowed", { item: g });
      }
      // Thrown weapons are stowed, not held (the Companion App files them
      // under equipment too), so they don't take a hand.
      if (cat !== "thrown-weapons") hands += Number(gr.hands) || 0;
    }
    if (gr.slot === "body") bodies++;
    if (gr.slot === "shield") { shields++; hands++; }
    if (cat === "miscellaneous-equipment") misc++;
  }
  if (hands > 2) warn("too-many-hands", { params: { hands } });
  if (bodies > 1) warn("multiple-armour");
  if (shields > 1) warn("multiple-shields");
  const maxMisc = rules.gathering?.max_equipment ?? 1;
  if (misc > maxMisc) warn("too-much-equipment", { params: { count: misc, max: maxMisc } });

  // Traits per model: leaders up to 3 (one Basic Leader Trait), minions 1.
  const maxTraits = isLeader ? (rules.gathering?.leader_max_traits ?? 3)
                             : (rules.gathering?.minion_max_traits ?? 1);
  if (traitRows.length > maxTraits) {
    warn("too-many-traits", { params: { count: traitRows.length, max: maxTraits } });
  }
  if (isLeader) {
    const basic = traitRows.filter(t => categoryOf(t.key) === "basic-leader-traits").length;
    if (basic !== 1) warn("basic-trait-count", { params: { count: basic } });
  }

  // Spells and mana (leaders): Summon + the type's picks + Studious; mana
  // points split between Blood/Bone/Plasm, + Sorcerous Talent.
  let spellsAllowed = 0, mana = 0;
  const spells = model.spells || [];
  if (isLeader) {
    spellsAllowed = 1 + (pr.spells || 0) + (traitMods.spells || 0);
    if (pr.max_spells) spellsAllowed = Math.min(spellsAllowed, pr.max_spells);
    if (spells.length !== spellsAllowed) {
      warn("spell-count", { params: { count: spells.length, allowed: spellsAllowed } });
    }
    if (!spells.includes("spells/summon")) warn("summon-missing");
    let manaAllowed = (pr.mana_points || 0) + (traitMods.mana || 0);
    if (pr.max_mana) manaAllowed = Math.min(manaAllowed, pr.max_mana);
    mana = manaAllowed;
    const split = AFFINITIES.reduce((n, a) => n + (Number(model.mana?.[a]) || 0), 0);
    if (split !== manaAllowed) warn("mana-split", { params: { count: split, allowed: manaAllowed } });
  } else if (spells.length) {
    warn("spells-on-minion");
  }
  for (const sp of spells) if (!catalog.row(sp)) warn("unknown-item", { item: sp });

  // Covenant: keyword lock, leader type, initial spell schools, leader trait.
  const cov = catalog.covenant(gathering.covenant);
  if (cov) {
    if (cov.keywords_any && !cov.keywords_any.some(k => keywords.includes(k))) {
      warn("covenant-keyword", { params: { needs: cov.keywords_any } });
    }
    if (isLeader && cov.leader_types && !cov.leader_types.includes(key)) {
      warn("covenant-leader-type", { params: { allowed: cov.leader_types } });
    }
    const started = (gathering.history || []).length > 0;
    if (isLeader && cov.spell_schools && !started) {
      for (const sp of spells) {
        const school = catalog.row(sp)?.school;
        if (school && !cov.spell_schools.includes(school)) warn("covenant-spell-school", { item: sp });
      }
    }
    if (isLeader && cov.leader_trait && !(model.traits || []).includes(cov.leader_trait)) {
      warn("covenant-leader-trait-missing", { item: cov.leader_trait });
    }
  }

  const cost = (num(row.obols) || 0) +
    gearOf(model).reduce((n, g) => n + (num(catalog.row(g)?.obols) || 0), 0);

  return { uid: model.uid, key, isLeader, affinity, keywords, stats, mana, spellsAllowed, cost, warnings };
}

/**
 * Evaluate a whole gathering.
 * @returns {{models, total, budget, deploymentLimit, warnings}}  `warnings`
 *          holds gathering-level and model-level warnings together.
 */
export function evaluate(gathering, catalog) {
  const rules = catalog.rules;
  const models = (gathering.models || []).map(m => evaluateModel(m, catalog, gathering));
  const warnings = [];
  const warn = (code, extra = {}) => warnings.push({ code, ...extra });

  if (!gathering.covenant) warn("no-covenant");
  else if (!catalog.covenant(gathering.covenant)) warn("unknown-item", { item: gathering.covenant });

  const leaders = models.filter(m => m.isLeader);
  if (leaders.length === 0) warn("no-leader");
  if (leaders.length > 1) warn("multiple-leaders", { params: { count: leaders.length } });

  // Unique model types (Familiar, Large Beast, Gigantic Horror) and traits (Apprentice).
  const count = (keys) => keys.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map());
  for (const [k, n] of count((gathering.models || []).map(m => m.profile))) {
    if (n > 1 && catalog.profileRules(k).unique) warn("unique-model", { item: k, params: { count: n } });
  }
  const allTraits = (gathering.models || []).flatMap(m => [...new Set(m.traits || [])]);
  for (const [k, n] of count(allTraits)) {
    if (n > 1 && catalog.row(k)?.requires?.unique) warn("unique-trait", { item: k, params: { count: n } });
  }

  // Covenant / Wretched Undead traits: 1 model (Wretched Undead: 2), plus any
  // a campaign has granted since (`bonusTraits`).
  const cov = catalog.covenant(gathering.covenant);
  if (cov) {
    const extra = allTraits.filter(k =>
      ["covenant-wretched-traits", "wretched-undead-traits"].includes(categoryOf(k))).length;
    const allowedExtra = (cov.traits ?? 1) + (gathering.bonusTraits || 0);
    if (extra > allowedExtra) warn("covenant-traits", { params: { count: extra, allowed: allowedExtra } });
  }

  // Budget: 300 obols to build (+50 for Miserly) until the first battle;
  // after that the treasury is tracked by the campaign. Deployment limit
  // applies to the models fielded.
  const total = models.reduce((n, m) => n + m.cost, 0);
  const started = (gathering.history || []).length > 0;
  const bonus = models.filter(m => m.isLeader).reduce((n, m) => {
    const traits = (gathering.models.find(x => x.uid === m.uid)?.traits) || [];
    return n + traits.reduce((t, k) => t + (catalog.row(k)?.modifiers?.obols || 0), 0);
  }, 0);
  const budget = started ? null : (rules.gathering?.starting_obols ?? 300) + bonus;
  if (budget != null && total > budget) warn("over-budget", { params: { total, budget } });

  const deploymentLimit = gathering.deploymentLimit ?? rules.gathering?.deployment_limit ?? 350;
  const fielded = models.filter((m, i) => (gathering.models[i].status || "active") === "active")
                        .reduce((n, m) => n + m.cost, 0);
  if (fielded > deploymentLimit) warn("over-deployment", { params: { total: fielded, limit: deploymentLimit } });

  return {
    models, total, budget, deploymentLimit,
    warnings: [...warnings, ...models.flatMap(m => m.warnings)],
  };
}
