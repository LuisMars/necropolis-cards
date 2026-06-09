/**
 * SVG template rendering for the print view.
 *
 * The print sheet inlines each card as raw SVG so it's pixel-perfect and
 * easy to style with print CSS. `renderCardSvg(queueItem, withBleed)`
 * returns the SVG string for one queued card.
 *
 * Substitution semantics mirror build.py: {{KEY}} markers are replaced
 * from the (row + override) data, and BODY_BLOCK comments are expanded
 * into wrapped <text> lines.
 */

import { state } from "./state.js";
import { translateLabels, pickField } from "./i18n.js";

const BODY_BLOCK_RE =
  /<!--\s*BODY_BLOCK:\s*(\w+)\s*@\s*x=([\d.]+)\s+y=([\d.]+)\s+lineheight=([\d.]+)\s+width=(\d+)chars\s+maxlines=(\d+)(?:\s+style=(\w+))?(?:\s+anchor=(\w+))?(?:\s+short_fill=(\w+))?\s*-->/g;

/** Build the inline SVG for a queue item.
 *
 * Templates are natively sized at the standard TCG sleeve size (the
 * CARD_W × CARD_H constants below); we just retarget the root SVG to
 * fill whatever cell the CSS gives us.
 *
 * If the queue item has an `override.header` (set by the importer when a
 * model has a custom `modelName`), the banner title's literal text is
 * swapped after substitution so the printed banner says e.g. "Darth Vader"
 * instead of "Leader".
 */
export const CARD_W = 63;
export const CARD_H = 88;

export function renderCardSvg(q) {
  const cat = state.bundle.categories[q.key];
  if (!cat) return "<div>Missing category</div>";
  let tpl = state.templates[cat.template];
  if (!tpl) return "<div>Missing template</div>";

  const lang = state.lang || "en";
  const row = { ...q.row, ...(q.override || {}) };
  // Localise static template chrome (banner defaults, headings, stat labels)
  // before substitution so {{KEY}} placeholders are never matched.
  tpl = translateLabels(tpl, lang);
  tpl = substituteTemplate(tpl, row, lang);

  // Decorate the card with a few random ink splotches, seeded by name so
  // a given card always looks the same. Ports build.py's _render_splotches.
  const splotchSeed = (q.override?.header) || row.name || cat.template;
  tpl = tpl.replace(/<!--\s*SPLOTCHES\s*-->/g, renderSplotches(String(splotchSeed)));

  // Drop any fixed width/height on the root so the SVG fills its .card cell
  // via CSS. The viewBox is already CARD_W × CARD_H, so no aspect-ratio
  // games are needed.
  tpl = tpl.replace(
    /<svg\b([^>]*)>/,
    (m, attrs) => {
      attrs = attrs
        .replace(/\swidth="[^"]*"/g, "")
        .replace(/\sheight="[^"]*"/g, "");
      return `<svg${attrs} width="100%" height="100%">`;
    }
  );

  // If the row has a custom banner header (e.g. modelName from import),
  // swap the static banner-title text for it. This runs AFTER {{HEADER}}
  // substitution so weapon cards keep their category-driven header.
  const headerOverride = (q.override || {}).header;
  if (headerOverride) {
    tpl = tpl.replace(
      /(<text\s+class="banner-title"[^>]*>)[^<]+(<\/text>)/,
      `$1${escapeXml(headerOverride)}$2`
    );
  }

  // Long card names overflow the banner — port build.py's _fit_long_names.
  tpl = fitLongNames(tpl);

  // Strip editor metadata that the bundler may have left in.
  tpl = tpl.replace(/\s+data-edit-idx="[^"]*"/g, "");
  return tpl;
}

/* Title-name fitting strategy — mirrors build.py:
 *   Banner titles (y < BANNER_Y_THRESHOLD): shrink the FONT so the
 *     blackletter keeps its natural proportions and stays inside the trim.
 *     (Squeezing glyphs to a fixed width condensed the letters and looked
 *     bad; longer names ran off the card edge.)
 *   Body names (below the banner):
 *     ≤ 15 chars: full size, no constraint
 *     16 – 22:   single-line with textLength to gently squeeze
 *     ≥ 23:     wrap to 2 lines at a smaller font */
