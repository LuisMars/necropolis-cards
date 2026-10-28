/* v5.6 — palette state for app and reference gallery. Does not touch game state or prints. */
(() => {
  "use strict";
  const KEY = "necropolis-ui-palette-v56";
  const VALID = new Set(["ink-bone", "obsidian", "soft-ash", "slate"]);
  let initial = "obsidian";
  try { const value = localStorage.getItem(KEY); if (VALID.has(value)) initial = value; } catch (_) {}
  const apply = (id, persist) => {
    const value = VALID.has(id) ? id : "obsidian";
    document.documentElement.dataset.ncPalette = value;
    document.querySelectorAll("[data-nc-palette-control]").forEach(control => {
      if (control.value !== value) control.value = value;
    });
    if (persist) { try { localStorage.setItem(KEY, value); } catch (_) {} }
    document.dispatchEvent(new CustomEvent("necropolis:palette-change", {detail:{palette:value}}));
  };
  document.addEventListener("change", event => {
    if (event.target.matches("[data-nc-palette-control]")) apply(event.target.value, true);
  });
  // Read stored preference immediately, before script is deferred or loaded at end of body.
  apply(initial, false);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => apply(initial, false), {once:true});
})();
