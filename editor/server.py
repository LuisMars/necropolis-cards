#!/usr/bin/env python3
"""Local HTTP server backing the SVG card editor.

Endpoints:
  GET  /                          -> index.html
  GET  /api/templates             -> {"templates": ["weapon", "spell", ...]}
  GET  /api/template/<name>       -> raw SVG text
  PUT  /api/template/<name>       -> overwrite SVG (creates .bak once per session)
  GET  /api/data/<name>           -> parsed YAML as JSON list (e.g. weapon -> weapons.yaml)
  GET  /api/image/<rel>           -> file from necropolis-images/
  POST /api/upload-image          -> save uploaded image into necropolis-images/uploads/
  GET  /fonts/<name>              -> font file from ~/.local/share/fonts

Run:
  python3 editor/server.py [--port 8765]
Then open http://127.0.0.1:8765/
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import random
import re
import shutil
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import yaml

ROOT = Path(__file__).resolve().parent.parent
TPL_DIR = ROOT / "templates"
DATA_DIR = ROOT / "data"
EDITOR_DIR = Path(__file__).resolve().parent
IMG_DIR = Path("/home/luismars/necropolis-images")
FONT_DIRS = [
    Path.home() / ".local/share/fonts",
    Path("/usr/share/fonts"),
    Path("/usr/local/share/fonts"),
]

# Map template stem -> data file stem (template "weapon" -> data "weapons.yaml")
def data_file_for(template_name: str) -> Path | None:
    stem = template_name.removesuffix(".svg")
    # blanks have no data; same for legacy "profile"
    candidates = [
        DATA_DIR / f"{stem}s.yaml",
        DATA_DIR / f"{stem}.yaml",
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


# ---------- category index ----------

def load_categories() -> list[dict]:
    """Parse data/_categories.yaml. Returns a flat list of category dicts
    with the extra `group` field set from the enclosing group's title.

    Reads on every call so the file can be edited without restarting the
    server — the editor's left panel refreshes by re-fetching."""
    idx = DATA_DIR / "_categories.yaml"
    if not idx.exists():
        return []
    raw = yaml.safe_load(idx.read_text(encoding="utf-8")) or {}
    out = []
    for group in (raw.get("groups") or []):
        for it in (group.get("items") or []):
            out.append({**it, "group": group.get("title", "")})
    return out

def category_by_key(key: str) -> dict | None:
    for c in load_categories():
        if c["key"] == key:
            return c
    return None


# ---------- per-template data shaping ----------
# These mirror the adapters in build.py so the editor's preview matches the
# generated PDF output. Kept in sync manually — they're small.

def _adapt_profile(d: dict) -> dict:
    """Flatten stats sub-dict so {{AP}}/{{M}}/{{VIOL}}/{{RNGD}}/{{HP}} resolve."""
    out = dict(d)
    s = d.get("stats", {}) or {}
    out.setdefault("ap",   s.get("AP",   ""))
    out.setdefault("m",    s.get("M",    ""))
    out.setdefault("viol", s.get("VIOL", ""))
    out.setdefault("rngd", s.get("RNGD", ""))
    out.setdefault("hp",   s.get("HP",   ""))
    return out

def _adapt_equipment(d: dict) -> dict:
    """Derive armour_tag = 'Armour 1'|'Armour 2'|... so {{ARMOUR_TAG}} resolves."""
    out = dict(d)
    a = d.get("armour")
    if isinstance(a, int) and a > 0:
        out["armour_tag"] = f"Armour {a}"
    else:
        out["armour_tag"] = ""
    return out

def adapt_row(template_name: str, d: dict) -> dict:
    if template_name in ("profile", "sellsword", "leader", "minion"):
        return _adapt_profile(d)
    if template_name == "equipment":
        return _adapt_equipment(d)
    return d


# ---------- splotch generation ----------
# Mirror of build.py's _render_splotches so the editor's preview shows the
# same splatter the PDF will. Keep in sync with build.py.

_SPLOTCH_IMAGES = [
    "img-010-013-rgba.png",
    "img-010-015-rgba.png",
    "img-011-017-rgba.png",
    "img-011-019-rgba.png",
    "img-020-033-rgba.png",
    "img-021-037-rgba.png",
    "img-046-077-rgba.png",
    "img-066-106-rgba.png",
]

def compute_splotches(seed: str, count: int = 5) -> list[dict]:
    """Random splotch placements seeded by the card name (so the same name
    always yields the same splatter). Identical algorithm to build.py."""
    from build import CARD_W_TRIM, CARD_H_TRIM
    rng = random.Random(seed)
    items = []
    for _ in range(count):
        img = rng.choice(_SPLOTCH_IMAGES)
        size = rng.uniform(35, 65)
        x = rng.uniform(-15, CARD_W_TRIM - size + 15)
        y = rng.uniform(-15, CARD_H_TRIM - size + 15)
        rot = rng.uniform(0, 360)
        op = rng.uniform(0.12, 0.22)
        cx, cy = x + size / 2, y + size / 2
        items.append({
            "rel": f"alpha/{img}",
            "url": f"/api/image/alpha/{img}",
            "file_uri": f"file:///home/luismars/necropolis-images/alpha/{img}",
            "x": round(x, 2),
            "y": round(y, 2),
            "width": round(size, 2),
            "height": round(size, 2),
            "rotate": round(rot, 1),
            "cx": round(cx, 2),
            "cy": round(cy, 2),
            "opacity": round(op, 3),
        })
    return items


