#!/usr/bin/env python3
"""
Necropolis card builder.

Reads YAML data from data/*.yaml, fills templates from templates/*.svg,
renders per-card PDFs, and combines them into one PDF per type plus an
A4 print-sheet PDF (9 cards per sheet, mixed).

Usage:
    cd ~/necropolis-cards
    python3 build.py            # build everything
    python3 build.py profiles   # build only one type (profiles|spells|rules)
"""

from __future__ import annotations
import re, sys, subprocess, textwrap, html, shutil, random
from pathlib import Path
import yaml
import fitz  # PyMuPDF — preserves text when compositing PDFs

MM_TO_PT = 72.0 / 25.4   # 1 mm = 2.834… pt

ROOT     = Path(__file__).resolve().parent
TPL_DIR  = ROOT / "templates"
DATA_DIR = ROOT / "data"
OUT_DIR  = ROOT / "output"
CARDS    = OUT_DIR / "cards"     # per-card SVG + PDF
SHEETS   = OUT_DIR / "sheets"    # per-card PNGs for sheet composition

CARDS.mkdir(parents=True, exist_ok=True)
SHEETS.mkdir(parents=True, exist_ok=True)

# Default placeholder image used when an entry leaves portrait/sigil blank.
BLANK_PX = "file:///dev/null"

# ---------- template substitution ----------

BODY_BLOCK_RE = re.compile(
    r'<!--\s*BODY_BLOCK:\s*(?P<key>\w+)\s*@\s*'
    r'x=(?P<x>[\d.]+)\s+y=(?P<y>[\d.]+)\s+'
    r'lineheight=(?P<lh>[\d.]+)\s+'
    r'width=(?P<w>\d+)chars\s+'
    r'maxlines=(?P<maxlines>\d+)'
    r'(?:\s+style=(?P<style>\w+))?'
    r'(?:\s+anchor=(?P<anchor>\w+))?'
    r'(?:\s+short_fill=(?P<short_fill>\w+))?'
    r'\s*-->'
)

def render_body_block(match: re.Match, value: str) -> str:
    """Expand a BODY_BLOCK marker into N <text> lines wrapped to fit.

    If `short_fill=true` is set and the wrapped content fits in <= 3 lines,
    render it centred in the block region with a larger font so the card
    doesn't feel empty.
    """
    x        = float(match.group("x"))
    y        = float(match.group("y"))
    lh       = float(match.group("lh"))
    width    = int(match.group("w"))
    maxlines = int(match.group("maxlines"))
    style    = match.group("style") or "body"
    anchor   = match.group("anchor")
    short_fill = (match.group("short_fill") or "").lower() == "true"

    paragraphs = (value or "").strip().split("\n\n")
    lines = []
    for p in paragraphs:
        flat = " ".join(p.split())
        if not flat:
            lines.append("")
            continue
        lines.extend(textwrap.wrap(flat, width=width))
        lines.append("")
    while lines and not lines[-1]:
        lines.pop()

    # Short-fill compact layout: content is short → render bigger and centred
    # on the card's open area (below banner ~y=18, above footer ~y=91).
    if short_fill and 1 <= len(lines) <= 3:
        cy_centre = 55  # roughly centre of the card body region
        flat = " ".join(" ".join(p.split()) for p in paragraphs if p.strip())
        big_lines = textwrap.wrap(flat, width=22) or [flat]
        big_lines = big_lines[:3]
        big_font = 7.5 if len(big_lines) == 1 else 6 if len(big_lines) == 2 else 5
        big_lh   = big_font * 1.3
        first_y = cy_centre - big_lh * (len(big_lines) - 1) * 0.5
        out = []
        for i, line in enumerate(big_lines):
            safe = html.escape(line)
            out.append(
                f'<text class="{style}" x="34.5" y="{first_y + i*big_lh:.2f}" '
                f'text-anchor="middle" font-size="{big_font}px" '
                f'font-style="italic" fill="#222">{safe}</text>'
            )
        return "\n  ".join(out)

    if len(lines) > maxlines:
        lines = lines[:maxlines]
        lines[-1] = lines[-1].rstrip(".") + "…"

    out = []
    anchor_attr = f' text-anchor="{anchor}"' if anchor else ""
    for i, line in enumerate(lines):
        if not line:
            continue
        cy = y + i * lh
        safe = html.escape(line)
        out.append(f'<text class="{style}" x="{x}" y="{cy}"{anchor_attr}>{safe}</text>')
    return "\n  ".join(out)

