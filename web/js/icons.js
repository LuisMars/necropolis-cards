/**
 * Roster glyphs.
 *
 * The numbers a player looks up mid-game — cost, action points, attacks,
 * armour — read faster with a mark in front of them than with an abbreviated
 * label, which is how the Companion App's model cards work too. These are our
 * own drawings of the same objects (a coin, a bolt, a heart), sized in mm to
 * sit on a text line and inheriting `currentColor` so they print as ink.
 *
 * Kept deliberately simple: solid shapes at ~3 mm survive a laser printer,
 * hairline strokes don't.
 */

const SVG = {
  // Obol — a coin, the bar top and bottom echoing the app's mark.
  obol: '<circle cx="6" cy="6" r="3.75" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
        '<circle cx="6" cy="6" r="1.3"/>' +
        '<rect x="5.35" y="0.4" width="1.3" height="1.7"/>' +
        '<rect x="5.35" y="9.9" width="1.3" height="1.7"/>',
  // Action points.
  bolt: '<path d="M7.6 0.4 1.9 6.9h3.2L4.2 11.6 10.1 4.9H6.7z"/>',
  // Hit points.
  heart: '<path d="M6 11.6Q0.5 7.4 0.5 4.4Q0.5 1 3.4 1Q6 1 6 3.5Q6 1 8.6 1Q11.5 1 11.5 4.4Q11.5 7.4 6 11.6Z"/>',
  // Attacks.
  diamond: '<path d="M6 1.2 10.5 6.3 6 11.4 1.5 6.3z"/>',
  // Armour value.
  shield: '<path d="M6 0.5 10.7 2v4.2c0 2.9-2.1 4.4-4.7 5.3C3.4 10.6 1.3 9.1 1.3 6.2V2z"/>',
  // Mana.
  drop: '<path d="M6 0.6C6 0.6 2.1 5 2.1 7.6a3.9 3.9 0 0 0 7.8 0C9.9 5 6 0.6 6 0.6z"/>',
  // Spells known.
  star: '<path d="M6 0.5 7.5 4.4 11.5 4.7 8.4 7.3 9.4 11.3 6 9.1 2.6 11.3 3.6 7.3 0.5 4.7 4.5 4.4z"/>',
};

/**
 * Inline SVG for `name`, or "" if there's no such glyph.
 * @param {string} name  key of SVG above
 * @param {string} cls   extra class (e.g. "big" for the stat strip)
 */
export function icon(name, cls = "") {
  const body = SVG[name];
  if (!body) return "";
  return `<svg class="wb-i${cls ? " " + cls : ""}" viewBox="0 0 12 12" ` +
         `aria-hidden="true" focusable="false">${body}</svg>`;
}
