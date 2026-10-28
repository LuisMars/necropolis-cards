#!/usr/bin/env python3
"""Bundle data + templates + images into a self-contained static directory.

Reads:
  data/_categories.yaml + data/*.yaml   (card data)
  templates/*.svg                       (rendering templates)
  ../necropolis-images/alpha/*.png      (referenced by templates)

Writes:
  web/data.json                         (all rows post-adapt + category index)
  web/templates/*.svg                   (rewritten with relative image paths)
  web/images/alpha/*.png                (the image assets used by templates)

The result drops into any static host (GitHub Pages, Netlify, Vercel, or
just `python3 -m http.server` from the web/ dir).
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
TPL_DIR  = ROOT / "templates"
# Repo-vendored image assets — the absolute file:// path baked into
# `templates/*.svg` (legacy, kept for the local editor + build.py) is
# rewritten to `images/` at bundle time so the static site is portable.
IMG_DIR  = ROOT / "assets" / "images"
WEB_DIR  = ROOT / "web"
OUT_TPL  = WEB_DIR / "templates"
OUT_IMG  = WEB_DIR / "images"
OUT_FONTS = WEB_DIR / "fonts"

# Either prefix may appear inside the source templates; both are rewritten
# to `images/` in the published bundle.
FILE_URI_PREFIX_LEGACY = "file:///home/luismars/necropolis-images/"
FILE_URI_PREFIX_REPO   = "assets/images/"

# Decorative ink splotches sprinkled onto every card background by the
# client-side renderer (see `renderCardSvg` in web/js/templates.js).
# They're never referenced by static `<image>` tags in the templates, so
# `collect_images` misses them — bundle them explicitly.
SPLOTCH_IMAGES = [
    "img-010-013-rgba.png",
    "img-010-015-rgba.png",
    "img-011-017-rgba.png",
    "img-011-019-rgba.png",
    "img-020-033-rgba.png",
    "img-021-037-rgba.png",
    "img-046-077-rgba.png",
    "img-066-106-rgba.png",
]

# Fonts the templates reference. Copy whatever's on disk under the
# Linux font search paths into web/fonts/ so the static page is
# self-contained (no Google-Fonts dependency for the card text).
FONT_FILES = [
    "JBLACK.TTF",                  # JSL Blackletter
    "Alegreya-VF.ttf",
    "Alegreya-Italic-VF.ttf",
    "AlegreyaSC-Regular.ttf",
    "AlegreyaSC-Bold.ttf",
    "AlegreyaSC-Italic.ttf",
    "AlegreyaSC-BoldItalic.ttf",
]
FONT_SEARCH_DIRS = [
    ROOT / "assets" / "fonts",              # repo-vendored, used by CI
    Path.home() / ".local/share/fonts",     # local Linux desktop install
    Path("/usr/share/fonts"),
    Path("/usr/local/share/fonts"),
]


# ---------- adapters (mirror editor/server.py + build.py) ----------

def adapt_profile(d: dict) -> dict:
    out = dict(d)
    s = d.get("stats", {}) or {}
    out.setdefault("ap",   s.get("AP",   ""))
    out.setdefault("m",    s.get("M",    ""))
    out.setdefault("viol", s.get("VIOL", ""))
    out.setdefault("rngd", s.get("RNGD", ""))
    out.setdefault("hp",   s.get("HP",   ""))
    return out

def adapt_equipment(d: dict) -> dict:
    out = dict(d)
    a = d.get("armour")
    has_armour = isinstance(a, int) and a > 0
    out["armour_tag"] = f"Armour {a}" if has_armour else ""
    # Spanish equivalent of the derived armour tag (the card renderer prefers
    # `*_es` fields when Spanish is selected).
    out["armour_tag_es"] = f"Armadura {a}" if has_armour else ""
    return out

def adapt_row(template_name: str, d: dict) -> dict:
    if template_name in ("profile", "sellsword", "leader", "minion"):
        return adapt_profile(d)
    if template_name == "equipment":
        return adapt_equipment(d)
    return d


# ---------- main bundle ----------

def load_categories() -> list[dict]:
    raw = yaml.safe_load((DATA_DIR / "_categories.yaml").read_text(encoding="utf-8"))
    out = []
    for g in (raw.get("groups") or []):
        for it in (g.get("items") or []):
            out.append({**it, "group": g.get("title", "")})
    return out


def collect_images(svg_text: str) -> set[str]:
    """Return the set of image-folder-relative paths the SVG points at."""
    rels: set[str] = set()
    pattern = r'(?:xlink:href|href)="(?:' + \
              re.escape(FILE_URI_PREFIX_LEGACY) + "|" + \
              re.escape(FILE_URI_PREFIX_REPO) + \
              r')([^"]+)"'
    for m in re.finditer(pattern, svg_text):
        rels.add(m.group(1))
    return rels


def rewrite_svg(svg_text: str) -> str:
    """Replace either the legacy `file:///…/necropolis-images/…` URIs or
    the repo-relative `assets/images/…` paths with site-relative
    `images/` paths. SVGs get inlined into index.html at runtime so
    relative hrefs resolve against the page URL."""
    svg_text = svg_text.replace(FILE_URI_PREFIX_LEGACY, "images/")
    svg_text = svg_text.replace(FILE_URI_PREFIX_REPO,   "images/")
    return svg_text


def find_font(name: str) -> Path | None:
    """Locate a TTF/OTF by exact filename across the OS font dirs."""
    lower = name.lower()
    for base in FONT_SEARCH_DIRS:
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.is_file() and p.name.lower() == lower:
                return p
    return None


def bundle_fonts() -> int:
    """Copy known font files into web/fonts/ so the page is self-contained."""
    OUT_FONTS.mkdir(parents=True, exist_ok=True)
    copied = 0
    for name in FONT_FILES:
        src = find_font(name)
        if not src:
            print(f"  (font missing: {name})", file=sys.stderr)
            continue
        shutil.copy2(src, OUT_FONTS / name)
        copied += 1
        print(f"  font: {name}")
    return copied


def main():
    if not DATA_DIR.exists() or not TPL_DIR.exists():
        sys.exit("data/ or templates/ not found — run this from necropolis-cards/")

    OUT_TPL.mkdir(parents=True, exist_ok=True)
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    bundle_fonts()

    cats = load_categories()
    bundle: dict = {
        "groups": [],          # nested category tree
        "categories": {},      # {key: {title, template, header, group, rows: [...]}}
        "templates": {},       # {template_stem: "templates/<stem>.svg"} (path on web)
        "glossary": {},        # Companion-App text with no card of its own
    }

    # The glossary is not a category on purpose: it never reaches the Library,
    # the print queue or build.py — only the Warband tab's text lookup.
    glossary_path = DATA_DIR / "app-glossary.yaml"
    if glossary_path.exists():
        bundle["glossary"] = yaml.safe_load(glossary_path.read_text(encoding="utf-8")) or {}
        n = sum(len(v) for v in bundle["glossary"].values() if isinstance(v, list))
        print(f"  glossary: {n} entries")

    # Re-assemble groups for the tree view
    raw = yaml.safe_load((DATA_DIR / "_categories.yaml").read_text(encoding="utf-8"))
    for g in (raw.get("groups") or []):
        bundle["groups"].append({
            "title": g.get("title", ""),
            "items": [{"key": it["key"], "title": it.get("title", "")} for it in (g.get("items") or [])],
        })

    used_images: set[str] = set()
    template_stems: set[str] = set()

    for cat in cats:
        rows: list[dict] = []
        if cat.get("data"):
            data_path = DATA_DIR / cat["data"]
            if data_path.exists():
                raw_rows = yaml.safe_load(data_path.read_text(encoding="utf-8")) or []
                if not isinstance(raw_rows, list):
                    raw_rows = [raw_rows]
                tpl = cat["template"]
                rows = [adapt_row(tpl, r) for r in raw_rows]
                # Inject category-level fields (header / title / group, plus
                # their Spanish header/title variants for localised banners).
                injectable = {k: cat.get(k) for k in
                              ("header", "header_es", "title", "title_es", "group")
                              if cat.get(k) is not None}
                for r in rows:
                    for k, v in injectable.items():
                        r.setdefault(k, v)

        bundle["categories"][cat["key"]] = {
            "title":    cat.get("title", cat["key"]),
            "template": cat["template"],
            "header":   cat.get("header"),
            "group":    cat.get("group", ""),
            "rows":     rows,
        }
        template_stems.add(cat["template"])

    # Templates that aren't tied to a category but still ship with the
    # bundle (e.g. the card back, used by the print toolbar's optional
    # "card backs" toggle).
    template_stems.add("back")
    bundle["templates"]["back"] = "templates/back.svg"

    # Copy + rewrite templates
    for stem in sorted(template_stems):
        src = TPL_DIR / f"{stem}.svg"
        if not src.exists():
            print(f"  (template missing: {src})", file=sys.stderr)
            continue
        svg = src.read_text(encoding="utf-8")
        used_images |= collect_images(svg)
        (OUT_TPL / f"{stem}.svg").write_text(rewrite_svg(svg), encoding="utf-8")
        bundle["templates"][stem] = f"templates/{stem}.svg"
        print(f"  template: {stem}")

    # Splotch images are referenced only at runtime by the JS renderer,
    # so collect_images() won't have caught them. Add explicitly.
    for img in SPLOTCH_IMAGES:
        used_images.add(f"alpha/{img}")

    # Copy images that are actually referenced
    for rel in sorted(used_images):
        src = IMG_DIR / rel
        dst = OUT_IMG / rel
        if not src.exists():
            print(f"  (image missing: {src})", file=sys.stderr)
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    print(f"  copied {len(used_images)} image(s)")

    (WEB_DIR / "data.json").write_text(json.dumps(bundle, indent=2, ensure_ascii=False), encoding="utf-8")
    bytes_written = (WEB_DIR / "data.json").stat().st_size
    print(f"  wrote web/data.json ({bytes_written:,} bytes)")
    print(f"  serve with:  python3 -m http.server -d web 8000")


if __name__ == "__main__":
    main()