# Pure ink-splotch images used to decorate card backgrounds. Each card
# gets a few of these placed at random positions / rotations / scales,
# seeded by card name so renders are stable across builds.
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
SPLOTCH_DIR = "file:///home/luismars/necropolis-images/alpha"

def _render_splotches(seed: str, count: int = 5) -> str:
    """Return SVG <image> tags placing random splotches across the card.
    Seeded by card name so the same card always gets the same splotches."""
    rng = random.Random(seed)
    out = []
    for _ in range(count):
        img = rng.choice(SPLOTCH_IMAGES)
        size = rng.uniform(35, 65)         # mm
        x    = rng.uniform(-15, CARD_W_TRIM - size + 15)
        y    = rng.uniform(-15, CARD_H_TRIM - size + 15)
        rot  = rng.uniform(0, 360)
        op   = rng.uniform(0.12, 0.22)
        cx, cy = x + size/2, y + size/2
        out.append(
            f'<image xlink:href="{SPLOTCH_DIR}/{img}" '
            f'x="{x:.2f}" y="{y:.2f}" width="{size:.2f}" height="{size:.2f}" '
            f'preserveAspectRatio="xMidYMid slice" '
            f'opacity="{op:.3f}" '
            f'transform="rotate({rot:.1f} {cx:.2f} {cy:.2f})"/>'
        )
    return "\n  ".join(out)

def fill_template(template: str, data: dict) -> str:
    """Replace {{KEY}} markers and BODY_BLOCK markers in `template`."""
    result = template

    # Splotch decoration: replace <!-- SPLOTCHES --> marker with N random
    # decorative ink splotches, seeded by card name for stability.
    if "<!-- SPLOTCHES -->" in result:
        seed = str(data.get("name", "default"))
        result = result.replace("<!-- SPLOTCHES -->", _render_splotches(seed))

    # First: body blocks (they consume the marker comment and emit text lines)
    def body_repl(m):
        key = m.group("key")
        return render_body_block(m, data.get(key.lower(), ""))
    result = BODY_BLOCK_RE.sub(body_repl, result)

    # Strip <image> tags whose PORTRAIT/SIGIL value is empty.
    for key in ("PORTRAIT", "SIGIL"):
        if not data.get(key.lower()):
            result = re.sub(
                r'<image[^>]*\{\{' + key + r'\}\}[^>]*/>',
                "", result,
            )

    # Strip <text> elements whose ARMOUR_TAG would be empty, so the dash
    # doesn't render as a stray line.
    if not data.get("armour_tag"):
        result = re.sub(
            r'<text[^>]*\{\{ARMOUR_TAG\}\}[^<]*</text>',
            "", result,
        )

    # Then: simple {{KEY}} substitution
    def simple_repl(m):
        key = m.group(1)
        val = data.get(key.lower(), "")
        return html.escape(str(val), quote=True)
    result = re.sub(r"\{\{(\w+)\}\}", simple_repl, result)

    # Long-name fallback: if a <text class="name">…</text> exceeds the safe
    # single-line length, split into two tspans at the best word boundary
    # and drop the font-size so it fits.
    result = _fit_long_names(result)
    result = _fit_type_line(result)

    # A name that wrapped to two lines needs the subtitle below it nudged down
    # so the lower line's descenders (blackletter tails) clear it.
    if re.search(r'<text class="name"[^>]*>\s*<tspan', result):
        result = re.sub(
            r'(<text class="(?:type-line|category|restrict)"[^>]*?)y="([\d.]+)"',
            lambda m: f'{m.group(1)}y="{float(m.group(2)) + 1.5:.3f}"',
            result, count=1)

    return result

# Title-name fitting strategy:
#   Banner titles (y < BANNER_Y_THRESHOLD): shrink the FONT so the
#     blackletter keeps its natural proportions. Squeezing the glyphs to a
#     fixed width (textLength) condensed the letters and looked bad; longer
#     names overran the card edge entirely. Scaling the font instead keeps
#     every title centred, undistorted, and inside the trim.
#   Body names (below the banner):
#     ≤ 15 chars: full size, no constraint
#     16 – 22:    single-line, textLength compression
#     ≥ 23:       wrap to 2 lines at a smaller font
NAME_SHRINK_CHARS    = 16
NAME_MAX_CHARS       = 23
NAME_FIT_WIDTH_MM    = 53
BANNER_Y_THRESHOLD   = 17
BANNER_BASE_SIZE     = 7.0    # fallback banner font when none is set inline
BANNER_FIT_CHARS     = 16.5   # chars that fit at the base size before shrinking
BANNER_MIN_SIZE      = 3.2    # never shrink a title below this (fits ~36 chars)

