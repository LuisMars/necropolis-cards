/**
 * Warband tab — roster view of the last imported Companion-App payload.
 *
 * The importer keeps the raw JSON in `state.warband`; everything shown here
 * is re-derived from it on every render, so a language switch or a rebuilt
 * data bundle is picked up without re-importing.
 *
 * Layout mirrors the Companion App's gathering view (one block per model,
 * with its profile stats and its traits / spells / weapons / armour /
 * equipment), but is drawn in the printed cards' aesthetic — parchment,
 * blackletter names, small-caps headings — at roughly three times a card's
 * area so it stays readable as a play reference. The same markup is used
 * on screen and in the print dialog, exactly like the Print tab's sheets.
 */

import { state, saveWarband } from "./state.js";
import { $, escapeHtml } from "./util.js";
import { findCard, keyHintFromSource, normName } from "./matching.js";
import { icon } from "./icons.js";
import { pickField, t, LABELS } from "./i18n.js";

const $summary   = $("wb-summary");
const $pagesWrap = $("wb-pages");
const $printBtn  = $("wb-print-btn");
const $clearBtn  = $("wb-clear-btn");

let onChangeCb = null;

export function initWarband({ onChange } = {}) {
  onChangeCb = onChange;
  $printBtn.addEventListener("click", () => {
    document.body.classList.add("printing-warband");
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  });
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("printing-warband");
  });
  $clearBtn.addEventListener("click", () => {
    if (!state.warband) return;
    if (!confirm("Remove the imported warband from this browser?")) return;
    state.warband = null;
    saveWarband();
    renderWarband();
    onChangeCb?.();
  });
}

/* ---- cost helpers -------------------------------------------------------- */

/** First integer in a cost value ("50 obols" → 50, "—" → 0, 35 → 35). */
export function parseObols(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const m = /-?\d+/.exec(String(v ?? ""));
  return m ? parseInt(m[0], 10) : 0;
}

/** Cost of one gear entry: the JSON's own price wins, else the library row's. */
function itemCost(entry, row) {
  const own = entry?.cost ?? entry?.obols ?? entry?.price;
  if (own != null) return parseObols(own);
  return row ? parseObols(row.cost) : 0;
}

/* ---- affinity-conditional special rules ---------------------------------
 *
 * Several profiles carry one special rule per affinity ("Bone Warrior",
 * "Blood Leader", …) and only the one matching the model's chosen keyword
 * applies. The Companion App stores that as `condition: {affinity}` next to
 * a `modifier`, applies the modifier to the profile, and shows only the
 * matching rule. Its JSON export, though, strips `condition`, `modifier` and
 * `restriction`, so the roster has to recover the condition from the text it
 * does export: the rule's name ("<Affinity> Warrior/Leader"), or its effect
 * ("If this model choses the <Affinity> keyword…" — the app's own wording,
 * misspellings and all).
 *
 * Rules whose condition doesn't match are dropped, exactly as the app hides
 * them; the matching one is flagged `applied`, because the exported stats
 * are already post-modifier. */
const AFFINITIES = ["Bone", "Blood", "Plasm"];
const COND_BY_NAME   = /^\s*(bone|blood|plasm)\s+(?:warrior|leader)\b/i;
const COND_BY_EFFECT = /\bif this (?:model|creature) cho\w*\s+the\s+(bone|blood|plasm)\s+keyword/i;

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** The affinity a special rule is conditional on, or null if it always applies. */
function conditionAffinity(sp) {
  const byName = COND_BY_NAME.exec(sp?.name || "");
  if (byName) return titleCase(byName[1]);
  const byEffect = COND_BY_EFFECT.exec(sp?.effect || "");
  if (byEffect) return titleCase(byEffect[1]);
  return null;
}

/** The model's chosen affinity, or null when it hasn't picked one — the app
 *  writes an unchosen affinity as the full "Blood/Bone/Plasm" list. */