const NAME_SHRINK_CHARS   = 16;
const NAME_MAX_CHARS      = 23;
const NAME_FIT_WIDTH_MM   = 53;   // body names: ~84% of the 63 mm card width
const BANNER_Y_THRESHOLD  = 17;   // y below this counts as "on the banner"
const BANNER_BASE_SIZE    = 7.0;  // fallback banner font when none is set inline
const BANNER_FIT_CHARS    = 16.5; // chars that fit at the base size before shrinking
const BANNER_MIN_SIZE     = 4.4;  // never shrink a title below this

// Match either the body name (`.name`) or the banner title (`.banner-title`).
// Both can hold a card name that needs fitting; the y-coordinate decides
// which strategy to use.
const NAME_TAG_RE =
  /<text\s+class="(name|banner-title)"([^>]*)>([^<]+)<\/text>/g;

// Force an inline font-size onto a <text>'s attribute string so it wins
// over the class-level font-size in the SVG <style> block.
function withFontSize(attrs, size) {
  const styleMatch = /style="([^"]*)"/.exec(attrs);
  if (styleMatch) {
    const cleaned = styleMatch[1].replace(/font-size:\s*[^;]+;?\s*/, "");
    return attrs.replace(/style="[^"]*"/, `style="${cleaned}font-size: ${size.toFixed(2)}px;"`);
  }
  return attrs + ` style="font-size: ${size.toFixed(2)}px;"`;
}

function fitLongNames(svg) {
  return svg.replace(NAME_TAG_RE, (full, cls, attrs, content) => {
    const n = content.length;
    if (n <= NAME_SHRINK_CHARS) return full;

    const yMatch = /y="([\d.]+)"/.exec(attrs);
    const xMatch = /x="([\d.]+)"/.exec(attrs);
    if (!xMatch || !yMatch) return full;
    const x = parseFloat(xMatch[1]);
    const y = parseFloat(yMatch[1]);

    if (y < BANNER_Y_THRESHOLD) {
      // Banner title: shrink the font, keep natural proportions.
      const baseMatch = /font-size:\s*([\d.]+)px/.exec(attrs);
      const base = baseMatch ? parseFloat(baseMatch[1]) : BANNER_BASE_SIZE;
      const size = Math.max(BANNER_MIN_SIZE, base * BANNER_FIT_CHARS / n);
      return `<text class="${cls}"${withFontSize(attrs, size)}>${content}</text>`;
    }

    if (n < NAME_MAX_CHARS) {
      // Medium body name: textLength constraint, single line.
      return `<text class="${cls}"${attrs} textLength="${NAME_FIT_WIDTH_MM}" lengthAdjust="spacingAndGlyphs">${content}</text>`;
    }
    // Long body name: wrap at the most-balanced word boundary, shrink, 2 lines.
    const lines = splitTwoLines(content);
    if (lines.length < 2) {
      return `<text class="${cls}"${attrs} textLength="${NAME_FIT_WIDTH_MM}" lengthAdjust="spacingAndGlyphs">${content}</text>`;
    }
    const lineH = 5.4;
    const y1 = y - lineH * 0.5;
    const y2 = y + lineH * 0.5;
    // Two-line wrap shrinks the font; bake it into the inline style so it
    // wins over the class-level font-size in the SVG <style> block.
    const styleMatch = /style="([^"]*)"/.exec(attrs);
    const styleNew = styleMatch
      ? attrs.replace(/style="[^"]*"/, `style="${styleMatch[1].replace(/font-size:\s*[^;]+;?\s*/, "")}font-size: 4.6px;"`)
      : attrs + ' style="font-size: 4.6px;"';
    const newAttrs = styleNew.replace(/y="[\d.]+"/, `y="${y1}"`);
    return (
      `<text class="${cls}"${newAttrs}>` +
        `<tspan x="${x}" y="${y1}">${escapeXml(lines[0])}</tspan>` +
        `<tspan x="${x}" y="${y2}">${escapeXml(lines[1])}</tspan>` +
      `</text>`
    );
  });
}