def _with_font_size(attrs: str, size: float) -> str:
    """Force an inline font-size on a <text>, so it wins over the class rule."""
    sm = re.search(r'style="([^"]*)"', attrs)
    if sm:
        cleaned = re.sub(r'font-size:\s*[^;]+;?\s*', '', sm.group(1))
        return attrs.replace(sm.group(0), f'style="{cleaned}font-size: {size:.2f}px;"')
    return attrs + f' style="font-size: {size:.2f}px;"'

def _split_two_lines(text: str) -> list[str]:
    words = text.split()
    if len(words) == 1:
        return [text]
    best, best_diff = None, 10**9
    for i in range(1, len(words)):
        left, right = " ".join(words[:i]), " ".join(words[i:])
        if max(len(left), len(right)) > NAME_MAX_CHARS:
            continue
        diff = abs(len(left) - len(right))
        if diff < best_diff:
            best_diff, best = diff, (left, right)
    return list(best) if best else [text]

_NAME_TAG_RE = re.compile(
    r'<text class="(name|banner-title)"([^>]*)>([^<]+)</text>',
    re.MULTILINE,
)

def _fit_long_names(svg: str) -> str:
    def repl(m: re.Match) -> str:
        cls, attrs, content = m.group(1), m.group(2), m.group(3)
        n = len(content)
        if n <= NAME_SHRINK_CHARS:
            return m.group(0)  # short, no change

        x_m = re.search(r'x="([\d.]+)"', attrs)
        y_m = re.search(r'y="([\d.]+)"', attrs)
        if not (x_m and y_m):
            return m.group(0)
        x, y = float(x_m.group(1)), float(y_m.group(1))

        if y < BANNER_Y_THRESHOLD:
            # Banner title: shrink the font so the title keeps its natural
            # blackletter proportions and stays within the trim.
            base_m = re.search(r'font-size:\s*([\d.]+)px', attrs)
            base = float(base_m.group(1)) if base_m else BANNER_BASE_SIZE
            # Font-only shrink. NOTE: Inkscape's PNG/PDF export ignores
            # textLength on a <text> that follows a raster <image> (every card
            # puts the banner splotch before the title), so title width must be
            # controlled purely by font-size — hence the low BANNER_MIN_SIZE.
            size = max(BANNER_MIN_SIZE, base * BANNER_FIT_CHARS / n)
            return f'<text class="{cls}"{_with_font_size(attrs, size)}>{content}</text>'

        # Body name: compress to width, wrapping the longest to 2 lines.
        if n < NAME_MAX_CHARS:
            return (
                f'<text class="{cls}"{attrs} '
                f'textLength="{NAME_FIT_WIDTH_MM}" '
                f'lengthAdjust="spacingAndGlyphs">{content}</text>'
            )
        lines = _split_two_lines(content)
        if len(lines) < 2:
            # Single very long word — fall back to textLength compression
            return (
                f'<text class="{cls}"{attrs} '
                f'textLength="{NAME_FIT_WIDTH_MM}" '
                f'lengthAdjust="spacingAndGlyphs">{content}</text>'
            )
        # Tighter than a single line's slot so the second line clears the
        # subtitle/category text that sits just below the name baseline.
        line_h = 4.6
        y1 = y - line_h * 0.5
        y2 = y + line_h * 0.5
        new_attrs = (
            re.sub(r'y="[\d.]+"', f'y="{y1}"', attrs)
            + ' font-size="4.2"'
        )
        return (
            f'<text class="{cls}"{new_attrs}>'
            f'<tspan x="{x}" y="{y1}">{lines[0]}</tspan>'
            f'<tspan x="{x}" y="{y2}">{lines[1]}</tspan>'
            f'</text>'
        )
    return _NAME_TAG_RE.sub(repl, svg)

