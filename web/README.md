# Necropolis Card Printer

Static page that imports a warband JSON from the
[Necropolis Companion App](https://necropolis28.vercel.app/) and lays out
printable A4 sheets of the matching cards from this repo's library.

Three tabs:

1. **Import** — paste the Companion App's JSON; the importer matches each
   trait / spell / weapon / armour / model profile against our card data
   and appends hits to the print queue. Per-model `modelName` and the
   effective (post-modifier) stats from the JSON override the generic
   card data, so the printed copy reflects the actual model.
2. **Library** — filterable list of every card the bundle ships;
   click to add one to the queue.
3. **Print** — A4 sheets (3 × 3) with a bleed / no-bleed toggle, rendered
   as inline SVG and styled for `window.print()`.

## Building the static bundle

```bash
python3 web/bundle.py
```

That writes:

- `web/data.json` — every row from `data/*.yaml` post-adapt (stats flattened,
  `armour_tag` derived, category-level `header`/`title`/`group` injected),
  plus the category index from `_categories.yaml`.
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
├── index.html              # app shell (header + 3 tab sections)
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
    ├── library.js          # library tab
    ├── print.js            # print tab + queue editor + sheet rendering
    ├── templates.js        # {{KEY}} + BODY_BLOCK substitution into inline SVG
    ├── sample.js           # the "Load sample" payload
    └── util.js             # escapeHtml, $ helper
```

No build step, no framework — every file is loaded as an ES module by
the browser at runtime.