function splitTwoLines(text) {
  const words = text.split(/\s+/);
  if (words.length === 1) return [text];
  let best = null, bestDiff = 1e9;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" ");
    const right = words.slice(i).join(" ");
    if (Math.max(left.length, right.length) > NAME_MAX_CHARS) continue;
    const diff = Math.abs(left.length - right.length);
    if (diff < bestDiff) { bestDiff = diff; best = [left, right]; }
  }
  return best || [text];
}

function substituteTemplate(tpl, row, lang = "en") {
  // First: expand BODY_BLOCK markers into wrapped <text> lines.
  tpl = tpl.replace(BODY_BLOCK_RE, (_, key, x, y, lh, width, maxlines, style, anchor /*, shortFill*/) => {
    const value = String(pickField(row, key.toLowerCase(), lang) ?? "");
    if (!value) return "";
    const lines = wrap(value, parseInt(width, 10)).slice(0, parseInt(maxlines, 10));
    const cls = style || "body";
    const anchorAttr = anchor ? ` text-anchor="${anchor}"` : "";
    return lines.map((line, i) =>
      `<text class="${cls}" x="${x}" y="${parseFloat(y) + i * parseFloat(lh)}"${anchorAttr}>${escapeXml(line)}</text>`
    ).join("\n");
  });
  // Second: simple {{KEY}} substitution.
  tpl = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = pickField(row, k.toLowerCase(), lang);
    return v == null ? "" : escapeXml(String(v));
  });
  return tpl;
}

/** Greedy word-wrap. Matches the spirit of Python textwrap.wrap. */
export function wrap(text, width) {
  const out = [];
  for (const para of String(text).split(/\n\s*\n/)) {
    const flat = para.split(/\s+/).filter(Boolean).join(" ");
    if (!flat) { out.push(""); continue; }
    const words = flat.split(" ");
    let line = "";
    for (const w of words) {
      const next = line ? line + " " + w : w;
      if (next.length > width && line) { out.push(line); line = w; }
      else line = next;
    }
    if (line) out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

export function escapeXml(s) {
  return String(s).replace(/[&<>]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
}

/* === Splotch decoration =====================================================
 *
 * Each card gets a handful of decorative ink splotches at randomised
 * positions, sizes, rotations, and opacities. The seed is the card name
 * so renders are stable across reloads. Matches the *intent* of
 * build.py's `_render_splotches` (output won't be byte-identical to the
 * Python version since the PRNGs differ — we only need within-JS
 * stability, not cross-language parity). */
const SPLOTCH_IMAGES = [
  "img-010-013-rgba.png",
  "img-010-015-rgba.png",
  "img-011-017-rgba.png",
  "img-011-019-rgba.png",
  "img-020-033-rgba.png",
  "img-021-037-rgba.png",
  "img-046-077-rgba.png",
  "img-066-106-rgba.png",
];
const SPLOTCH_DIR = "images/alpha";

function renderSplotches(seed, count = 5) {
  const rng = mulberry32(hashStr(seed));
  const pick = (lo, hi) => lo + rng() * (hi - lo);
  const out = [];
  for (let i = 0; i < count; i++) {
    const img  = SPLOTCH_IMAGES[Math.floor(rng() * SPLOTCH_IMAGES.length)];
    const size = pick(35, 65);
    const x    = pick(-15, CARD_W - size + 15);
    const y    = pick(-15, CARD_H - size + 15);
    const rot  = pick(0, 360);
    const op   = pick(0.12, 0.22);
    const cx = x + size / 2, cy = y + size / 2;
    out.push(
      `<image xlink:href="${SPLOTCH_DIR}/${img}" ` +
      `x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
      `width="${size.toFixed(2)}" height="${size.toFixed(2)}" ` +
      `preserveAspectRatio="xMidYMid slice" opacity="${op.toFixed(3)}" ` +
      `transform="rotate(${rot.toFixed(1)} ${cx.toFixed(2)} ${cy.toFixed(2)})"/>`
    );
  }
  return out.join("\n  ");
}

/* Mulberry32 — tiny deterministic PRNG, returns [0,1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