# The type/keyword subtitle line (leader / minion / sellsword) can carry many
# tag segments plus all three damage schools; with its letter-spacing a long
# line overruns the trim on both sides. Compress the wide ones to fit.
TYPE_LINE_FIT_CHARS    = 26
TYPE_LINE_FIT_WIDTH_MM = 56
_TYPE_LINE_RE = re.compile(r'<text class="type-line"([^>]*)>([^<]+)</text>')

def _fit_type_line(svg: str) -> str:
    def repl(m: re.Match) -> str:
        attrs, content = m.group(1), m.group(2)
        if "textLength" in attrs or len(content.strip()) <= TYPE_LINE_FIT_CHARS:
            return m.group(0)
        return (
            f'<text class="type-line"{attrs} '
            f'textLength="{TYPE_LINE_FIT_WIDTH_MM}" '
            f'lengthAdjust="spacingAndGlyphs">{content}</text>'
        )
    return _TYPE_LINE_RE.sub(repl, svg)

# ---------- per-card data adapters ----------

def adapt_profile(d: dict) -> dict:
    """Flatten the stats sub-dict so it's accessible as ap/m/viol/rngd/hp."""
    out = dict(d)
    s = d.get("stats", {}) or {}
    out["ap"]   = s.get("AP",   "")
    out["m"]    = s.get("M",    "")
    out["viol"] = s.get("VIOL", "")
    out["rngd"] = s.get("RNGD", "")
    out["hp"]   = s.get("HP",   "")
    return out

def adapt_equipment(d: dict) -> dict:
    """Derive ARMOUR_TAG: "Armour 1" / "Armour 2" or empty (then stripped)."""
    out = dict(d)
    a = d.get("armour")
    if isinstance(a, int) and a > 0:
        out["armour_tag"] = f"Armour {a}"
    else:
        out["armour_tag"] = ""
    return out

def adapt(card_type: str, template_name: str, d: dict) -> dict:
    """Apply per-template data shaping. Switches on the SVG template the
    category renders into (so e.g. both `melee-weapons` and `colossal-weapons`
    share the weapon.svg → no adaptation), not on the card_type itself."""
    if template_name in ("profile", "sellsword", "leader", "minion"):
        # All four share a stats: { AP, M, VIOL, RNGD, HP } sub-dict.
        return adapt_profile(d)
    if template_name == "equipment":
        return adapt_equipment(d)
    return d


# ---------- category index ----------

_CATEGORIES_CACHE: dict | None = None

def load_categories() -> list[dict]:
    """Read data/_categories.yaml and return a flat list of category dicts:
        {key, title, template, data, group}
    Each `data` is either the filename or None (blank-template categories).
    Falls back to a deduced legacy mapping when the file is missing."""
    global _CATEGORIES_CACHE
    if _CATEGORIES_CACHE is not None:
        return _CATEGORIES_CACHE
    idx = DATA_DIR / "_categories.yaml"
    if not idx.exists():
        # Legacy fallback — match the old hardcoded list.
        _CATEGORIES_CACHE = [
            {"key": k, "title": k.title(), "template": k, "data": f"{k}s.yaml", "group": "Legacy"}
            for k in ("weapon", "equipment", "spell", "rule", "sellsword")
        ]
        return _CATEGORIES_CACHE
    raw = yaml.safe_load(idx.read_text(encoding="utf-8")) or {}
    out = []
    for group in (raw.get("groups") or []):
        for it in (group.get("items") or []):
            out.append({**it, "group": group.get("title", "")})
    _CATEGORIES_CACHE = out
    return out

def category_by_key(key: str) -> dict | None:
    for c in load_categories():
        if c["key"] == key:
            return c
    return None

# ---------- build pipeline ----------

def safe_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "card"

def render_svg_to_pdf(svg_path: Path, pdf_path: Path) -> None:
    # No --export-text-to-path flag at all: Inkscape's default keeps text as
    # text. Specifying the flag (even =false) triggers path conversion.
    subprocess.run(
        ["inkscape", str(svg_path), "--export-type=pdf",
         "--export-dpi=300",
         f"--export-filename={pdf_path}"],
        check=True, capture_output=True,
    )

def render_svg_to_png(svg_path: Path, png_path: Path, dpi: int = 300) -> None:
    subprocess.run(
        ["inkscape", str(svg_path), "--export-type=png",
         f"--export-dpi={dpi}", f"--export-filename={png_path}"],
        check=True, capture_output=True,
    )

