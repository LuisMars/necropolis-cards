/**
 * Companion-App JSON importer.
 *
 * Parses a `{covenant, gathering[]}` payload, walks each model entry, and
 * tries to match every profile / trait / spell / weapon / armour / misc
 * piece against the printable card library.
 *
 * Each match is appended to the print queue with a `.override` object so
 * the card uses the JSON's effective stats and the player's `modelName`
 * instead of the generic data-file values.
 */

import { state, saveQueue } from "./state.js";
import { findCard, keyHintFromSource } from "./matching.js";
import { escapeHtml } from "./util.js";

const $jsonIn    = document.getElementById("json-in");
const $matchList = document.getElementById("match-list");
const $parseBtn  = document.getElementById("parse-btn");
const $clearBtn  = document.getElementById("clear-queue-btn");
const $sampleBtn = document.getElementById("sample-btn");

import { SAMPLE_JSON } from "./sample.js";

export function initImport({ onChange, switchToPrint }) {
  $parseBtn.addEventListener("click", () => {
    const matches = importJson($jsonIn.value);
    renderMatches(matches);
    onChange();
    if (matches.some(m => m.target.kind !== "unmatched")) {
      setTimeout(switchToPrint, 200);
    }
  });
  $clearBtn.addEventListener("click", () => {
    state.queue = [];
    saveQueue();
    onChange();
    renderMatches([]);
  });
  $sampleBtn.addEventListener("click", () => { $jsonIn.value = SAMPLE_JSON; });
}

function importJson(text) {
  let data;
  try { data = JSON.parse(text); }
  catch (e) { alert("Invalid JSON: " + e.message); return []; }

  const matches = [];

  // Covenant identity — best-effort match on the first comma-separated segment.
  if (data.covenant) {
    const covName = String(data.covenant).split(",")[0].trim();
    matches.push({ source: covName, sourceType: "covenant", target: findCard(covName, "covenant") });
  }

  for (const entry of (data.gathering || [])) {
    const profile = entry.profile || {};
    const kw = profile.keywords || [];
    const isLeader = kw.includes("Leader") || profile.mana != null;
    const preferKey = isLeader ? "leader" : (kw.length ? "minion" : "sellsword");
    const profileMatch = findCard(profile.name, preferKey);

    // Pre-resolve `profile.special[]` against the library. Matched entries
    // get their own card in the queue; unmatched ones drop into the
    // profile body's SPECIAL_RULES block so they still print *somewhere*.
    const unmatchedSpecials = [];
    const specialMatches = [];
    for (const sp of (profile.special || [])) {
      const m = findCard(sp.name, "special-rule");
      if (m.kind !== "unmatched") specialMatches.push({ source: sp.name, sourceType: "special", target: m });
      else unmatchedSpecials.push(sp);
    }

    if (profileMatch.kind !== "unmatched") {
      profileMatch.override = buildProfileOverride(entry, profile, unmatchedSpecials);
    }
    matches.push({
      source: entry.modelName ? `${entry.modelName} (${profile.name})` : profile.name,
      sourceType: "profile",
      target: profileMatch,
    });
    matches.push(...specialMatches);

    for (const t of (entry.traits || [])) {
      matches.push({
        source: t.name,
        sourceType: "trait",
        target: findCard(t.name, keyHintFromSource(t.source)),
      });
    }
    for (const s of (entry.spells || [])) {
      matches.push({ source: s.name, sourceType: "spell", target: findCard(s.name, "spell") });
    }
    for (const w of (entry.weapons || [])) {
      matches.push({ source: w.name, sourceType: "weapon", target: findCard(w.name) });
    }
    for (const a of (entry.armour || [])) {
      matches.push({ source: a.name, sourceType: "armour", target: findCard(a.name, "armour") });
    }
    for (const e of (entry.miscEquipment || entry.equipment || [])) {
      matches.push({ source: e.name, sourceType: "equipment", target: findCard(e.name) });
    }
  }

  // Push hits to the queue.
  for (const m of matches) {
    if (m.target.kind !== "unmatched") {
      state.queue.push({ key: m.target.key, row: m.target.row, override: m.target.override || null });
    }
  }
  saveQueue();
  return matches;
}