_BACKED_UP: set[Path] = set()

def back_up_once(path: Path) -> None:
    """Create <path>.bak.<timestamp> the first time we save this session."""
    if path in _BACKED_UP or not path.exists():
        _BACKED_UP.add(path)
        return
    ts = time.strftime("%Y%m%d-%H%M%S")
    bak = path.with_suffix(path.suffix + f".bak.{ts}")
    shutil.copy2(path, bak)
    _BACKED_UP.add(path)


def safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "", name)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter
        sys.stderr.write("[editor] " + fmt % args + "\n")

    # ---------- response helpers ----------

    def _send_bytes(self, status: int, body: bytes, content_type: str, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, obj):
        self._send_bytes(status, json.dumps(obj).encode("utf-8"),
                         "application/json; charset=utf-8")

    def _send_text(self, status: int, text: str, content_type: str = "text/plain; charset=utf-8"):
        self._send_bytes(status, text.encode("utf-8"), content_type)

    def _send_error(self, status: int, msg: str):
        self._send_json(status, {"error": msg})

    # ---------- file lookups ----------

    def _find_image(self, rel: str) -> Path | None:
        rel = unquote(rel).lstrip("/")
        p = (IMG_DIR / rel).resolve()
        try:
            p.relative_to(IMG_DIR.resolve())
        except ValueError:
            return None
        return p if p.exists() and p.is_file() else None

    def _find_font(self, name: str) -> Path | None:
        name = unquote(name).lower()
        for base in FONT_DIRS:
            if not base.exists():
                continue
            for p in base.rglob("*"):
                if p.is_file() and p.name.lower() == name:
                    return p
        return None

    # ---------- request routing ----------

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path

        if path == "/" or path == "/index.html":
            html = (EDITOR_DIR / "index.html").read_bytes()
            return self._send_bytes(200, html, "text/html; charset=utf-8")

        if path == "/api/templates":
            files = sorted(p.stem for p in TPL_DIR.glob("*.svg"))
            return self._send_json(200, {"templates": files})

        if path == "/api/splotches":
            params = parse_qs(url.query)
            seed = params.get("seed", ["default"])[0]
            count = max(0, min(20, int(params.get("count", ["5"])[0])))
            return self._send_json(200, {"items": compute_splotches(seed, count)})

        if path == "/api/categories":
            # Grouped category tree with row counts. Editor uses this to
            # render the left-side navigation.
            raw = yaml.safe_load((DATA_DIR / "_categories.yaml").read_text(encoding="utf-8")) if (DATA_DIR / "_categories.yaml").exists() else {"groups": []}
            groups = raw.get("groups") or []
            for g in groups:
                for it in (g.get("items") or []):
                    if it.get("data"):
                        p = DATA_DIR / it["data"]
                        try:
                            rows = yaml.safe_load(p.read_text(encoding="utf-8")) or [] if p.exists() else []
                            it["row_count"] = len(rows) if isinstance(rows, list) else 1
                        except Exception:
                            it["row_count"] = 0
                    else:
                        it["row_count"] = None
            return self._send_json(200, {"groups": groups})

        m = re.match(r"^/api/template/([^/]+)$", path)
        if m:
            name = safe_name(m.group(1))
            # First try category lookup; fall back to direct template filename.
            cat = category_by_key(name)
            tpl_name = (cat["template"] if cat else name)
            tpl = TPL_DIR / f"{tpl_name}.svg"
            if not tpl.exists():
                return self._send_error(404, f"no such template: {tpl_name}")
            return self._send_text(200, tpl.read_text(encoding="utf-8"), "image/svg+xml; charset=utf-8")

        m = re.match(r"^/api/data/([^/]+)$", path)
        if m:
            name = safe_name(m.group(1))
            # Prefer the category mapping: category's `data` field decides the
            # file. Falls back to "{name}s.yaml" / "{name}.yaml" so old URLs
            # still resolve while migration is in progress.
            cat = category_by_key(name)
            if cat:
                if not cat.get("data"):
                    return self._send_json(200, {"rows": [], "source": None})
                data_path = DATA_DIR / cat["data"]
                if not data_path.exists():
                    return self._send_json(200, {"rows": [], "source": None})
            else:
                data_path = data_file_for(name)
                if not data_path:
                    return self._send_json(200, {"rows": [], "source": None})
            rows = yaml.safe_load(data_path.read_text(encoding="utf-8")) or []
            if not isinstance(rows, list):
                rows = [rows]
            # Apply the same row-shaping the PDF build does, so the editor's
            # preview sees {{ARMOUR_TAG}}, {{AP}} etc. resolved.
            tpl_name = (cat["template"] if cat else None)
            if tpl_name:
                rows = [adapt_row(tpl_name, r) for r in rows]
            # Inject category-level fields (e.g. `header`) so templates can
            # show different banner text per category while sharing one SVG.
            if cat:
                inject = {k: v for k, v in cat.items()
                          if k in ("header", "title", "group") and v is not None}
                for k, v in inject.items():
                    for r in rows:
                        r.setdefault(k, v)
            try:
                rel = str(data_path.relative_to(DATA_DIR.parent))
            except ValueError:
                rel = str(data_path)
            return self._send_json(200, {"rows": rows, "source": rel})

        m = re.match(r"^/api/image/(.+)$", path)
        if m:
            p = self._find_image(m.group(1))
            if not p:
                return self._send_error(404, "image not found")
            ctype, _ = mimetypes.guess_type(str(p))
            return self._send_bytes(200, p.read_bytes(), ctype or "application/octet-stream",
                                    {"Cache-Control": "max-age=300"})

        if path == "/api/images":
            # List every image in IMG_DIR (recursive). Used by the editor's
            # image-library picker. We keep this simple — the directory has
            # ~150 files so we can ship them all at once.
            exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}
            items = []
            base = IMG_DIR.resolve()
            if base.exists():
                for p in sorted(base.rglob("*")):
                    if not p.is_file() or p.suffix.lower() not in exts:
                        continue
                    try:
                        rel = p.relative_to(base).as_posix()
                    except ValueError:
                        continue
                    st = p.stat()
                    items.append({
                        "rel": rel,
                        "name": p.name,
                        "dir": str(p.parent.relative_to(base).as_posix()) or ".",
                        "size": st.st_size,
                        "mtime": int(st.st_mtime),
                        "file_uri": f"file://{p}",
                        "url": f"/api/image/{rel}",
                    })
            return self._send_json(200, {"images": items, "base": str(base)})

        m = re.match(r"^/fonts/(.+)$", path)
        if m:
            p = self._find_font(m.group(1))
            if not p:
                return self._send_error(404, "font not found")
            ctype, _ = mimetypes.guess_type(str(p))
            return self._send_bytes(200, p.read_bytes(),
                                    ctype or "font/ttf",
                                    {"Cache-Control": "max-age=3600"})

        if path == "/api/font-list":
            # List system fonts grouped by family for the font picker.
            families = set()
            for base in FONT_DIRS:
                if not base.exists():
                    continue
                for p in base.rglob("*"):
                    if p.suffix.lower() in {".ttf", ".otf", ".woff", ".woff2"}:
                        families.add(p.stem.split("-")[0])
            return self._send_json(200, {"families": sorted(families)})

        return self._send_error(404, f"no route for {path}")

    def do_PUT(self):
        url = urlparse(self.path)
        path = url.path
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length)

        m = re.match(r"^/api/template/([^/]+)$", path)
        if m:
            name = safe_name(m.group(1))
            cat = category_by_key(name)
            tpl_name = (cat["template"] if cat else name)
            tpl = TPL_DIR / f"{tpl_name}.svg"
            if not tpl.parent.exists():
                return self._send_error(500, "templates dir missing")
            try:
                text = body.decode("utf-8")
            except UnicodeDecodeError:
                return self._send_error(400, "body must be utf-8")
            if "<svg" not in text:
                return self._send_error(400, "body doesn't look like SVG")
            back_up_once(tpl)
            tpl.write_text(text, encoding="utf-8")
            try:
                rel = str(tpl.relative_to(TPL_DIR.parent))
            except ValueError:
                rel = str(tpl)
            return self._send_json(200, {"ok": True, "path": rel})

        return self._send_error(404, f"no route for {path}")

    def do_POST(self):
        url = urlparse(self.path)
        path = url.path

        if path == "/api/upload-image":
            length = int(self.headers.get("Content-Length", "0") or 0)
            filename = safe_name(self.headers.get("X-Filename") or f"upload-{int(time.time())}.png")
            body = self.rfile.read(length)
            uploads = IMG_DIR / "uploads"
            uploads.mkdir(parents=True, exist_ok=True)
            out = uploads / filename
            # ensure unique
            i = 1
            while out.exists():
                out = uploads / f"{out.stem}-{i}{out.suffix}"
                i += 1
            out.write_bytes(body)
            rel = out.relative_to(IMG_DIR).as_posix()
            return self._send_json(200, {
                "ok": True,
                "rel": rel,
                "file_uri": f"file://{out}",
                "url": f"/api/image/{rel}",
            })

        return self._send_error(404, f"no route for {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    if not TPL_DIR.exists():
        sys.exit(f"templates dir not found: {TPL_DIR}")

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[editor] serving http://{args.host}:{args.port}/  (templates: {TPL_DIR})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[editor] stopped")


if __name__ == "__main__":
    main()