function chosenAffinity(profile) {
  const a = String(profile?.affinity || "").trim().toLowerCase();
  return AFFINITIES.find(x => x.toLowerCase() === a) || null;
}

/* ---- Companion-App glossary ---------------------------------------------
 *
 * Not every rule the app exports has a card in this library: four it names
 * (Caster, Insubstantial, Unique, Brutal) live only inside their model's
 * profile text, and nine restrictions it exports with no name at all
 * ("Small Beast can only take claws & fangs as a weapon"). Their Spanish is
 * in `data/app-glossary.yaml`, which bundle.py ships beside the categories
 * without making cards of it.
 *
 * Lookup is by exact text — case, surrounding whitespace and a trailing full
 * stop are ignored, nothing else. A reworded string just falls back to the
 * app's own English. */
let glossaryCache = null;

const glossaryKey = (s) =>
  String(s || "").toLowerCase().replace(/\s+/g, " ").trim().replace(/\.$/, "");

function glossary() {
  const src = state.bundle?.glossary || {};
  if (!glossaryCache || glossaryCache.src !== src) {
    const byName = new Map(), byPhrase = new Map();
    for (const r of (src.rules   || [])) if (r?.en) byName.set(glossaryKey(r.en), r);
    for (const p of (src.phrases || [])) if (p?.en) byPhrase.set(glossaryKey(p.en), p);
    // Trait names are matched through normName so the app's own casing and
    // spelling ("Sorcerous talent") still hit the list.
    const appliedTraits = new Set((src.applied_traits || []).map(normName));
    glossaryCache = { src, byName, byPhrase, appliedTraits };
  }
  return glossaryCache;
}

/** Pick `<field>` or its `_es` twin from a glossary entry. */
const gloss = (entry, field, lang) =>
  (lang === "es" && entry[field === "en" ? "es" : `${field}_es`]) || entry[field] || "";

/* ---- roster model -------------------------------------------------------- */

/**
 * Turn the raw payload into the shape the view needs: covenant + members,
 * every entry resolved against the card library so we can show its stats
 * and price it. Returns null when nothing has been imported.
 */
export function buildRoster() {
  const data = state.warband;
  if (!data || !state.bundle) return null;
  const lang = state.lang || "en";

  const covName = data.covenant ? String(data.covenant).split(",")[0].trim() : "";
  // Exact matches only. A covenant with no card (the app offers one this
  // library doesn't carry) would otherwise fuzzy-match a different one and
  // print the wrong name across the top of the roster; the payload's own
  // wording is the safer fallback.
  const covHit = covName ? findCard(covName, "covenant") : { kind: "unmatched" };
  const covRow = covHit.kind === "matched" ? covHit.row : null;
  const covenant = {
    raw: data.covenant ? String(data.covenant) : "",
    name: covRow ? (pickField(covRow, "name", lang) || covName) : covName,
    subtitle: covRow ? (pickField(covRow, "restrictions", lang) || "") : "",
  };

  const members = (data.gathering || []).map(entry => buildMember(entry, lang));
  const total = members.reduce((s, m) => s + m.total, 0);
  const budget = data.totalObols != null ? parseObols(data.totalObols) : null;

  return {
    covenant,
    members,
    total,
    budget,
    manaPool: data.manaPool || null,
  };
}

