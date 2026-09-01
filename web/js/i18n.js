/**
 * Card-language helpers.
 *
 * The card content lives in two places:
 *   1. Static template chrome — banner defaults, section headings and stat
 *      labels baked into templates/*.svg as literal <text>/<tspan> content.
 *   2. Row data — name/flavor/effect/… pulled from data.json.
 *
 * Spanish is opt-in via the language selector (English is the default). When
 * Spanish is active:
 *   - `translateLabels()` swaps the static chrome using the LABELS map.
 *   - the renderer prefers a row's `*_es` field over the English one
 *     (see `pickField`), falling back to English when a translation is
 *     missing so a partially-translated bundle still renders.
 *
 * Only the printed cards are localised; the surrounding app UI stays English.
 */

/** Static template label → Spanish. Keys are matched against the *trimmed*
 *  text content of <text>/<tspan> elements before {{KEY}} substitution, so
 *  data values (still `{{…}}` at that point) are never touched. Anything not
 *  in this map is left as-is (e.g. the "Necropolis" wordmark on the back). */
export const LABELS = {
  // Profile banner defaults (overridden by a model name when one is set).
  "Leader":    "Líder",
  "Minion":    "Secuaz",
  "Sellsword": "Mercenario",
  "Equipment": "Equipo",

  // Card back tagline.
  "A Diorama Skirmish Game": "Un juego de Escaramuzas en Diorama",

  // Stat-block labels (leader / minion / sellsword frames).
  "AP":       "PA",
  "Move":     "Mov",
  "Violence": "Violencia",
  "Ranged":   "A Dist.",

  // Meta-row labels.
  "COST": "COSTE",
  "MANA": "MANÁ",
  "AFF":  "AFIN",

  // Weapon stat labels.
  "RANGE":         "ALCANCE",
  "ATTACKS":       "ATAQUES",
  "DAMAGE  G / H": "DAÑO  R / A",

  // Minor Ambition tracker row (emitted by the TRACKER marker expansion in
  // templates.js, which looks this label up directly).
  "Times Achieved": "Veces Cumplida",

  // Section headings.
  "AP COST":       "COSTE PA",
  "CHANNEL":       "CANALIZACIÓN",
  "SPECIAL":       "ESPECIAL",
  "SPECIAL RULES": "REGLAS ESPECIALES",
  "EFFECT":        "EFECTO",
  "OBJECTIVES":    "OBJETIVOS",
  "DEPLOYMENT":    "DESPLIEGUE",
  "VICTORY":       "VICTORIA",
  "ARMAMENTS":     "ARMAMENTO",
};

/** Replace static template chrome with its Spanish equivalent.
 *
 * Runs on the raw template *before* {{KEY}} substitution, so the only literal
 * <text>/<tspan> contents present are template chrome — `{{…}}` placeholders
 * are excluded by the `[^<>{}]` character class and never match. Surrounding
 * whitespace (e.g. the trailing space in `<tspan>COST </tspan>`) is preserved
 * so the adjacent value tspan keeps its gap. No-op when `lang` isn't "es". */
export function translateLabels(svg, lang) {
  if (lang !== "es") return svg;
  return svg.replace(
    /(>)(\s*)([^<>{}]+?)(\s*)(<\/(?:text|tspan)>)/g,
    (full, gt, lead, content, trail, close) => {
      const es = LABELS[content];
      return es == null ? full : `${gt}${lead}${es}${trail}${close}`;
    }
  );
}

/** Pick a row field, preferring the `<key>_es` translation in Spanish.
 *  Falls back to the English value when the translation is absent or blank so
 *  a partially-translated data set still renders cleanly. `key` is already
 *  lower-cased by the caller (matches the template's {{KEY}} casing). */
export function pickField(row, key, lang) {
  if (lang === "es") {
    const es = row[`${key}_es`];
    if (es != null && String(es).trim() !== "") return es;
  }
  return row[key];
}

/* ---- roster (Warband tab) ------------------------------------------------
 *
 * The roster sheet is a printed artifact like the cards, so it follows the
 * card-language selector rather than staying English with the app chrome.
 * Keys are looked up with `t()`; anything missing falls back to English. */
export const ROSTER = {
  warband:       { en: "Warband",        es: "Banda" },
  covenant:      { en: "COVENANT",       es: "PACTO" },
  models:        { en: "MODELS",         es: "MINIATURAS" },
  manaPool:      { en: "MANA POOL",      es: "RESERVA DE MANÁ" },
  budget:        { en: "BUDGET",         es: "PRESUPUESTO" },
  remaining:     { en: "REMAINING",      es: "RESTANTE" },
  over:          { en: "OVER BUDGET",    es: "EXCEDIDO" },
  total:         { en: "WARBAND TOTAL",  es: "TOTAL DE LA BANDA" },
  cost:          { en: "COST",           es: "COSTE" },
  modelCost:     { en: "MODEL COST",     es: "COSTE DE LA MINIATURA" },
  obols:         { en: "obols",          es: "óbolos" },
  traits:        { en: "TRAITS",         es: "RASGOS" },
  spells:        { en: "SPELLS",         es: "HECHIZOS" },
  weapons:       { en: "WEAPONS",        es: "ARMAS" },
  armour:        { en: "ARMOUR",         es: "ARMADURA" },
  equipment:     { en: "EQUIPMENT",      es: "EQUIPO" },
  specialRules:  { en: "SPECIAL RULES",  es: "REGLAS ESPECIALES" },
  applied:       { en: "applied",        es: "aplicado" },
  spellSlots:    { en: "SPELLS",         es: "HECHIZOS" },
  free:          { en: "—",              es: "—" },
  bone:          { en: "Bone",           es: "Hueso" },
  blood:         { en: "Blood",          es: "Sangre" },
  plasm:         { en: "Plasm",          es: "Plasma" },
  rangeAbbr:     { en: "R",              es: "Alc" },
  attacksAbbr:   { en: "A",              es: "Atq" },
  damageAbbr:    { en: "D",              es: "Dñ" },
  apAbbr:        { en: "AP",             es: "PA" },
  channelAbbr:   { en: "CH",             es: "Can" },
  page:          { en: "Page",           es: "Página" },
  of:            { en: "of",             es: "de" },
};

/** Look up a roster label in the given language (English fallback). */
export function t(key, lang) {
  const e = ROSTER[key];
  if (!e) return key;
  return (lang === "es" && e.es) || e.en;
}
