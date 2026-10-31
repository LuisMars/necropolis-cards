/**
 * Companion-App JSON importer: the Import panel on the Gatherings page.
 *
 * Parses a `{covenant, gathering[]}` payload, walks each model entry, and
 * tries to match every profile / trait / spell / weapon / armour / misc
 * piece against the printable card library.
 *
 * Each match is appended to the print queue with a `.override` object so
 * the card uses the JSON's effective stats and the player's `modelName`
 * instead of the generic data-file values.
 */

import { state, saveQueue, saveWarband } from "./state.js";
import { findCard, keyHintFromSource } from "./matching.js";
import { escapeHtml } from "./util.js";

const $jsonIn    = document.getElementById("json-in");
const $matchList = document.getElementById("match-list");
const $parseBtn  = document.getElementById("parse-btn");
const $loadBtn   = document.getElementById("load-warband-btn");
const $sampleBtn = document.getElementById("sample-btn");
const $toggleBtn = document.getElementById("bd-import");
const $panel     = document.getElementById("bd-import-panel");
const $closeBtn  = document.getElementById("bd-import-close");
const $status    = document.getElementById("import-status");

import { SAMPLE_JSON } from "./sample.js";
import { isLink, decodeLink, encodeLink } from "./builder/codec.js";
import { fromAppJson, toAppJson } from "./builder/appjson.js";
import { FORMAT } from "./builder/gathering.js";
import { store, drafts } from "./gatherings.js";
import { label, plural, fill, categoryTitle } from "./builder/messages.js";
import { pickField } from "./i18n.js";

const L = (k, vars) => fill(label(k, state.lang || "en"), vars);

/** Open or close the panel; the toggle button says which it is. */
function showPanel(open) {
  $panel.hidden = !open;
  $toggleBtn.setAttribute("aria-expanded", String(open));
  if (open) { $toggleBtn.hidden = false; $jsonIn.focus(); }
}

/**
 * `onImported` opens the imported gathering in the Builder; `openQueue`
 * goes to the print queue; `onPanel` lets the Builder redraw its toolbar.
 */
export function initImport({ onChange, onImported, openQueue, onPanel }) {
  $toggleBtn.addEventListener("click", () => { showPanel($panel.hidden); onPanel?.(); });
  $closeBtn.addEventListener("click", () => {
    showPanel(false);
    onPanel?.();
    // With no gathering open the toggle hides: the empty state's Import
    // button takes the focus instead.
    ($toggleBtn.hidden ? document.querySelector('#bd-body [data-act="import"]') : $toggleBtn)?.focus();
  });
  // Load the gathering only: queueing 20-odd cards is a separate decision.
  $loadBtn.addEventListener("click", () => {
    const { matches, notes } = importJson($jsonIn.value, { queue: false });
    renderMatches(matches, notes);
    showQueued(0);
    if (matches.length) {
      onImported?.();
      // The open panel is taller than most screens: bring the gathering into view.
      requestAnimationFrame(() => document.getElementById("bd-body")?.scrollIntoView({ block: "start" }));
    }
  });
  $parseBtn.addEventListener("click", () => {
    const { matches, notes } = importJson($jsonIn.value);
    renderMatches(matches, notes);
    onChange();
    showQueued(matches.filter(m => m.target.kind !== "unmatched").length);
    if (matches.length) onImported?.();
  });
  $status.addEventListener("click", (e) => { if (e.target.closest("button")) openQueue?.(); });
  $sampleBtn.addEventListener("click", () => { $jsonIn.value = SAMPLE_JSON; });
}

/** After queueing: how many cards went in, and a way to the queue. */
function showQueued(n) {
  const lang = state.lang || "en";
  $status.hidden = !n;
  $status.innerHTML = n ? `${escapeHtml(plural("cardsAddedN", n, lang))} ` +
    `<button type="button" class="link">${escapeHtml(label("openQueue", lang))}</button>` : "";
}

/** Parse a payload — the Companion App's JSON export, one of its share
 *  links, or a Builder backup — and keep it as a builder gathering, then
 *  hand it to `applyPayload`. Returns the card matches plus `notes` on how
 *  the import went into the builder. */
function importJson(text, { queue = true } = {}) {
  let data;
  const notes = [];
  if (isLink(text)) {
    // A link only names IDs: build the gathering, then the same JSON the
    // app would export for it (plus names and totals) for the roster.
    const { gathering, unknown } = decodeLink(text, state.catalog);
    if (!gathering.models.length) { alert(L("linkNoModels")); return { matches: [], notes }; }
    for (const id of unknown) notes.push(L("unknownAppId", { id }));
    data = toAppJson(gathering, state.catalog);
    keepGathering(gathering, notes);
  } else {
    try { data = JSON.parse(text); }
    catch (e) { alert(L("badJson", { error: e.message })); return { matches: [], notes }; }
    // Valid JSON that isn't an object (null, a number, a list) is no gathering.
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      alert(L("notAGathering"));
      return { matches: [], notes };
    }
    if (data.format === FORMAT) {
      // A Builder backup: restore it as it was (same id), and show its roster.
      // Its unsaved draft would hide the restore, so the backup replaces it.
      store.save(data);
      notes.unshift(L("backupRestored", { name: data.name || L("untitled") }));
      if (drafts.get(data.id)) {
        drafts.remove(data.id);
        notes.push(L("backupReplacedDraft"));
      }
      data = toAppJson(data, state.catalog);
    } else {
      const { gathering, unmatched } = fromAppJson(data, state.catalog);
      for (const u of unmatched) notes.push(L("noBuilderMatch", { where: u.where, name: u.name }));
      if (gathering.models.length) keepGathering(gathering, notes);
    }
  }
  return { matches: applyPayload(data, { queue }), notes };
}

