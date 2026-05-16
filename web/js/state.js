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

export const state = {
  bundle: null,        // parsed data.json
  templates: {},       // { stem: svgText }
  index: null,         // name-keyed lookup (built after bundle loads)
  queue: [],           // see header
  expanded: null,      // queue index whose edit panel is open, or null
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
