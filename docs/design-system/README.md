# Necropolis · Bone Coal v5.4 — implementation reference

**Open `web/design-reference.html` after running `python3 web/bundle.py` and serving `web/` over HTTP.** The page uses the application's actual `web/styles.css`, `web/design-v5.css`, bundled fonts, and (when available) the real SVG card renderer. It is a specimen page, not a second application.

## Source of truth

| Concern | Source |
|---|---|
| Color tokens, layout skin, control dimensions | `web/design-v5.css` |
| Base application and original font declarations | `web/styles.css` |
| Real builder HTML generation and events | `web/js/builder-tab.js` |
| Campaign screen and ledger | `web/js/builder-campaign.js`; `web/js/builder/campaign.js` |
| After-battle wizard | `web/js/builder-afterbattle.js` |
| Card library | `web/js/library.js` |
| Queue and print flow | `web/js/print.js` |
| **Original PDF-based cards** | `templates/*.svg`, `web/js/templates.js`, `web/bundle.py` |
| A4 roster | `web/js/warband.js` |

## Non-negotiable visual constraints

1. Keep card art, decorative ink splatters, SVG templates, fonts *inside printed cards*, 63 × 88 mm dimensions, and A4 layout unchanged. Do not copy a mock card into production. The HTML reference loads the real rendered card where generated assets exist.
2. Use JSL Blackletter only for the Necropolis brand and the unchanged game cards; Alegreya Small Caps for compact headers and action headings; Alegreya for legible prose, numbers and ordinary inputs.
3. Bone Coal is **warm grayscale**: page `#171512`, panels `#302D28`, raised fields `#3A3630`, bone text `#F2ECDF`, secondary `#E0D5C5`. Semantic colors: success `#94D2AF`, warning `#EFC17F`, error `#E9968C`. Do not use these accents decoratively.
4. Avoid piling decorative frames on editable panels. Card artwork can be ornate; application chrome should prioritize usable hierarchy, clear fields, and visible state.
5. Keep `design-v5.css` within `@media screen`. Its role is screen chrome; the game's `@media print` is authoritative.

## Reuse the working HTML patterns

- **Affinity:** `fieldset.bd-affinity-control` with `label.bd-affinity-option > input[type=radio] + span` is already wired to the existing `data-act="m-aff"` change handler. Production renders options via `allowedAffinities(m.profile)`; the specimen is intentionally static. Do **not** replace production events with the sample's event handlers.
- **Builder / Campaign switch:** `.bd-views` with `button[data-act="view"][data-view][aria-pressed]` is already wired; don't duplicate the router or persist screen selection as game state.
- **Stats:** `dl.bd-stats > div.bd-stat > dt + dd`; production values must come from `evaluate(g, catalog())`, not hardcoded specimen figures.
- **Warnings:** `ul.bd-warn`; rule violations continue to be returned by the actual builder rules. Include clear text in addition to amber color or a warning icon.
- **Dropdown:** Preserve native `select` for short lists; reserve 44px on its right end so the chevron does not overlap text. Don't replace every select with a custom popover.
- **Long equipment catalogs:** Searchable picker is a proposal, **not implemented**. If added, it must maintain category grouping, stable keys, legality explanations, keyboard accessibility, and the `m-add` event/data contract.
- **Campaign and after-battle:** Existing rules and the seven-step after-battle process are authoritative. Specimen panels are visual examples only.

## Developer steps

1. `python3 web/bundle.py`
2. `python3 -m http.server -d web 8000`
3. Open `http://localhost:8000/design-reference.html`, then `http://localhost:8000/`.
4. Compare actual controls with specimens. Fix discrepancies in the real HTML-generating modules or shared CSS, never by pasting dummy data into the app.
5. Test keyboard focus, radio selection, model restrictions, long select labels, mobile widths, all seven after-battle steps, and card/roster printing.
6. Run `node --test tests/*.test.js` after generating the bundle. Confirm printed card output has no visual regression.

## Status

This documentation accompanies draft PR #6, targeting `warband-builder`. That base branch has advanced since the design branch was created. Reconcile newer commits and run browser tests before merging. The design specimen does not prove the full app has passed a11y/visual tests.

### Research references

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA radio group pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/)
- [WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- [IBM Carbon dropdown guidance](https://carbondesignsystem.com/components/dropdown/usage/)
- [USWDS combo box](https://designsystem.digital.gov/components/combo-box/)
