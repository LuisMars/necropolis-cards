# Necropolis · Bone Coal v5.8 — implementation reference

**Five palettes: Obsidian, Vellum (light), Ink & Bone, Soft Ash and Slate. The default is "Match device": Obsidian on a dark device, Vellum on a light one, following changes live. Pick one under Settings → Theme. The choice persists in localStorage under `necropolis-ui-palette-v56` (existing saved values keep working), and it never changes the cards or anything printed.**

**Open `web/design-reference.html` after running `python3 web/bundle.py` and serving `web/` with `python3 web/serve.py 8000`.** Don't use `python3 -m http.server`: it drops the large card images. The gallery uses the app's real `styles.css`, `design-v5.css`, `design-palettes.css` and `select.css`, its fonts, its icons (`web/js/lucide.js`), its themed dropdowns (`web/js/select.js`) and the real SVG card renderer. It's a specimen page, not a second application.

## Source of truth

| Concern | Source |
|---|---|
| Base design and component dimensions | `web/design-v5.css` |
| Palettes and screen-only token overrides | `web/design-palettes.css` |
| Palette choice ("Match device" or a palette), persistence, sync | `web/js/design-palettes.js` (runs in `<head>`, so there's no flash) |
| Base application and original font declarations | `web/styles.css` |
| Themed dropdowns | `web/js/select.js`, `web/select.css` (screen only) |
| Interface icons (Lucide, ISC) | `web/js/lucide.js`, licence in `web/icons/LICENSE-lucide.txt` |
| Header, routes, Settings | `web/index.html`, `web/js/main.js` |
| Gathering header, model cards, models list | `web/js/builder-tab.js` |
| The "Add" picker and the campaign's remove choice | `web/js/builder-picker.js` |
| Campaign screen and ledger | `web/js/builder-campaign.js`; `web/js/builder/campaign.js` |
| After-battle wizard | `web/js/builder-afterbattle.js` |
| Card library | `web/js/library.js` |
| Queue, print flow and the shared sheet renderer | `web/js/print.js` |
| **Original PDF-based cards** | `templates/*.svg`, `web/js/templates.js`, `web/bundle.py` |
| A4 roster (and its own printed glyphs, `web/js/icons.js`) | `web/js/warband.js` |

## Non-negotiable visual constraints

1. Keep the card art, ink splatters, SVG templates, the fonts inside printed cards, the 63 × 88 mm size and the A4 layout unchanged. Don't copy a mock card into production; the gallery loads the real rendered card.
2. Typefaces have fixed roles. **JSL Blackletter** is for the brand, the gathering's name, model names (as on their cards), the roster title and the cards. **Alegreya SC** is for other headings, labels and actions. **Alegreya** is for prose, numbers and field values.
3. Palettes are tokens only (`--nc-*`, plus the legacy `--bg` … `--bad`), each with its own `color-scheme`. Success, warning and error must reach WCAG AA (4.5:1) as text, on their `-bg` and on every surface; the gallery's contrast table checks the palette in use. Keep them semantic, never decorative.
4. Don't pile decorative frames on editable panels. Card artwork can be ornate; the application chrome puts usable hierarchy, clear fields and visible state first.
5. Keep `design-v5.css`, `design-palettes.css` and `select.css` within `@media screen`. Screen palettes must **never** recolour the card SVGs or affect the `@media print` styles. `tests/ui/print.test.mjs` compares the printed sheets and the roster pixel for pixel across every palette.
6. Active states (tabs, view switches, chips, the current model) are a border plus a raised background. No underline, no inset shadow.

## Navigation

- Two destinations in the header: **Gatherings** and **Cards** (with the print-queue count). The open one is a raised panel with a border.
- Hash routes, so reload and Back work:
  - `#gatherings`, `#gatherings/campaign` and `#gatherings/roster` (the Roster view's **Sheet**);
  - `#gatherings/roster/cards`, the Roster view's **Cards**: the gathering's own card sheets;
  - `#cards` (Library) and `#cards/queue` (Print queue).
- Each destination has a local switch (`.bd-views`, `button[aria-pressed]`): a light row of words without a box around it.
- **Settings** is a `<details>` disclosure holding Language and Theme. It closes on Escape and on a click outside it; a click in a dropdown's list (a portal in `<body>`) counts as inside.
- There's one primary action in the header, **Print**, which names what it prints ("Print roster", "Print 23 cards") or says why it can't.

## Reuse the working HTML patterns

- **Gathering header** (`section.bd-ghead`, above all three views): the name in blackletter (`input.bd-gname`, `data-act="name"`), the covenant and the lair (name, roll, pick), the figures inline (`dl.bd-figs`: obols spent of the budget with its bar, or the treasury and roster value once the campaign has started; deployment limit; models), the gathering's own warnings, a warning count that opens the full summary, Save / Discard (`.bd-draft`), and a secondary row (View roster, Add cards to queue, Share or export). In the Campaign and Roster views it's compact: name, figures and warning count only.
- **Models list** (`aside.bd-side > nav.bd-nav`, Gathering view only): one button per model in the gathering's order, showing its name or type, its type, its cost and ⚠N. It scrolls to and focuses `#bd-model-<uid>`, and the model in view gets `aria-current`. **Add a model** comes last. Below 1080px it becomes a wrapping row of chips above the cards. The Campaign and Roster views have no sidebar.
- **Affinity:** `fieldset.bd-affinity-control` with `label.bd-affinity-option > input[type=radio] + span`, wired to `data-act="m-aff"`. The options come from `allowedAffinities(m.profile)`.
- **Stats:** `dl.bd-stats > div.bd-stat > dt + dd`. Values come from `evaluate(g, catalog())`, never from specimen figures.
- **Model lists:** every list the model can have is always shown, in card order: Traits, then Spells and Mana (leaders only), Weapons, Armour and Equipment. An empty list says "None yet". Each list has its own **Add …** button (`data-act="m-pick"`, `data-list`, a distinct `data-fid`). Sellswords show their fixed armaments and have no Add buttons.
- **The "Add" picker** (`dialog.bd-picker`, opened with `showModal()`):
  - The title names the model. The search field is focused first; it ignores case and accents and matches name, kind and rules text.
  - Filter chips by kind: trait kinds, spell schools, and melee, ranged, thrown and colossal for weapons.
  - Rows are grouped as on the cards, each with its cost and a short summary. Arrow keys move through them, Enter adds, Escape or Done closes, and focus goes back to the button that opened it.
  - Adding keeps the dialog open and announces "Added …" through an `aria-live` region.
  - A row that would break a rule carries `data-reason`, the text of the first *new* warning. The item is tried on a copy of the gathering through the same add path, run through `evaluate`, and compared with the warnings now. The row stays selectable: the Builder warns, it never blocks.
  - Keys stay `list|category/slug`, and the change goes through the same `edit()` / `addItem` path (`buyGear` in a campaign).
  - In a campaign, "From the stash (free)" comes before "Buy at the Markets".
  - On phones the dialog is full-screen.
- **Gear stash** (campaign only). It isn't a rulebook rule: p.72 only covers buying and selling, so the app adds this as a convenience and says so in its help text. In a campaign, taking gear off a model asks what to do with it:
  - sell it (weapons and armour, for half their price, p.72);
  - keep it in the stash;
  - discard it (equipment, which can't be sold).
  
  The Campaign view lists the stash next to the treasures, with "Give to…", Sell and discard.
- **Warnings:** `ul.bd-warn` is one panel per group. It has `--nc-warning-bg`, a 3px `--nc-warning` rule on the left and no full outline. The items are plain lines in `--nc-bone`, separated by a warning-tinted hairline. Each item has the triangle-alert icon in `--nc-warning` plus its text, never colour alone. The draft bar and the full summary (`.bd-sum`) use the same panel. Rule text always comes from `describe()` on real `evaluate` warnings.
- **Dropdowns:** on fine pointers, `select.js` turns every `<select>` into a themed, keyboard-accessible WAI-ARIA select-only combobox. The native select stays in the DOM as the source of truth: delegated `data-act` change handlers, `data-fid` focus restore and Playwright's `selectOption` keep working. On touch (coarse pointers) the native picker stays, only restyled. Lists of more than 12 options get a filter field, and its strings follow the Language setting. An option's `data-reason` is shown muted under it. Layout rules target the wrapper (`.nc-select`, or `:is(select,.nc-select)`), never the hidden native select. Chevrons are drawn in `currentColor`, never in a data-URI colour.
- **Icons:** Lucide (ISC, 24px grid, 2px stroke, `currentColor`), vendored as SVG children in `web/js/lucide.js` (lucide-static 1.55.0), only the icons the app uses. Call `icon(name)` from JS, or put `data-icon="name"` in static HTML. Icons are `aria-hidden`, and the button or the text says what they mean. CSS-only shapes (the fold chevron, the done tick) are Lucide paths used as masks over `currentColor`. Emoji aren't used in the interface; a UI test checks for them. The roster sheet keeps its own printed glyphs (`web/js/icons.js`).
- **Roster, Cards part:** every card the gathering uses, matched exactly as "Add cards to queue" matches them (`payloadCards` in `import.js`). They're laid out by the queue's own renderer (`renderSheetsInto` in `print.js`), so the sheets are identical, and the shared queue isn't touched. "Skip cards I already have" uses the queue's "only what I still need" rule (`stillNeeded`). The part not in use is `hidden`, so it doesn't print either.
- **Campaign and after-battle:** the existing rules and the seven-step after-battle sequence are authoritative. Specimen panels are only visual examples.

## Developer steps

1. `python3 web/bundle.py`
2. `python3 web/serve.py 8000`
3. Open `http://localhost:8000/design-reference.html`, then `http://localhost:8000/`.
4. Switch all five palettes and Match device (with the device in light and in dark mode) in the app and the gallery. Confirm the choice survives a refresh.
5. Compare the real controls with the specimens. Fix discrepancies in the real HTML-generating modules or the shared CSS, never by pasting dummy data into the app.
6. Run `npm test` (engine) and `npm run test:ui` (the Builder, the picker and the stash, the themed dropdown, and the print guard: the printed cards and roster are identical in every palette, and the Roster's Cards part matches the queue).

### Research references

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA select-only combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/)
- [WAI-ARIA dialog (modal) pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [WAI-ARIA radio group pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/)
- [Lucide icons](https://lucide.dev)