/**
 * Project the JSON's effective profile back onto our card's substitution
 * keys. Numbers like violence/ranged need a "+" suffix; 0 means "—".
 * `modelName` is the player's custom name and supersedes the type name.
 */
function buildProfileOverride(entry, p, unmatchedSpecials = null) {
  const o = {};
  // The player's custom model name (e.g. "Darth Vader") goes ON the banner;
  // the model TYPE (e.g. "Lich") stays as the gothic name below it.
  if (entry.modelName) o.header = entry.modelName;
  if (p.name)          o.name   = p.name;

  if (p.actionPoints != null) o.ap   = String(p.actionPoints);
  if (p.move        != null) o.m    = String(p.move);
  if (p.violence    != null) o.viol = p.violence === 0 ? "—" : p.violence + "+";
  if (p.ranged      != null) o.rngd = p.ranged   === 0 ? "—" : p.ranged   + "+";
  if (p.hp          != null) o.hp   = String(p.hp);
  if (p.obols       != null) o.cost = p.obols === 0 ? "—" : p.obols + " obols";

  // Keyword chip lines. `affinity` also feeds the third meta-row cell on
  // minion/sellsword cards (AFF · Bone/Blood/Plasm).
  if (p.affinity)              { o.keyword = p.affinity; o.affinity = p.affinity; }
  if ((p.keywords || []).length) o.type_keyword = p.keywords.join(" · ");

  // Leader resources — Companion App uses `startingAdditionalSpells` (new)
  // or `maxSpells` (old).
  if (p.mana != null) o.mana = String(p.mana);
  const additionalSpells = p.startingAdditionalSpells ?? p.maxSpells;
  if (additionalSpells != null) o.spells = `Summon + ${additionalSpells}`;

  // Special rules baked into the profile — concatenate name+effect into one
  // paragraph each so the BODY_BLOCK wrapper has lines to chew on. The
  // caller passes `unmatchedSpecials` (entries that don't have their own
  // card in the library); matched specials are queued as separate cards
  // so they don't compete for room in the profile body.
  const source = unmatchedSpecials != null ? unmatchedSpecials : (p.special || []);
  const specials = source.map(s => {
    if (s.name && s.effect) return `${s.name}. ${s.effect}`;
    return s.name || s.effect || "";
  }).filter(Boolean);
  if (specials.length) o.special_rules = specials.join("\n\n");

  return o;
}

function renderMatches(matches) {
  $matchList.innerHTML = "";
  if (!matches.length) return;

  const counts = { matched: 0, fuzzy: 0, unmatched: 0 };
  for (const m of matches) counts[m.target.kind]++;
  const summary = document.createElement("div");
  summary.className = "match-row";
  summary.innerHTML = `<span class="badge">SUMMARY</span>
    <span class="source">
      <strong style="color:var(--good)">${counts.matched}</strong> matched ·
      <strong style="color:var(--warn)">${counts.fuzzy}</strong> fuzzy ·
      <strong style="color:var(--bad)">${counts.unmatched}</strong> unmatched
    </span>`;
  $matchList.appendChild(summary);

  for (const m of matches) {
    const row = document.createElement("div");
    row.className = "match-row " + m.target.kind;
    let target = "no match in library";
    if (m.target.kind === "matched") target = `${m.target.row.name} (${m.target.key})`;
    else if (m.target.kind === "fuzzy") target = `${m.target.row.name} (${m.target.key}) — fuzzy`;
    row.innerHTML = `
      <span class="badge">${m.sourceType.toUpperCase()}</span>
      <span class="source">${escapeHtml(m.source || "(empty)")}</span>
      <span class="arrow">→</span>
      <span class="target">${escapeHtml(target)}</span>`;
    $matchList.appendChild(row);
  }
}
