/**
 * Companion App share links ↔ builder gatherings.
 *
 * The app (necropolis28.vercel.app) stores a whole gathering in its
 * `?id=` parameter: "c<covenant>;<model>;<model>…", each model a
 * comma-separated list of the IDs its data rows carry — profile first, then
 * affinity (a0 Blood, a1 Bone, a2 Plasm), traits, weapons, armour and
 * spells. Read from its deployed JavaScript on 2026-10-28.
 *
 * Two quirks of the app this keeps compatible with:
 * - It never writes a model's free Improvised weapon, and adds it back when
 *   a model has no weapon. We do the same both ways.
 * - Its decoder reads thrown weapons (ewt) and misc equipment (ei) but its
 *   encoder never writes them, so they are lost when shared from the app.
 *   We write them; the app reads them fine. Thrown weapons go in the
 *   model's `equipment`: the rulebook lists them under Miscellaneous
 *   Equipment (p.41), and the app's JSON export files them there too.
 */

import { categoryOf, TRAIT_CATEGORIES } from "./catalog.js";
import { newGathering, newModel } from "./gathering.js";
import { AFFINITIES } from "./rules.js";

export const APP_URL = "https://necropolis28.vercel.app/gathering-creation";

const AFFINITY_CODE = { blood: "a0", bone: "a1", plasm: "a2" };
const CODE_AFFINITY = { a0: "blood", a1: "bone", a2: "plasm" };

/** Pull the gathering string out of a full link, or take it as given. */
export function linkPayload(input) {
  const s = String(input || "").trim();
  const q = s.indexOf("?");
  if (q >= 0) {
    const id = new URLSearchParams(s.slice(q + 1)).get("id");
    if (id != null) return id;
  }
  return s;
}

/** Does this text look like an app link or link payload (not JSON)? */
export function isLink(input) {
  const s = String(input || "").trim();
  return /[?&]id=/.test(s) || /^c\d(;|$)/.test(s);
}

/** The free weapon a model gets when it has none (colossal models: theirs). */
export function defaultWeapon(catalog, profileKey) {
  const only = catalog.profileRules(profileKey).weapons_only || [];
  return only.includes("colossal-weapons/*")
    ? "colossal-weapons/improvised-weapon"
    : "melee-weapons/improvised-weapon";
}

const isFree = (catalog, key) => /improvised-weapon$/.test(key) && !Number(catalog.row(key)?.obols);

/**
 * Decode a share link into a gathering.
 * @returns {{gathering, unknown: string[]}}  `unknown` = IDs with no row.
 */
export function decodeLink(input, catalog) {
  let s = linkPayload(input);
  const unknown = [];
  const g = newGathering();
  // Like the app: "c<digit>" then a separator; a missing covenant is c0.
  let cov = "c0";
  if (s.startsWith("c")) { cov = s.slice(0, 2); s = s.slice(3); }
  g.covenant = catalog.byApp.get(cov) || null;
  if (!g.covenant) unknown.push(cov);
  const covRules = catalog.covenant(g.covenant);

  for (const seg of s ? s.split(";") : []) {
    if (!seg) continue;
    const m = newModel(g);
    for (const code of seg.split(",")) {
      if (CODE_AFFINITY[code]) { m.affinity = CODE_AFFINITY[code]; continue; }
      const key = catalog.byApp.get(code);
      if (!key) { unknown.push(code); continue; }
      const cat = categoryOf(key);
      if (cat === "leaders" || cat === "minions") m.profile = key;
      else if (TRAIT_CATEGORIES.includes(cat)) m.traits.push(key);
      else if (cat === "spells") m.spells.push(key);
      else if (cat === "armours") m.armour.push(key);
      // Thrown weapons are Miscellaneous Equipment in the rulebook (p.41).
      else if (cat === "miscellaneous-equipment" || cat === "thrown-weapons") m.equipment.push(key);
      else m.weapons.push(key);
    }
    if (!m.profile) continue;
    // A fixed-affinity type keeps its own (a Ghast Husk is always Plasm);
    // otherwise a covenant locked to one affinity sets it.
    const fixed = catalog.profileRules(m.profile).affinity;
    const lock = (covRules?.keywords_any || []).map(k => k.toLowerCase()).filter(k => AFFINITIES.includes(k));
    if (!m.affinity && fixed?.length === 1) m.affinity = fixed[0];
    if (!m.affinity && lock.length === 1 && (fixed || AFFINITIES).includes(lock[0])) m.affinity = lock[0];
    if (!m.weapons.length) m.weapons.push(defaultWeapon(catalog, m.profile));
    g.models.push(m);
  }
  return { gathering: g, unknown };
}

/** Encode a gathering as the app's link payload (no URL). */
export function encodeLink(gathering, catalog) {
  const id = (key) => catalog.row(key)?.app_id || (key && catalog.covenant(key)?.app_id);
  let out = id(gathering.covenant) || "c0";
  for (const m of gathering.models || []) {
    const codes = [id(m.profile)];
    if (m.affinity && AFFINITY_CODE[m.affinity]) codes.push(AFFINITY_CODE[m.affinity]);
    codes.push(...(m.traits || []).map(id));
    // The app leaves out a lone free weapon and adds it back on load.
    const weapons = m.weapons || [];
    const lone = weapons.length === 1 && isFree(catalog, weapons[0]);
    if (!lone) codes.push(...weapons.map(id));
    // Thrown weapons right after the weapons, as the app orders its IDs.
    const thrown = (k) => categoryOf(k) === "thrown-weapons";
    const equipment = m.equipment || [];
    codes.push(...equipment.filter(thrown).map(id));
    codes.push(...(m.armour || []).map(id), ...equipment.filter(k => !thrown(k)).map(id));
    codes.push(...(m.spells || []).map(id));
    out += ";" + codes.filter(Boolean).join(",");
  }
  return out;
}

/** Full share link that opens the gathering in the Companion App. */
export function linkUrl(gathering, catalog) {
  return `${APP_URL}?id=${encodeLink(gathering, catalog)}`;
}
