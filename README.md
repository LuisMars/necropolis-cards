# Necropolis Cards

Printable reference cards for **Necropolis: A Diorama Skirmish Game**
(by Peter Vigors, [Owl Shield Games](https://linktr.ee/owlshield)).
The site at **<https://necropolis.luismars.com>** imports a warband JSON
from the [Companion App](https://necropolis28.vercel.app/) and lays out
A4 print sheets of the matching cards, plus a printable roster sheet of
the warband itself (per-model gear and costs, and the gathering's total).

> Fan-made. Not affiliated with or endorsed by Owl Shield Games. The
> rulebook PDF is the author's IP and is **not** distributed in this
> repository. Card art and rules text on each card are reproduced for
> personal play reference only.

## Layout

```
.
├── data/             YAML rows for every card category
│   ├── _categories.yaml   Index — single source of truth
│   └── app-glossary.yaml  Not a category: Spanish for Companion-App
│                          text that has no card (see web/README.md)
├── templates/        SVG templates (63×88 mm) with {{KEY}} substitutions
├── assets/
│   ├── images/alpha/      Card art (vendored from the rulebook)
│   └── fonts/             TTFs (vendored — local install not required)
├── web/              Static site source (index.html + js/ + styles.css)
│   ├── bundle.py          Build script — writes data.json + templates/ + images/ + fonts/
│   └── CNAME              Custom-domain marker for GitHub Pages
├── editor/           Local SVG editor (python3 editor/server.py)
├── build.py          CLI to produce printable PDFs (Inkscape required)
└── .github/workflows/pages.yml   Build + deploy to GitHub Pages on push to main
```

## Run locally

```bash
# 1. Build the static bundle (data + assets → web/)
python3 web/bundle.py

# 2. Serve and open
python3 -m http.server -d web 8000
# → http://localhost:8000/
```

For template tweaks open the editor (separate dev tool):

```bash
python3 editor/server.py
# → http://localhost:8765/
```

## Deploy

Pushes to `main` trigger `.github/workflows/pages.yml`, which runs
`python3 web/bundle.py` and uploads `web/` as a GitHub Pages artifact.
First-time setup:

1. **Settings → Pages → Source → GitHub Actions**
2. **Settings → Pages → Custom domain →** `necropolis.luismars.com`
3. DNS: add a `CNAME` record pointing `necropolis` → `<gh-user>.github.io`
4. Push to `main`. The deploy URL appears under **Actions → Deploy card printer**.

The `web/CNAME` file inside the repo is what tells Pages the custom
domain; it ships unchanged in every deploy.

## PDF builds (optional)

`build.py` renders SVG cards to PDF via Inkscape. Not used by the web
site, kept for offline / print-shop output:

```bash
python3 build.py                       # full build
python3 build.py melee-weapons spells  # one or more categories
```

Outputs land under `output/` (gitignored).
