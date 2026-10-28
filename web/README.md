# Necropolis Card Printer

Static page that imports a warband JSON from the
[Necropolis Companion App](https://necropolis28.vercel.app/) and lays out
printable A4 sheets of the matching cards from this repo's library.

Four tabs:

1. **Import** — paste the Companion App's JSON. **Load warband** only reads
   the roster into the Warband tab; **Load & add cards to queue** also matches
   each trait / spell / weapon / armour / model profile against our card
   data and appends the hits to the print queue. Per-model `modelName` and
   the effective (post-modifier) stats from the JSON override the generic
   card data, so the printed copy reflects the actual model. Either button
   stores the raw payload, which is what the Warband tab renders from.
2. **Warband** — the imported gathering as a roster: one block per model
   with its profile stats, special rules, traits, spells, weapons, armour
   and equipment — each with the rules text and stat line off its card, and
   priced from the library — plus a per-model subtotal and the warband
   total (against the payload's `totalObols` budget when it has one). Drawn in the cards' aesthetic — parchment,
   blackletter, small-caps headings — on A4 pages that print as-is via
   **⎙ Print roster**.

   A few rules the app exports have no card of their own — four it names
   (Caster, Insubstantial, Unique, Brutal, all of which already print inside
   their model's profile text) and nine restrictions it exports with no name
   at all. Their Spanish lives in `data/app-glossary.yaml`, which `bundle.py`
   ships under data.json's own `glossary` key. It is deliberately absent from
   `_categories.yaml`, so it makes no Library tile, no queue entry and no
   PDF — the roster just falls back to it, by exact text, when a card lookup
   misses. A covenant with no card keeps the payload's own wording rather
   than fuzzy-matching a different one.

   Affinity-conditional rules ("Bone/Blood/Plasm Warrior" and the Leader
   equivalents) are filtered to the model's chosen keyword and flagged
   `✓ applied`, since the exported stats already include their modifier —
   as are the traits that modify a stat, listed under `applied_traits` in
   the glossary because the export drops the modifier itself. Cost, AP,
   attacks, HP, mana and armour carry a glyph (`web/js/icons.js`) so the
   numbers read at a glance.
   The Companion App holds that as `condition: {affinity}` beside a
   `modifier`, but strips both from its JSON export, so `warband.js`
   recovers the condition from the rule's name or its "If this model
   choses the &lt;Affinity&gt; keyword…" effect text. A model that hasn't
   picked a keyword yet (affinity exported as `Blood/Bone/Plasm`) shows
   all of them, unflagged — same as the app.
3. **Library** — filterable list of every card the bundle ships;
   click to add one to the queue.
4. **Print** — A4 sheets (3 × 3) with a bleed / no-bleed toggle, rendered
   as inline SVG and styled for `window.print()`.

Both the cards and the roster follow the header's card-language selector
(English / Spanish); the surrounding app chrome stays English.

## Building the static bundle

```bash
python3 web/bundle.py
```

That writes:

- `web/data.json` — every row from `data/*.yaml` post-adapt (stats flattened,
  `armour_tag` derived, category-level `header`/`title`/`group` injected),
  plus the category index from `_categories.yaml` and, under `glossary`,
  `data/app-glossary.yaml` verbatim.
- `web/templates/*.svg` — copy of every template referenced by the index,
  with `file:///home/luismars/necropolis-images/…` URIs rewritten to
  relative `../images/…` paths.
- `web/images/alpha/*.png` — only the images templates actually use.

## Running locally

```bash
python3 -m http.server -d web 8000
```

then open `http://localhost:8000/`. (`file://` won't work because the page
uses ES modules.)

## Deploying to GitHub Pages

A workflow at `.github/workflows/pages.yml` builds the bundle on every push
to `main` and publishes `web/` as the Pages site. To enable it:

1. **Settings → Pages → Source: GitHub Actions.**
2. Push to `main` (or trigger the workflow manually under the **Actions**
   tab → *Deploy card printer to GitHub Pages* → *Run workflow*).
3. First successful run prints the live URL.

If you'd rather avoid Actions, you can also use the branch approach: run
`python3 web/bundle.py` locally, then push the `web/` directory to a
`gh-pages` branch and point Pages at it.

## Module map

```
web/
├── index.html              # app shell (header + 4 tab sections)
├── styles.css              # screen + print CSS
├── bundle.py               # data + templates + images builder
├── data.json               # generated
├── templates/              # generated
├── images/                 # generated
└── js/
    ├── main.js             # boot + tab switching
    ├── state.js            # global state + localStorage queue
    ├── data.js             # fetches data.json + templates, builds the name index
    ├── matching.js         # normName + findCard + keyHintFromSource
    ├── import.js           # JSON import tab + match list
    ├── warband.js          # warband tab: roster model + A4 roster sheets
    ├── icons.js            # roster glyphs (obol, AP, attacks, HP, …)
    ├── i18n.js             # card/roster language: label maps + field picker
    ├── library.js          # library tab
    ├── print.js            # print tab + queue editor + sheet rendering
    ├── templates.js        # {{KEY}} + BODY_BLOCK substitution into inline SVG
    ├── sample.js           # the "Load sample" payload
    └── util.js             # escapeHtml, $ helper
```

No build step, no framework — every file is loaded as an ES module by
the browser at runtime.