function buildMember(entry, lang) {
  const profile = entry.profile || {};
  const kw = profile.keywords || [];
  const isLeader = kw.includes("Leader") || profile.mana != null;
  const preferKey = isLeader ? "leader" : (kw.length ? "minion" : "sellsword");
  const hit = findCard(profile.name, preferKey);
  const row = hit.kind !== "unmatched" ? hit.row : null;

  const gear = (list, hint) => (list || []).map(it => resolveItem(it, hint, lang));

  // Traits carry their own `source` string ("Cairn-born Leader Trait"), a
  // better category hint than a bare name lookup can give. A trait that
  // modifies the profile is already in the stats above, same as an affinity
  // rule, so it gets the same "applied" mark.
  const applied = glossary().appliedTraits;
  const traits = (entry.traits || []).map(tr => ({
    ...resolveItem(tr, keyHintFromSource(tr?.source), lang),
    applied: applied.has(normName(tr?.name)),
  }));
  const spells    = gear(entry.spells, "spell");
  const weapons   = gear(entry.weapons, null);
  const armour    = gear(entry.armour, "armour");
  const equipment = gear(entry.miscEquipment || entry.equipment, null);

  const gearCost = [...weapons, ...armour, ...equipment, ...spells, ...traits]
    .reduce((s, it) => s + it.cost, 0);
  const profileCost = parseObols(profile.obols ?? (row ? row.cost : 0));

  return {
    // The player's custom name headlines the block; the profile type sits
    // under it (same split the cards use for banner vs. gothic name).
    header: entry.modelName || (row ? pickField(row, "name", lang) : profile.name) || "",
    typeName: row ? (pickField(row, "name", lang) || profile.name) : (profile.name || ""),
    keywords: kw.map(k => translateKeyword(k, row, lang)),
    affinity: translateAffinity(profile.affinity, lang),
    stats: {
      ap:   profile.actionPoints,
      m:    profile.move,
      viol: profile.violence,
      rngd: profile.ranged,
      hp:   profile.hp,
    },
    mana: profile.mana,
    spellSlots: profile.startingAdditionalSpells ?? profile.maxSpells,
    special: profileSpecials(profile, lang),
    traits, spells, weapons, armour, equipment,
    profileCost,
    total: profileCost + gearCost,
  };
}

/* The Companion App writes keywords and affinities in English. On a Spanish
 * roster we translate what we can: the profile banner words come from the
 * shared LABELS map, the model's own type keywords from its card row (whose
 * `type_keyword` / `type_keyword_es` pair lines up segment by segment), and
 * the three affinities from the roster labels. Anything unknown is left as
 * imported rather than guessed at. */
function translateKeyword(kw, row, lang) {
  if (lang !== "es" || !kw) return kw;
  if (LABELS[kw]) return LABELS[kw];
  const en = row?.type_keyword, es = row?.type_keyword_es;
  if (en && es) {
    const parts   = String(en).split("·").map(x => x.trim());
    const partsEs = String(es).split("·").map(x => x.trim());
    const i = parts.indexOf(kw);
    if (i >= 0 && partsEs[i]) return partsEs[i];
  }
  return kw;
}

function translateAffinity(aff, lang) {
  if (!aff) return "";
  const k = String(aff).toLowerCase();
  return ["bone", "blood", "plasm"].includes(k) ? t(k, lang) : aff;
}

/** Resolve one gear/trait/spell entry against the library and price it. */
function resolveItem(entry, hint, lang) {
  const name = entry?.name ?? String(entry ?? "");
  const hit = findCard(name, hint);
  const row = hit.kind !== "unmatched" ? hit.row : null;
  return {
    text: "", stats: "",
    name: row ? (pickField(row, "name", lang) || name) : name,
    ...itemMeta(hit.key, row, entry, lang),
    body: itemBody(hit.key, row, lang),
    cost: itemCost(entry, row),
    matched: !!row,
  };
}

/**
 * The special rules to print for a profile: conditional ones only when the
 * model's affinity selects them (flagged as already applied to the stats),
 * plus the unconditional ones. Mirrors the app's own display filter, which
 * also drops an unconditional rule that carries no effect text.
 */
function profileSpecials(profile, lang) {
  const affinity = chosenAffinity(profile);
  const out = [];
  for (const sp of (profile.special || [])) {
    const cond = conditionAffinity(sp);
    if (cond && affinity && cond !== affinity) continue;
    const resolved = resolveSpecial(sp, lang);
    if (!cond && !resolved.effect) continue;
    out.push({ ...resolved, applied: !!(cond && affinity) });
  }
  return out;
}

/**
 * A profile's baked-in special rule, in the selected language. Sources, in
 * order: the rule's own card, the glossary by name, the glossary by effect
 * text (for the rules the app leaves unnamed), and finally the payload as
 * imported.
 */
