/**
 * Builder catalog — every card row the builder can reference, by stable key.
 *
 * A key is "<category>/<slug of the English name>", e.g.
 * "melee-weapons/claws-and-fangs". Saved gatherings store keys, never row
 * copies, so a rules fix in data/*.yaml reaches every saved warband. Rows
 * also carry the Companion App's share-link `app_id`, which `byApp` maps
 * back to a key.
 *
 * Pure: takes the parsed data.json, touches no DOM or global state, so the
 * Node tests in web/tests/ can load it directly.
 */

/** "Throwing Axe or Mallet" → "throwing-axe-or-mallet" (accents dropped). */
export function slug(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Category part of a key: "spells/summon" → "spells". */
export const categoryOf = (key) => String(key).split("/")[0];

export const TRAIT_CATEGORIES = [
  "basic-leader-traits", "covenant-leader-traits",
  "covenant-wretched-traits", "wretched-undead-traits",
];
export const WEAPON_CATEGORIES = [
  "melee-weapons", "ranged-weapons", "thrown-weapons", "colossal-weapons",
];

/**
 * @param {object} bundle  parsed data.json
 * @returns catalog: `rows` (key → {key, category, row}), `byApp`
 *          (app_id → key), `rules` (data/builder-rules.yaml), plus helpers.
 */
export function buildCatalog(bundle) {
  const rows = new Map();
  const byApp = new Map();
  for (const [category, cat] of Object.entries(bundle.categories || {})) {
    for (const row of cat.rows || []) {
      const key = `${category}/${slug(row.name)}`;
      rows.set(key, { key, category, row });
      if (row.app_id) byApp.set(row.app_id, key);
    }
  }
  const rules = bundle.builder || {};
  // Wretched Undead is a covenant choice with no card: give it a row so it
  // resolves like the others.
  for (const cov of rules.covenants || []) {
    if (!rows.has(cov.key)) {
      rows.set(cov.key, {
        key: cov.key, category: categoryOf(cov.key),
        row: { name: cov.name || cov.key, name_es: cov.name_es },
      });
    }
    if (cov.app_id) byApp.set(cov.app_id, cov.key);
  }

  return {
    bundle, rules, rows, byApp,
    /** The card row for a key, or null. */
    row: (key) => rows.get(key)?.row || null,
    /** Covenant rules (builder-rules.yaml) for a covenant key, or null. */
    covenant: (key) => (rules.covenants || []).find(c => c.key === key) || null,
    /** Leader or minion type rules for a profile key ({} when none). */
    profileRules: (key) =>
      (rules.leaders || {})[key] || (rules.minions || {})[key] || {},
  };
}

/**
 * Does `key` match a rule selector? Selectors are a key, "<category>/*" for
 * the whole category, or "hands:<n>" for weapons held in n hands.
 */
export function matches(catalog, key, selector) {
  if (selector.endsWith("/*")) return categoryOf(key) === selector.slice(0, -2);
  const m = /^hands:(\d)$/.exec(selector);
  if (m) {
    const row = catalog.row(key);
    return WEAPON_CATEGORIES.includes(categoryOf(key)) && Number(row?.hands) === Number(m[1]);
  }
  return key === selector;
}
