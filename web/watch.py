#!/usr/bin/env python3
"""Dev watcher: re-run web/bundle.py whenever card sources change.

Polls templates/ and data/ for mtime changes (no external deps) and
rebuilds web/data.json + web/templates/ so a browser pointed at the
static server picks up edits on the next refresh.

Run alongside:  python3 -m http.server -d web 8000
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WATCH_DIRS = [ROOT / "templates", ROOT / "data"]
BUNDLE = ROOT / "web" / "bundle.py"


def snapshot() -> dict[str, float]:
    state: dict[str, float] = {}
    for d in WATCH_DIRS:
        for p in d.rglob("*"):
            if p.is_file():
                state[str(p)] = p.stat().st_mtime
    return state


def rebuild() -> None:
    r = subprocess.run([sys.executable, str(BUNDLE)],
                       capture_output=True, text=True)
    tail = (r.stdout or r.stderr).strip().splitlines()
    msg = tail[-1] if tail else "(no output)"
    status = "ok" if r.returncode == 0 else f"FAILED ({r.returncode})"
    print(f"[watch] rebuilt: {status} — {msg}", flush=True)
    if r.returncode != 0 and r.stderr:
        print(r.stderr.strip(), flush=True)


def main() -> None:
    print(f"[watch] watching {', '.join(str(d) for d in WATCH_DIRS)}", flush=True)
    prev = snapshot()
    while True:
        time.sleep(1.0)
        cur = snapshot()
        if cur != prev:
            changed = sorted(set(cur) ^ set(prev)) or \
                [k for k in cur if prev.get(k) != cur[k]]
            name = Path(changed[0]).name if changed else "?"
            print(f"[watch] change detected ({name}) → rebuilding…", flush=True)
            rebuild()
            prev = cur


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