function resolveSpecial(sp, lang) {
  const hit = findCard(sp?.name, "special-rule");
  if (hit.kind !== "unmatched") {
    return {
      name: pickField(hit.row, "name", lang) || sp.name || "",
      effect: pickField(hit.row, "effect", lang) || sp?.effect || "",
    };
  }

  const g = glossary();
  const named = sp?.name ? g.byName.get(glossaryKey(sp.name)) : null;
  if (named) {
    return {
      name: gloss(named, "en", lang),
      effect: gloss(named, "effect", lang) || sp?.effect || "",
    };
  }

  const phrase = sp?.effect ? g.byPhrase.get(glossaryKey(sp.effect)) : null;
  if (phrase) {
    return { name: sp?.name || "", effect: gloss(phrase, "en", lang) };
  }

  return { name: sp?.name || "", effect: sp?.effect || "" };
}

/** The rules text for an entry — what the Companion App prints under the
 *  name. Weapons carry theirs in `special`, everything else in `effect`. */
function itemBody(key, row, lang) {
  if (!row) return "";
  const tpl = state.bundle.categories[key]?.template;
  const v = pickField(row, tpl === "weapon" ? "special" : "effect", lang);
  const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim();
  return (s === "—" || s === "-") ? "" : s;
}

/**
 * Split an entry's card data into the two halves a roster line wants: `text`,
 * the grey descriptive part (weapon class, spell school, trait source), and
 * `stats`, the numbers a player reads mid-game, each behind its glyph.
 */
function itemMeta(key, row, entry, lang) {
  if (!row) return { text: "", stats: "" };
  const tpl = state.bundle.categories[key]?.template;
  const f = (k) => {
    const v = pickField(row, k, lang);
    const s = v == null ? "" : String(v).trim();
    return (s === "—" || s === "-" || s === "") ? "" : s;
  };
  // Numbers get a glyph instead of an abbreviation — attacks, damage and
  // range read like the Companion App's weapon line (◈3 · 1/3 · 1"), and a
  // spell's AP like its own. Everything else stays a word.
  const stat = (glyph, value) => `<span class="s">${icon(glyph)}${escapeHtml(value)}</span>`;
  const plain = (value) => `<span class="s">${escapeHtml(value)}</span>`;
  const bits = [], nums = [];
  if (tpl === "weapon") {
    if (f("category")) bits.push(escapeHtml(f("category")));
    if (f("attacks"))  nums.push(stat("diamond", f("attacks")));
    if (f("damage"))   nums.push(plain(f("damage").replace(/\s+/g, "")));
    if (f("range"))    nums.push(plain(`${f("range")}"`));
    // Two-handed weapons occupy both hands — worth seeing on the roster.
    if (entry?.handed === 2) nums.push(plain("2H"));
  } else if (tpl === "equipment") {
    const armour = String(pickField(row, "armour", lang) ?? "").trim();
    if (armour && armour !== "—") nums.push(stat("shield", armour));
    if (f("category")) bits.push(escapeHtml(f("category")));
  } else if (tpl === "spell") {
    if (f("school"))  bits.push(escapeHtml(f("school")));
    if (f("ap"))      nums.push(stat("bolt", f("ap")));
    if (f("channel")) nums.push(plain(f("channel")));
  } else {
    // Traits / covenant specials / anything else on the `rule` template. The
    // JSON's own `source` is the most specific label ("Cairn-born Leader
    // Trait") but is English-only, so Spanish falls back to the row's
    // category — de-shouted, since the data stores it in caps for the card.
    if (entry?.source && lang !== "es") bits.push(escapeHtml(String(entry.source)));
    else if (f("category")) bits.push(escapeHtml(sentenceCase(f("category"))));
  }
  return { text: bits.join(" · "), stats: nums.join('<span class="sep">·</span>') };
}