/** Show a Companion App payload as the warband and match its cards; with
 *  `queue`, the matched cards also land in the print queue. The Builder tab
 *  calls this with the JSON it exports for a gathering. */
export function applyPayload(data, { queue = true } = {}) {
  // Keep the payload verbatim: the Warband tab re-derives its roster from it
  // on every render, so it stays in sync with the language selector and any
  // rebuilt data bundle.
  state.warband = data;
  saveWarband();

  const matches = matchPayload(data);
  if (queue) {
    state.queue.push(...cardsOf(matches));
    saveQueue();
  }
  return matches;
}

/** The queue entries for a list of matches: every matched card, in order. */
const cardsOf = (matches) => matches.filter(m => m.target.kind !== "unmatched")
  .map(m => ({ key: m.target.key, row: m.target.row, override: m.target.override || null }));

/**
 * Every card a Companion App payload uses, as print-queue entries, without
 * touching the queue: the Roster view's Cards part prints these. The same
 * matching as "Add cards to queue", so the sheets come out the same.
 */
export const payloadCards = (data) => (data ? cardsOf(matchPayload(data)) : []);

/** Match a payload's covenant, models, traits, spells and gear to cards. */
function matchPayload(data) {
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
  return matches;
}

/** What makes two imports the same warband: its link (models, gear,
 *  traits, spells) plus the model names, which the link doesn't carry. */
const fingerprint = (g) => `${encodeLink(g, state.catalog)}|${g.models.map(m => m.name || "").join("|")}`;

function keepGathering(gathering, notes) {
  // Importing the same warband again opens the saved one instead of
  // adding a copy (which would also hide its campaign progress).
  const fp = fingerprint(gathering);
  const twin = store.list().find(g => fingerprint(g) === fp);
  if (twin) {
    store.save(twin);   // makes it the current gathering
    notes.unshift(L("alreadySaved", { name: twin.name || L("untitled") }));
    return;
  }
  store.save(gathering);
  const n = gathering.models.length;
  notes.unshift(plural("savedGathering", n, state.lang || "en"));
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

function renderMatches(matches, notes = []) {
  $matchList.innerHTML = "";
  for (const note of notes) {
    const row = document.createElement("div");
    row.className = "match-row";
    row.innerHTML = `<span class="badge">${escapeHtml(L("badgeBuilder"))}</span><span class="source">${escapeHtml(note)}</span>`;
    $matchList.appendChild(row);
  }
  if (!matches.length) return;

  const counts = { matched: 0, fuzzy: 0, unmatched: 0 };
  for (const m of matches) counts[m.target.kind]++;
  const summary = document.createElement("div");
  summary.className = "match-row";
  summary.innerHTML = `<span class="badge">${escapeHtml(L("badgeSummary"))}</span>
    <span class="source">${fill(escapeHtml(L("matchCounts")), {
      matched: `<strong style="color:var(--good)">${counts.matched}</strong>`,
      close:   `<strong style="color:var(--warn)">${counts.fuzzy}</strong>`,
      none:    `<strong style="color:var(--bad)">${counts.unmatched}</strong>`,
    })}</span>`;
  $matchList.appendChild(summary);

  // The rows themselves fold away: the gathering opens right below.
  const fold = document.createElement("details");
  fold.className = "match-fold";
  fold.innerHTML = `<summary>${escapeHtml(L("showMatches", { n: matches.length }))}</summary>`;
  $matchList.appendChild(fold);

  for (const m of matches) {
    const row = document.createElement("div");
    row.className = "match-row " + m.target.kind;
    const lang = state.lang || "en";
    const card = () => `${pickField(m.target.row, "name", lang) || m.target.row.name} (${categoryTitle("cat", m.target.key, m.target.key, lang)})`;
    let target = L("notInLibrary");
    if (m.target.kind === "matched") target = card();
    else if (m.target.kind === "fuzzy") target = `${card()}, ${L("closeMatch")}`;
    row.innerHTML = `
      <span class="badge">${escapeHtml(label(`src-${m.sourceType}`, state.lang || "en").replace(/^src-/, "").toUpperCase())}</span>
      <span class="source">${escapeHtml(m.source || L("empty_"))}</span>
      <span class="arrow">→</span>
      <span class="target">${escapeHtml(target)}</span>`;
    fold.appendChild(row);
  }
}
