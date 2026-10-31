/**
 * Global app state + queue persistence.
 *
 * `state` is a plain object mutated in place by other modules. Callers must
 * call `saveQueue()` after pushing/removing items so the change survives a
 * reload.
 *
 * The queue is an array of { key, row, override }:
 *   - key:      the category key from data.json (e.g. "spells", "leaders")
 *   - row:      the matched row object from data.json
 *   - override: optional flat dict of {{KEY}} substitutions that win over
 *               row values — used by the importer to inject the JSON's
 *               effective stats and the player's custom model name.
 */

const LS_KEY = "necropolis-card-printer-queue-v1";
const LS_PRINTED = "necropolis-card-printer-printed-v1";
const LS_LANG = "necropolis-card-printer-lang-v1";
const LS_WARBAND = "necropolis-card-printer-warband-v1";

export const state = {
  bundle: null,        // parsed data.json
  templates: {},       // { stem: svgText }
  index: null,         // name-keyed lookup (built after bundle loads)
  catalog: null,       // warband-builder catalog: rows by stable key and by
                       // Companion App ID (web/js/builder/catalog.js)
  queue: [],           // see header
  expanded: null,      // queue index whose edit panel is open, or null
  printed: {},         // inventory: { "<key>\0<name>": count } — how many
                       // copies of a card the user has already printed.
  lang: "en",          // card language for rendering ("en" | "es"); English
                       // is the default and only affects the printed cards.
  warband: null,       // raw Companion-App payload of the last import, kept
                       // verbatim ({covenant, totalObols, manaPool,
                       // gathering[]}). The Warband tab re-derives its roster
                       // from it on every render so a language switch or a
                       // data-bundle change is picked up without re-importing.
};

export function saveQueue() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state.queue)); } catch {}
}

export function loadQueue() {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v) state.queue = JSON.parse(v) || [];
  } catch { state.queue = []; }
}

/* ---- printed inventory ---------------------------------------------------
 * Tracked per card identity (category key + card name) so it's independent
 * of the transient queue and survives reloads. "Need" = queued − printed. */

export function cardId(key, name) {
  return `${key}\u0000${name || ""}`;
}

export function savePrinted() {
  try { localStorage.setItem(LS_PRINTED, JSON.stringify(state.printed)); } catch {}
}

export function loadPrinted() {
  try {
    const v = localStorage.getItem(LS_PRINTED);
    if (v) state.printed = JSON.parse(v) || {};
  } catch { state.printed = {}; }
}

export function printedCount(key, name) {
  return state.printed[cardId(key, name)] || 0;
}

export function setPrinted(key, name, n) {
  const id = cardId(key, name);
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (n === 0) delete state.printed[id];
  else state.printed[id] = n;
  savePrinted();
}

export function addPrinted(key, name, delta) {
  setPrinted(key, name, printedCount(key, name) + delta);
}

/* ---- card language ------------------------------------------------------- */

export function saveLang() {
  try { localStorage.setItem(LS_LANG, state.lang); } catch {}
}

export function loadLang() {
  try {
    const v = localStorage.getItem(LS_LANG);
    state.lang = v === "es" ? "es" : "en";
  } catch { state.lang = "en"; }
}

/* ---- imported warband ----------------------------------------------------
 * The raw payload is what we persist: the roster view is a pure function of
 * it plus the card bundle, so nothing goes stale. */

export function saveWarband() {
  try {
    if (state.warband) localStorage.setItem(LS_WARBAND, JSON.stringify(state.warband));
    else localStorage.removeItem(LS_WARBAND);
  } catch {}
}

export function loadWarband() {
  try {
    const v = localStorage.getItem(LS_WARBAND);
    state.warband = v ? JSON.parse(v) : null;
  } catch { state.warband = null; }
}