/** "RASGO BÁSICO DE LÍDER" → "Rasgo básico de líder". Left alone unless the
 *  text is entirely upper-case, so mixed-case categories keep their casing. */
function sentenceCase(s) {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/* ---- rendering ----------------------------------------------------------- */

export function renderWarband() {
  const roster = buildRoster();
  renderSummary(roster);
  renderPages(roster);
}

function obols(n, lang) {
  return `${n} ${t("obols", lang)}`;
}

function renderSummary(roster) {
  const lang = state.lang || "en";
  $printBtn.disabled = !roster || !roster.members.length;
  $clearBtn.disabled = !roster;
  if (!roster) {
    $summary.innerHTML =
      `<span class="wb-empty">No warband imported yet — paste a Companion App export in the ` +
      `<strong>Import</strong> tab and it will show up here.</span>`;
    return;
  }
  const chips = [
    `<span class="wb-chip"><b>${roster.members.length}</b> ${escapeHtml(t("models", lang).toLowerCase())}</span>`,
    `<span class="wb-chip accent"><b>${roster.total}</b> ${escapeHtml(t("obols", lang))}</span>`,
  ];
  if (roster.budget != null) {
    const left = roster.budget - roster.total;
    chips.push(
      `<span class="wb-chip">${escapeHtml(t("budget", lang).toLowerCase())} <b>${roster.budget}</b></span>`,
      `<span class="wb-chip ${left < 0 ? "over" : "good"}">` +
        `${escapeHtml((left < 0 ? t("over", lang) : t("remaining", lang)).toLowerCase())} <b>${Math.abs(left)}</b></span>`
    );
  }
  const mp = roster.manaPool;
  if (mp) {
    const pool = ["bone", "blood", "plasm"]
      .filter(k => mp[k])
      .map(k => `${escapeHtml(t(k, lang))} ${mp[k]}`)
      .join(" · ");
    if (pool) chips.push(`<span class="wb-chip">${pool}</span>`);
  }
  $summary.innerHTML =
    `<span class="wb-cov">${escapeHtml(roster.covenant.name || roster.covenant.raw || "—")}</span>` +
    chips.join("");
}

/* Decoration reused from the card templates. Both are plain <img> tags
 * rather than CSS backgrounds: browsers drop background images from printed
 * output unless the user ticks "background graphics", but inline images
 * always print. */
const TEXTURE_IMG = "images/alpha/img-014-024-alpha.png";
const BANNER_IMG  = "images/alpha/img-029-048-alpha.png";

const decor = () => `<img class="wb-tex" src="${TEXTURE_IMG}" alt="" aria-hidden="true">`;
const banner = (title) => `<div class="wb-banner">` +
  `<img src="${BANNER_IMG}" alt="" aria-hidden="true">` +
  `<span>${escapeHtml(title)}</span></div>`;

function newPage() {
  const page = document.createElement("div");
  page.className = "wb-page";
  page.innerHTML = `<div class="wb-page-body"></div><div class="wb-page-num"></div>`;
  return page;
}

/**
 * Lay the roster blocks out over A4 pages.
 *
 * Blocks are variable height (a leader with six spells is much taller than a
 * husk with one weapon), so we pack greedily: append to the current page and
 * move the block to a fresh one the moment it overflows. `.wb-page-body` has
 * a fixed height with `overflow:hidden`, so `scrollHeight > clientHeight` is
 * an exact overflow test. The tab is laid out even while inactive (it's
 * positioned off-screen, not `display:none`), so measuring works from any tab.
 */
function renderPages(roster) {
  $pagesWrap.innerHTML = "";
  if (!roster || !roster.members.length) {
    const e = document.createElement("div");
    e.className = "empty-msg";
    e.textContent = "The roster sheet will appear here once you import a warband.";
    $pagesWrap.appendChild(e);
    return;
  }

  const lang = state.lang || "en";
  const blocks = [buildHeaderBlock(roster, lang),
                  ...roster.members.map(m => buildMemberBlock(m, lang))];

  let page = newPage();
  $pagesWrap.appendChild(page);
  let body = page.querySelector(".wb-page-body");
  for (const block of blocks) {
    body.appendChild(block);
    if (body.scrollHeight > body.clientHeight && body.children.length > 1) {
      body.removeChild(block);
      page = newPage();
      $pagesWrap.appendChild(page);
      body = page.querySelector(".wb-page-body");
      body.appendChild(block);
    }
  }

  const pages = $pagesWrap.querySelectorAll(".wb-page");
  pages.forEach((p, i) => {
    p.querySelector(".wb-page-num").textContent =
      `${t("page", lang)} ${i + 1} ${t("of", lang)} ${pages.length}`;
  });
}

function buildHeaderBlock(roster, lang) {
  const el = document.createElement("section");
  el.className = "wb-block wb-head";
  const mp = roster.manaPool;
  const pool = mp
    ? ["bone", "blood", "plasm"].filter(k => mp[k])
        .map(k => `${escapeHtml(t(k, lang))} <b>${mp[k]}</b>`).join(" · ")
    : "";
  const meta = [];
  if (pool) meta.push(`<span><i>${t("manaPool", lang)}</i> ${pool}</span>`);
  meta.push(`<span><i>${t("models", lang)}</i> <b>${roster.members.length}</b></span>`);
  if (roster.budget != null) {
    const left = roster.budget - roster.total;
    meta.push(`<span><i>${t("budget", lang)}</i> <b>${obols(roster.budget, lang)}</b></span>`);
    meta.push(`<span><i>${left < 0 ? t("over", lang) : t("remaining", lang)}</i> <b>${obols(Math.abs(left), lang)}</b></span>`);
  }

  el.innerHTML = `
    ${decor()}
    ${banner(t("warband", lang))}
    <div class="wb-head-body">
      <h2 class="wb-title">${escapeHtml(roster.covenant.name || "—")}</h2>
      ${roster.covenant.subtitle
        ? `<p class="wb-subtitle">${escapeHtml(roster.covenant.subtitle)}</p>`
        : (roster.covenant.raw
            ? `<p class="wb-subtitle">${escapeHtml(roster.covenant.raw)}</p>` : "")}
      <div class="wb-head-meta">${meta.join("")}</div>
      <div class="wb-total">
        <span class="lbl">${escapeHtml(t("total", lang))}</span>
        <span class="val">${escapeHtml(String(roster.total))}${icon("obol", "big")}</span>
      </div>
    </div>`;
  return el;
}

function statCell(label, value, glyph = "") {
  const v = value == null || value === "" ? "—" : value;
  return `<span class="wb-stat"><b>${escapeHtml(String(v))}</b>` +
         `<i>${glyph ? icon(glyph) : ""}${escapeHtml(label)}</i></span>`;
}

/** Violence / Ranged print as a target number; 0 means the model can't. */
function target(n) {
  if (n == null) return null;
  return n === 0 ? "—" : `${n}+`;
}

function buildMemberBlock(m, lang) {
  const el = document.createElement("section");
  el.className = "wb-block wb-member";

  // The profile's own price leads the strip, the way a card's meta row does:
  // the gear below is priced line by line, and the footer adds it all up.
  const stats = [
    statCell(t("cost", lang), m.profileCost, "obol"),
    statCell(t("apAbbr", lang), m.stats.ap, "bolt"),
    statCell(lang === "es" ? "Mov" : "Move", m.stats.m),
    statCell(lang === "es" ? "Violencia" : "Violence", target(m.stats.viol)),
    statCell(lang === "es" ? "A Dist." : "Ranged", target(m.stats.rngd)),
    statCell("HP", m.stats.hp, "heart"),
  ];
  if (m.mana != null) stats.push(statCell(lang === "es" ? "Maná" : "Mana", m.mana, "drop"));
  if (m.spellSlots != null) {
    stats.push(statCell(t("spellSlots", lang), `+${m.spellSlots}`, "star"));
  }

  // The banner carries the player's model name and the gothic line below it
  // the profile type — so the type line only adds what neither shows yet.
  // When a model has no custom name the two collapse into one.
  const showName = m.typeName && m.typeName !== m.header;
  const typeLine = [m.keywords.join(" · "), m.affinity].filter(Boolean).join(" · ");

  // Rules-text sections run the full width in two flowing columns; the gear
  // lists are short enough to sit side by side in the three-column grid.
  const sections = [
    // A few special rules are pure restrictions with no name of their own —
    // their effect line becomes the heading rather than leaving a blank one.
    section(t("specialRules", lang), m.special.map(s => ({
      name: s.name || s.effect,
      body: s.name ? s.effect : "",
      badge: s.applied ? t("applied", lang) : "",
    })), lang),
    section(t("traits", lang), m.traits.map(it => ({
      ...it, badge: it.applied ? t("applied", lang) : "",
    })), lang),
    section(t("spells", lang),    m.spells,    lang),
    gearSection(t("weapons", lang),   m.weapons,   lang),
    gearSection(t("armour", lang),    m.armour,    lang),
    gearSection(t("equipment", lang), m.equipment, lang),
  ].filter(Boolean).join("");

  el.innerHTML = `
    ${decor()}
    ${banner(m.header || m.typeName)}
    <div class="wb-member-body">
      <div class="wb-idline">
        ${showName ? `<h3 class="wb-name">${escapeHtml(m.typeName)}</h3>` : ""}
        ${typeLine ? `<p class="wb-type">${escapeHtml(typeLine)}</p>` : ""}
      </div>
      <div class="wb-stats">${stats.join("")}</div>
      <div class="wb-cols">${sections}</div>
      <div class="wb-cost">
        <span class="lbl">${escapeHtml(t("modelCost", lang))}</span>
        <span class="dots"></span>
        <span class="val">${escapeHtml(String(m.total))}${icon("obol", "big")}</span>
      </div>
    </div>`;
  return el;
}

/* `text` and `stats` come out of itemMeta already escaped — they carry glyph
 * markup — so they are the only fields interpolated raw. */
const badgeHtml = (it) =>
  it.badge ? `<span class="b">✓ ${escapeHtml(it.badge)}</span>` : "";
const metaHtml = (it) => {
  const parts = [it.text, it.stats].filter(Boolean);
  return parts.length ? `<span class="m">${parts.join('<span class="sep">·</span>')}</span>` : "";
};
const shell = (title, cls, rows) =>
  `<section class="wb-sec ${cls}">
      <h4>${escapeHtml(title)}</h4>
      <ul>${rows}</ul>
    </section>`;

/**
 * A rules list — special rules, traits, spells. Name, then the descriptive
 * line, then the rule itself, flowing in two columns across the block.
 */
function section(title, items, lang) {
  if (!items || !items.length) return "";
  const rows = items.map(it => {
    const body = it.body ? `<span class="e">${escapeHtml(it.body)}</span>` : "";
    return `<li><span class="n">${escapeHtml(it.name)}${badgeHtml(it)}</span>` +
           `${metaHtml(it)}${body}</li>`;
  }).join("");
  return shell(title, "text", rows);
}

/**
 * A gear list — weapons, armour, equipment. One line per item: what it is on
 * the left, the numbers you roll with it and its price on the right, in
 * columns that line up down the block. Any rules text hangs underneath.
 */
function gearSection(title, items, lang) {
  if (!items || !items.length) return "";
  const rows = items.map(it => {
    const cost = it.cost ? `${it.cost}${icon("obol")}` : "";
    const body = it.body ? `<span class="e">${escapeHtml(it.body)}</span>` : "";
    return `<li><span class="n">${escapeHtml(it.name)}</span>` +
           `<span class="m">${it.text || ""}</span>` +
           `<span class="g">${it.stats || ""}</span>` +
           `<span class="c">${cost}</span>${body}</li>`;
  }).join("");
  return shell(title, "gear", rows);
}
