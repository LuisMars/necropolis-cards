/* v5.6 — palette state for app and reference gallery. Does not touch game state or prints.
 *
 * The stored choice is "auto" (Match device) or a palette id. "auto" is the
 * default when nothing is stored: a dark device gets Obsidian, a light one
 * Vellum, and it follows the device live. <html> carries the resolved
 * palette in data-nc-palette (what the CSS keys on) and the choice in
 * data-nc-palette-choice. Runs in <head>, before first paint. */
(() => {
  "use strict";
  const KEY = "necropolis-ui-palette-v56";
  const AUTO = "auto", DARK = "obsidian", LIGHT = "vellum";
  const PALETTES = new Set(["ink-bone", "obsidian", "soft-ash", "slate", "vellum"]);
  const LABELS = { en: "Match device", es: "Según el dispositivo" };
  const root = document.documentElement;
  const light = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;
  const valid = id => id === AUTO || PALETTES.has(id);
  const resolve = id => id === AUTO ? (light && light.matches ? LIGHT : DARK) : id;

  let choice = AUTO;
  try { const value = localStorage.getItem(KEY); if (valid(value)) choice = value; } catch (_) {}

  const label = () => {
    const text = LABELS[(root.lang || "en").slice(0, 2)] || LABELS.en;
    document.querySelectorAll(`[data-nc-palette-control] option[value="${AUTO}"]`).forEach(o => {
      if (o.textContent !== text) o.textContent = text;
    });
  };
  const apply = (id, persist) => {
    choice = valid(id) ? id : AUTO;
    const palette = resolve(choice);
    if (root.dataset.ncPalette !== palette) root.dataset.ncPalette = palette;
    if (root.dataset.ncPaletteChoice !== choice) root.dataset.ncPaletteChoice = choice;
    document.querySelectorAll("[data-nc-palette-control]").forEach(control => {
      if (control.value !== choice) control.value = choice;
      // A control without "Match device" shows the palette in use.
      if (control.value !== choice && control.value !== palette) control.value = palette;
    });
    if (persist) { try { localStorage.setItem(KEY, choice); } catch (_) {} }
    document.dispatchEvent(new CustomEvent("necropolis:palette-change", {detail:{palette, choice}}));
  };

  document.addEventListener("change", event => {
    if (event.target.matches("[data-nc-palette-control]")) apply(event.target.value, true);
  });
  // Match device follows the system setting while the page is open.
  if (light) {
    const follow = () => { if (choice === AUTO) apply(AUTO, false); };
    if (light.addEventListener) light.addEventListener("change", follow); else if (light.addListener) light.addListener(follow);
  }
  // Another tab changed the theme.
  window.addEventListener("storage", event => { if (event.key === KEY) apply(event.newValue, false); });
  // The "Match device" option follows the page language (main.js sets <html lang>).
  new MutationObserver(label).observe(root, {attributes: true, attributeFilter: ["lang"]});

  // Read stored preference immediately, before script is deferred or loaded at end of body.
  apply(choice, false);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { label(); apply(choice, false); }, {once:true});
  else label();
})();
