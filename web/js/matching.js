/**
 * Card-name matching.
 *
 * The Companion App's JSON uses slightly different naming than our printable
 * library (e.g. "Throwing Axe/Mallet" vs "Throwing Axe or Mallet", "Bludgeon
 * 1h" vs "Bludgeon"). `normName` collapses both into a canonical form, and
 * `findCard` returns the best match with a kind: "matched" (exact),
 * "fuzzy" (substring), or "unmatched" (no hit).
 */

import { state } from "./state.js";

/** Canonicalise a name for matching. Same rules apply on both sides.
 *  Joiner words ("and", "or") and slashes collapse to nothing so
 *  "Claws/Fangs", "Claws and Fangs", "Claws or Fangs" all hash the same.
 *  1h ≡ Light, 2h ≡ Heavy for weapons that have both variants. */
const NAME_ALIASES = {
  "polearm":     "light polearm",
  "polearm 1h":  "light polearm",
  "polearm 2h":  "heavy polearm",
  // The Companion App spells a few names differently from the rulebook this
  // library is transcribed from (some are its typos, some just shorthand).
  // Mapping them here turns what would be a fuzzy hit into an exact one.
  "improvised":                "improvised weapon",
  "regenating soul":           "regenerating soul",   // app typo
  "spirit siphon":             "spirit syphon",
  "recusant mafeficar":        "recusant maleficar",  // app typo
  "chosen of the hand":        "chosen of the hands",
  "swarms of the hintertombs": "crawling dark",       // app names the covenant
                                                      // after its subtitle
};
export function normName(s) {
  // 1) Lowercase + strip punctuation + collapse whitespace + drop joiners.
  let n = String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(and|or)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // 2) Alias check BEFORE stripping 1h/2h (so "polearm 1h" → "light polearm").
  if (NAME_ALIASES[n]) return NAME_ALIASES[n];
  // 3) Strip the trailing 1h/2h handedness suffix ("Bludgeon 1h" → "Bludgeon").
  n = n.replace(/\s+(1h|2h)\s*$/, "").trim();
  // 4) Final alias pass on the bare name ("polearm" → "light polearm").
  return NAME_ALIASES[n] || n;
}

/**
 * Look up a card by name across every category in the bundle.
 *
 * @param {string} name           — name from the JSON
 * @param {string|null} preferKey — if multiple categories share a name, prefer
 *                                  the one whose key starts with this prefix
 *                                  (e.g. "leader", "minion", "spell").
 * @returns {{kind: "matched"|"fuzzy"|"unmatched", key?, row?, name?}}
 */
export function findCard(name, preferKey = null) {
  const n = normName(name);
  if (!n || !state.index) return { kind: "unmatched", name };
  let hits = state.index[n] || [];
  if (preferKey && hits.length > 1) {
    const filtered = hits.filter(h => h.key.startsWith(preferKey));
    if (filtered.length) hits = filtered;
  }
  if (hits.length) return { ...hits[0], kind: "matched" };

  // Fuzzy fallback 1: substring either direction.
  for (const [k, list] of Object.entries(state.index)) {
    if (k.includes(n) || n.includes(k)) return { ...list[0], kind: "fuzzy" };
  }

  // Fuzzy fallback 2: edit-distance. Tolerance scales with the source
  // length so short names need a near-exact match while longer names
  // accept a typo or two.
  const tol = Math.max(2, Math.floor(n.length / 5));
  let best = null, bestDist = tol + 1;
  for (const [k, list] of Object.entries(state.index)) {
    if (Math.abs(k.length - n.length) > tol) continue;  // cheap reject
    const d = editDistance(n, k);
    if (d < bestDist) { bestDist = d; best = list[0]; }
  }
  if (best) return { ...best, kind: "fuzzy" };

  return { kind: "unmatched", name };
}

/* Damerau-light Levenshtein. Returns the number of edits (insert / delete /
 * substitute) needed to turn `a` into `b`. Operates on UTF-16 code units,
 * which is fine for the ASCII-ish card names we're matching. */
function editDistance(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost      // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

/**
 * Pick a category-key hint based on a trait/spell/weapon source string from
 * the Companion App. Returns null if no useful hint can be derived.
 *
 * Examples:
 *   "Cairn-born Leader Trait"               → "covenant-leader-trait"
 *   "Basic Leader Trait"                    → "basic-leader-trait"
 *   "Cairn-born Covenant Special - Wretched Undead Trait" → "covenant-wretched-trait"
 */
export function keyHintFromSource(source) {
  if (!source) return null;
  const s = String(source).toLowerCase();
  if (s.includes("basic leader trait"))      return "basic-leader-trait";
  if (s.includes("covenant special") || s.includes("wretched undead")) return "covenant-wretched-trait";
  if (s.includes("leader trait"))            return "covenant-leader-trait";
  if (s.includes("special rule"))            return "special-rule";
  return null;
}
