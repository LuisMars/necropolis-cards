# Necropolis Card Printer

Static page that imports a warband JSON from the
[Necropolis Companion App](https://necropolis28.vercel.app/) and lays out
printable A4 sheets of the matching cards from this repo's library.

Five tabs:

1. **Import** — paste the Companion App's JSON, a share link or a Builder
   backup (each import is also saved as a builder gathering). **Load warband** only reads
   the roster into the Warband tab; **Load & add cards to queue** also matches
   each trait / spell / weapon / armour / model profile against our card
   data and appends the hits to the print queue. Per-model `modelName` and
   the effective (post-modifier) stats from the JSON override the generic
   card data, so the printed copy reflects the actual model. Either button
   stores the raw payload, which is what the Warband tab renders from.
2. **Builder** — create and edit gatherings: covenant, lair name (typed,
   picked or rolled on the p.42 table), leader (type, keyword, traits,
   spells, mana split) and minions (type, keyword, trait, weapons, armour,
   equipment). Costs and stats update as you go, and every rule a choice
   breaks shows as a warning on its model rather than being blocked; the
   warning count opens a summary of them all, grouped by model, each one
   jumping to its model. From
   there a gathering opens in the Warband tab, queues its cards, copies its
   Companion App link, or downloads as the app's JSON or as a Builder
   backup. Saved gatherings live in the browser (localStorage). Edits go
   into a draft first, so options and gear can be tried freely: **Save
   changes** commits the draft, **Discard changes** puts everything back
   (treasury included); drafts survive a reload.
   Its **Campaign** view tracks the gathering between games: treasury and
   deployment limit (who is fielded, sellswords hired and the free ones the
   rules allow), lair upgrades, the 4 active ambitions with their rewards
   applied, treasures (rolled or picked, carried within the limits, moved
   between models), each model's stats with every change behind them (its
   keyword, traits, lair upgrades, and a ledger of ambition rewards,
   maladies and manual changes, each undoable at its source), the history
   of completed ambitions and maladies, and a battle log. Once the campaign
   has started, buying gear or minions anywhere in the Builder charges the
   treasury at Bazaar prices and removing weapons or armour sells them for
   half (p.72); every purchase and sale is listed until the next battle is
   logged, then kept in that battle's entry. **After the
   battle…** runs the rulebook's 7-step after-battle sequence as a wizard
   (maladies, victory rewards with lair income and Purloiner, ambitions,
   the greater treasure every 5, the Bazaar with the Alchemy Workshop, and
   the next scenario), every roll with a Roll button or a typed die; it can
   be left and resumed, and finishing it writes the battle-log entry.
3. **Warband** — the gathering as a roster (for a Builder gathering, stats the
   campaign changed are marked ▲/▼ and listed under CAMPAIGN with their source): one block per model
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
4. **Library** — filterable list of every card the bundle ships;
   click to add one to the queue.
5. **Print** — A4 sheets (3 × 3) with a bleed / no-bleed toggle, rendered
   as inline SVG and styled for `window.print()`.

The cards, the roster and the Builder tab follow the header's
card-language selector (English / Spanish); the rest of the app chrome
stays English.

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
    ├── import.js           # import tab (app JSON, share link, backup) + match list
    ├── builder-tab.js      # builder tab: gathering list + editor
    ├── builder-campaign.js # builder tab, campaign view
    ├── builder-afterbattle.js # builder tab, after-battle wizard
    ├── gatherings.js       # the page's saved gatherings (localStorage store)
    ├── warband.js          # warband tab: roster model + A4 roster sheets
    ├── icons.js            # roster glyphs (obol, AP, attacks, HP, …)
    ├── i18n.js             # card/roster language: label maps + field picker
    ├── library.js          # library tab
    ├── print.js            # print tab + queue editor + sheet rendering
    ├── templates.js        # {{KEY}} + BODY_BLOCK substitution into inline SVG
    ├── sample.js           # the "Load sample" payload
    ├── util.js             # escapeHtml, $ helper
    └── builder/            # warband builder — pure modules, no DOM
        ├── catalog.js      # rows by stable key ("melee-weapons/blade") and app ID
        ├── gathering.js    # the builder's save format
        ├── rules.js        # costs, effective stats, rule warnings
        ├── campaign.js     # campaign actions: treasury, upgrades, ambitions, treasures, log
        ├── ledger.js       # improvement ledger: stat changes with their source
        ├── codec.js        # Companion App share links
        ├── appjson.js      # Companion App JSON export ↔ gathering
        ├── messages.js     # warnings and builder labels, English / Spanish
        └── store.js        # saved-gatherings store over any Storage
```

The builder modules take the bundle as an argument and never touch the
page, so `tests/` runs them under Node (`python3 web/bundle.py && node
--test tests/*.test.js`; CI runs the same before each deploy).

No build step, no framework — every file is loaded as an ES module by
the browser at runtime.
