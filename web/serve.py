#!/usr/bin/env python3
"""Dev static server for the card printer.

Two jobs:
  * Don't cache code/data (html/css/js/json) so template + style edits show
    on refresh — pair with web/watch.py for live bundle rebuilds.
  * DO let the browser cache images and fonts. The leader watermark alone is
    ~1.9 MB; re-downloading every asset on every refresh under HTTP/1.0
    (which closes each connection) caused ERR_CONNECTION_RESET and made big
    images intermittently fail to load. HTTP/1.1 keep-alive + cacheable
    images fixes that.

    python3 web/serve.py [port]   # default 8000
"""
from __future__ import annotations

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent

# Heavy, rarely-changing assets we DO want the browser to cache. Everything
# else (html/css/js/json/svg, and the extensionless "/" route) defaults to
# no-store so code + template edits always show on refresh.
CACHE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp",
             ".woff", ".woff2", ".ttf", ".otf"}


class DevHandler(SimpleHTTPRequestHandler):
    # Keep-alive so the browser reuses connections for the many small assets
    # (and the big watermark) instead of opening/closing one per request.
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        ext = Path(self.path.split("?", 1)[0]).suffix.lower()
        if ext in CACHE_EXT:
            # Cache artwork/fonts briefly so refreshes don't re-pull megabytes.
            self.send_header("Cache-Control", "public, max-age=300")
        else:
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter logs
        pass


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(DevHandler, directory=str(WEB_DIR))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), handler)
    print(f"serving {WEB_DIR} on 0.0.0.0:{port}  →  http://127.0.0.1:{port}/", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