def combine_pdfs(pdf_paths: list[Path], out_path: Path) -> None:
    if not pdf_paths:
        return
    subprocess.run(["pdfunite", *map(str, pdf_paths), str(out_path)], check=True)

def build_type(card_type: str) -> list[tuple[str, Path, Path]]:
    """Render every card of one category. Returns [(slug, svg, pdf), ...]

    `card_type` is a category key from data/_categories.yaml (e.g.
    "melee-weapons", "spells"). Categories with no data file render nothing."""
    cat = category_by_key(card_type)
    if not cat:
        # Legacy fallback: try the old <type>s.yaml + <type>.svg convention.
        cat = {"key": card_type, "template": card_type, "data": f"{card_type}s.yaml"}
    if not cat.get("data"):
        print(f"  ({card_type}: no data, skipping — blank template category)")
        return []
    data_path = DATA_DIR / cat["data"]
    tpl_path  = TPL_DIR  / f"{cat['template']}.svg"
    if not data_path.exists():
        print(f"  (no data file at {data_path}, skipping)")
        return []
    if not tpl_path.exists():
        print(f"  (no template at {tpl_path}, skipping)")
        return []
    cards = yaml.safe_load(data_path.read_text(encoding="utf-8")) or []
    template = tpl_path.read_text(encoding="utf-8")
    # Category-level fields injected into every row so templates can use
    # {{HEADER}} / {{TITLE}} / {{GROUP}} placeholders.
    injected = {k: cat.get(k) for k in ("header", "title", "group") if cat.get(k) is not None}
    results = []
    print(f"  {card_type}: {len(cards)} card(s)")
    for i, d in enumerate(cards, 1):
        slug = f"{card_type}-{i:02d}-{safe_slug(d.get('name', f'card{i}'))}"
        svg_out = CARDS / f"{slug}.svg"
        pdf_out = CARDS / f"{slug}.pdf"
        row = adapt(card_type, cat["template"], d)
        for k, v in injected.items():
            row.setdefault(k, v)
        svg_out.write_text(fill_template(template, row), encoding="utf-8")
        render_svg_to_pdf(svg_out, pdf_out)
        results.append((slug, svg_out, pdf_out))
    return results

SHEET_SVG_TEMPLATE = '''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="210mm" height="297mm" viewBox="0 0 210 297">
  <rect x="0" y="0" width="210" height="297" fill="#ffffff"/>
  {tiles}
  {crop_marks}
</svg>
'''

# Card dimensions — standard TCG sleeve size. Templates are now natively
# sized at this trim size (no separate bleed-coordinate space), so the
# bleed-mode aliases all point at the trim dimensions and BLEED is 0.
# The "with bleed" sheet path still exists as a crop-mark-decorated layout
# variant; it no longer pads the artwork.
CARD_W_TRIM,  CARD_H_TRIM  = 63, 88
CARD_W_BLEED, CARD_H_BLEED = CARD_W_TRIM, CARD_H_TRIM
BLEED = 0

def crop_marks_for_card(card_x: float, card_y: float) -> str:
    """Generate SVG <line> crop marks for a card placed with bleed at (card_x, card_y).
    Marks sit just outside the trim corners (which are 3 mm inside the bleed card)."""
    tl = (card_x + BLEED, card_y + BLEED)
    tr = (card_x + BLEED + CARD_W_TRIM, card_y + BLEED)
    bl = (card_x + BLEED, card_y + BLEED + CARD_H_TRIM)
    br = (card_x + BLEED + CARD_W_TRIM, card_y + BLEED + CARD_H_TRIM)
    parts = []
    for (cx, cy), kx, ky in (
        (tl, -1, -1),  # extend up-left
        (tr,  1, -1),  # extend up-right
        (bl, -1,  1),  # extend down-left
        (br,  1,  1),  # extend down-right
    ):
        # Horizontal mark, 2.5 mm long, 0.5 mm gap from trim corner
        hx1 = cx + kx * 0.5
        hx2 = cx + kx * 3.0
        parts.append(
            f'<line x1="{hx1}" y1="{cy}" x2="{hx2}" y2="{cy}" '
            f'stroke="#000" stroke-width="0.15"/>'
        )
        # Vertical mark
        vy1 = cy + ky * 0.5
        vy2 = cy + ky * 3.0
        parts.append(
            f'<line x1="{cx}" y1="{vy1}" x2="{cx}" y2="{vy2}" '
            f'stroke="#000" stroke-width="0.15"/>'
        )
    return "\n  ".join(parts)

def _sheet_positions_bleed() -> list[tuple[float, float]]:
    """3×3 grid for full-card cells with a small gutter for crop marks."""
    step_x = CARD_W_TRIM + 3  # room for crop marks between cells
    step_y = CARD_H_TRIM + 3
    m_x = (210 - step_x * 3 + 3) / 2
    m_y = (297 - step_y * 3 + 3) / 2
    return [(m_x + (i % 3) * step_x, m_y + (i // 3) * step_y) for i in range(9)]

def _sheet_positions_nobleed() -> list[tuple[float, float]]:
    """3×3 grid for trim-only cards (63×88) butted with NO gap.
    User asked for straight-line cuts: cards share edges so one straight cut
    separates a whole row or column.
    Width: 3×63 = 189 → margin (210-189)/2 = 10.5
    Height: 3×88 = 264 → margin (297-264)/2 = 16.5"""
    return [(10.5 + (i % 3) * 63, 16.5 + (i // 3) * 88) for i in range(9)]

_SVG_OPEN_RE = re.compile(r"^.*?<svg\b[^>]*>", re.DOTALL)
_SVG_CLOSE_RE = re.compile(r"</svg>\s*$")

def _inline_card_content(card_svg: Path) -> str:
    """Read a card SVG and return its inner content (everything between
    <svg> and </svg>) so it can be wrapped in a nested <svg> tag.
    The wrapping <svg> provides viewBox + width/height for positioning."""
    src = card_svg.read_text(encoding="utf-8")
    src = _SVG_OPEN_RE.sub("", src, count=1)
    src = _SVG_CLOSE_RE.sub("", src)
    return src

def _compose_sheet(card_paths: list[Path | None], positions: list[tuple[float, float]],
                   *, with_bleed: bool, out_svg: Path) -> None:
    """Write one A4 sheet SVG with each card inlined as a nested <svg> so
    text remains vector text (selectable) in the final PDF.

    Previously cards were embedded via <image xlink:href="…svg"/> which
    Inkscape rasterised → unselectable text in the sheet PDF."""
    tiles: list[str] = []
    crops: list[str] = []
    w = CARD_W_BLEED if with_bleed else CARD_W_TRIM
    h = CARD_H_BLEED if with_bleed else CARD_H_TRIM
    for src, (x, y) in zip(card_paths, positions):
        if src is None:
            continue
        inner = _inline_card_content(src)
        if with_bleed:
            # <g transform> keeps text as selectable vector text (nested <svg>
            # was rasterised by Inkscape during PDF export)
            tiles.append(
                f'<g transform="translate({x},{y})">{inner}</g>'
            )
            crops.append(crop_marks_for_card(x, y))
        else:
            # No-bleed: translate so the trim corner is at the sheet position
            # and clip to the trim rectangle.
            cid = f"trim-{x:.1f}-{y:.1f}".replace(".", "_")
            tiles.append(
                f'<defs><clipPath id="{cid}">'
                f'<rect x="{x}" y="{y}" width="{CARD_W_TRIM}" height="{CARD_H_TRIM}"/>'
                f'</clipPath></defs>'
                f'<g transform="translate({x - BLEED},{y - BLEED})" '
                f'clip-path="url(#{cid})">{inner}</g>'
            )
    # For no-bleed: single straight-line cuts spanning the whole grid so one
    # cut separates a row or column. Cards butt with no gap.
    if not with_bleed and card_paths:
        grid_x0 = 10.5
        grid_y0 = 16.5
        grid_w  = CARD_W_TRIM * 3
        grid_h  = CARD_H_TRIM * 3
        crops.append(
            f'<rect x="{grid_x0}" y="{grid_y0}" '
            f'width="{grid_w}" height="{grid_h}" '
            f'fill="none" stroke="#000" stroke-width="0.2"/>'
        )
        # 2 verticals at column seams
        for i in (1, 2):
            cx = grid_x0 + i * CARD_W_TRIM
            crops.append(
                f'<line x1="{cx}" y1="{grid_y0}" x2="{cx}" y2="{grid_y0 + grid_h}" '
                f'stroke="#000" stroke-width="0.2"/>'
            )
        # 2 horizontals at row seams
        for i in (1, 2):
            cy = grid_y0 + i * CARD_H_TRIM
            crops.append(
                f'<line x1="{grid_x0}" y1="{cy}" x2="{grid_x0 + grid_w}" y2="{cy}" '
                f'stroke="#000" stroke-width="0.2"/>'
            )
    out_svg.write_text(SHEET_SVG_TEMPLATE.format(
        tiles="\n  ".join(tiles),
        crop_marks="\n  ".join(crops),
    ))

def _compose_sheet_pdf(card_pdfs: list[Path | None],
                       positions: list[tuple[float, float]],
                       *, with_bleed: bool, out_pdf: Path) -> None:
    """Compose an A4 PDF by placing per-card PDFs at given positions.
    Uses PyMuPDF so text in the source PDFs stays selectable in the output."""
    A4_W_PT = 210 * MM_TO_PT
    A4_H_PT = 297 * MM_TO_PT
    page_w_mm = CARD_W_BLEED if with_bleed else CARD_W_TRIM
    page_h_mm = CARD_H_BLEED if with_bleed else CARD_H_TRIM

    sheet = fitz.open()
    page = sheet.new_page(width=A4_W_PT, height=A4_H_PT)

    for src_pdf, (x_mm, y_mm) in zip(card_pdfs, positions):
        if src_pdf is None:
            continue
        src = fitz.open(src_pdf)
        try:
            target = fitz.Rect(
                x_mm * MM_TO_PT,
                y_mm * MM_TO_PT,
                (x_mm + page_w_mm) * MM_TO_PT,
                (y_mm + page_h_mm) * MM_TO_PT,
            )
            if with_bleed:
                page.show_pdf_page(target, src, 0)
            else:
                # Clip source page to trim region (3..66 × 3..91 in mm)
                src_w_pt = CARD_W_BLEED * MM_TO_PT
                src_h_pt = CARD_H_BLEED * MM_TO_PT
                clip = fitz.Rect(
                    BLEED * MM_TO_PT,
                    BLEED * MM_TO_PT,
                    (BLEED + CARD_W_TRIM) * MM_TO_PT,
                    (BLEED + CARD_H_TRIM) * MM_TO_PT,
                )
                # show_pdf_page can clip via the `clip` param (PyMuPDF >= 1.18)
                page.show_pdf_page(target, src, 0, clip=clip)
        finally:
            src.close()

    # Crop / cut guides drawn on top of the page
    if with_bleed:
        for x_mm, y_mm in positions:
            for cx_mm, cy_mm, dx, dy in (
                (x_mm + BLEED,               y_mm + BLEED,               -1, -1),
                (x_mm + BLEED + CARD_W_TRIM, y_mm + BLEED,                1, -1),
                (x_mm + BLEED,               y_mm + BLEED + CARD_H_TRIM, -1,  1),
                (x_mm + BLEED + CARD_W_TRIM, y_mm + BLEED + CARD_H_TRIM,  1,  1),
            ):
                # Horizontal tick (2.5 mm long, 0.5 mm gap from trim corner)
                page.draw_line(
                    fitz.Point((cx_mm + dx * 0.5) * MM_TO_PT, cy_mm * MM_TO_PT),
                    fitz.Point((cx_mm + dx * 3.0) * MM_TO_PT, cy_mm * MM_TO_PT),
                    color=(0, 0, 0), width=0.4,
                )
                page.draw_line(
                    fitz.Point(cx_mm * MM_TO_PT, (cy_mm + dy * 0.5) * MM_TO_PT),
                    fitz.Point(cx_mm * MM_TO_PT, (cy_mm + dy * 3.0) * MM_TO_PT),
                    color=(0, 0, 0), width=0.4,
                )
    else:
        gx0, gy0 = 10.5, 16.5
        gw, gh = CARD_W_TRIM * 3, CARD_H_TRIM * 3
        # Outer rectangle
        page.draw_rect(
            fitz.Rect(gx0 * MM_TO_PT, gy0 * MM_TO_PT,
                      (gx0 + gw) * MM_TO_PT, (gy0 + gh) * MM_TO_PT),
            color=(0, 0, 0), width=0.4,
        )
        # 2 verticals at column seams
        for i in (1, 2):
            cx = (gx0 + i * CARD_W_TRIM) * MM_TO_PT
            page.draw_line(
                fitz.Point(cx, gy0 * MM_TO_PT),
                fitz.Point(cx, (gy0 + gh) * MM_TO_PT),
                color=(0, 0, 0), width=0.4,
            )
        # 2 horizontals at row seams
        for i in (1, 2):
            cy = (gy0 + i * CARD_H_TRIM) * MM_TO_PT
            page.draw_line(
                fitz.Point(gx0 * MM_TO_PT, cy),
                fitz.Point((gx0 + gw) * MM_TO_PT, cy),
                color=(0, 0, 0), width=0.4,
            )

    sheet.save(out_pdf)
    sheet.close()

def build_sheet_pdf(all_cards: list[tuple[str, Path, Path]], *, with_bleed: bool = True) -> None:
    """Compose A4 sheets (3×3) using PyMuPDF — keeps text selectable."""
    if not all_cards:
        return
    suffix = "" if with_bleed else "-nobleed"
    positions = _sheet_positions_bleed() if with_bleed else _sheet_positions_nobleed()
    sheet_pdfs = []
    for idx, start in enumerate(range(0, len(all_cards), 9), 1):
        chunk: list[Path | None] = [c[2] for c in all_cards[start:start+9]]
        while len(chunk) < 9:
            chunk.append(None)
        sheet_pdf = SHEETS / f"sheet{suffix}-{idx:02d}.pdf"
        _compose_sheet_pdf(chunk, positions, with_bleed=with_bleed, out_pdf=sheet_pdf)
        sheet_pdfs.append(sheet_pdf)
    out_name = "print-sheets-a4" + suffix + ".pdf"
    combine_pdfs(sheet_pdfs, OUT_DIR / out_name)
    print(f"  → {OUT_DIR / out_name} ({len(sheet_pdfs)} sheet(s){' with crop marks' if with_bleed else ' no-bleed'})")

def build_blanks_sheet(template_name: str, copies: int, out_name: str) -> None:
    """Build an A4 sheet of N copies of one blank template."""
    src = TPL_DIR / template_name
    if not src.exists():
        print(f"  (missing {src}, skipping)")
        return
    sheet_pdfs = []
    positions = _sheet_positions_bleed()
    chunks = [list(range(min(9, copies - i))) for i in range(0, copies, 9)]
    for sheet_idx, chunk in enumerate(chunks, 1):
        tiles = [
            f'<image xlink:href="file://{src.resolve()}" '
            f'x="{positions[i][0]}" y="{positions[i][1]}" '
            f'width="{CARD_W_TRIM}" height="{CARD_H_TRIM}"/>'
            for i in chunk
        ]
        sheet_svg = SHEETS / f"{out_name}-{sheet_idx:02d}.svg"
        sheet_pdf = SHEETS / f"{out_name}-{sheet_idx:02d}.pdf"
        sheet_svg.write_text(SHEET_SVG_TEMPLATE.format(tiles="\n  ".join(tiles)))
        render_svg_to_pdf(sheet_svg, sheet_pdf)
        sheet_pdfs.append(sheet_pdf)
    combine_pdfs(sheet_pdfs, OUT_DIR / f"{out_name}.pdf")
    print(f"  → {OUT_DIR / f'{out_name}.pdf'} ({copies} card(s))")

# ---------- main ----------

def main():
    args = sys.argv[1:]

    # Default: build every category in data/_categories.yaml that has a data
    # file. (The handwritten blank templates have been removed — every card
    # type is now prefilled.)
    if args:
        types = args
    else:
        types = [c["key"] for c in load_categories() if c.get("data")]
    all_cards = []
    for t in types:
        print(f"Building {t} cards…")
        results = build_type(t)
        if results:
            combined = OUT_DIR / f"{t}s.pdf"
            combine_pdfs([r[2] for r in results], combined)
            print(f"  → {combined} ({len(results)} card(s))")
        all_cards.extend(results)

    if all_cards:
        print("Composing A4 print sheets (with bleed + crop marks)…")
        build_sheet_pdf(all_cards, with_bleed=True)
        print("Composing A4 print sheets (no-bleed)…")
        build_sheet_pdf(all_cards, with_bleed=False)

    print("\nDone. Outputs in:", OUT_DIR)

if __name__ == "__main__":
    main()
