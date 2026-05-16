"""Unit tests for the SVG editor server.

Run from necropolis-cards/:

    python3 -m unittest editor.test_server -v

Tests use a temporary repo layout and run the server on a random port.
No state of the real `templates/` or `data/` dirs is touched.
"""
from __future__ import annotations

import importlib
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from http.server import ThreadingHTTPServer

THIS_DIR = Path(__file__).resolve().parent
ROOT = THIS_DIR.parent
sys.path.insert(0, str(THIS_DIR))


# ---------- helpers ----------------------------------------------------------

def free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def http(method: str, url: str, body: bytes | None = None,
         headers: dict | None = None) -> tuple[int, bytes, dict]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        r = urllib.request.urlopen(req, timeout=5)
        return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers or {})


# ---------- unit tests on helpers --------------------------------------------

class PureHelpersTest(unittest.TestCase):
    """Tests of small pure helpers in server.py — no HTTP needed."""

    @classmethod
    def setUpClass(cls):
        # Make a temp tree shaped like necropolis-cards
        cls.tmp = Path(tempfile.mkdtemp(prefix="editor-test-"))
        (cls.tmp / "templates").mkdir()
        (cls.tmp / "data").mkdir()
        cls.imgs = cls.tmp / "imgs"
        cls.imgs.mkdir()
        (cls.imgs / "ok.png").write_bytes(b"\x89PNG\r\n")
        (cls.imgs / "alpha").mkdir()
        (cls.imgs / "alpha" / "x.png").write_bytes(b"\x89PNG\r\n")

        # Stub yaml so we don't need PyYAML for these tests (we will import it
        # only for the live-server tests below). For unit-only tests just
        # exercise the helpers.
        cls.fake_fonts = cls.tmp / "fonts"
        cls.fake_fonts.mkdir()
        (cls.fake_fonts / "JBLACK.TTF").write_bytes(b"FAKE-TTF")
        (cls.fake_fonts / "Alegreya-VF.ttf").write_bytes(b"FAKE-VF")

        # Reload the server module with the temp paths injected.
        os.environ["NECROPOLIS_EDITOR_ROOT"] = str(cls.tmp)
        # Force a clean import each class
        if "server" in sys.modules:
            del sys.modules["server"]
        cls.server = importlib.import_module("server")
        cls.server.TPL_DIR = cls.tmp / "templates"
        cls.server.DATA_DIR = cls.tmp / "data"
        cls.server.IMG_DIR = cls.imgs
        cls.server.FONT_DIRS = [cls.fake_fonts]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # safe_name
    def test_safe_name_strips_traversal_and_specials(self):
        self.assertEqual(self.server.safe_name("weapon"), "weapon")
        self.assertEqual(self.server.safe_name("../etc/passwd"), "..etcpasswd")
        # Only [A-Za-z0-9._-] survive; the function strips spaces and ';'
        # but keeps the bare letters from the rest of the input.
        self.assertEqual(self.server.safe_name("foo bar; rm -rf"), "foobarrm-rf")
        self.assertEqual(self.server.safe_name("a/b/c.svg"), "abc.svg")

    # data_file_for plurals
    def test_data_file_for_picks_plural_form(self):
        (self.tmp / "data" / "weapons.yaml").write_text("- name: A\n")
        self.assertEqual(
            self.server.data_file_for("weapon"),
            self.tmp / "data" / "weapons.yaml",
        )

    def test_data_file_for_picks_singular_when_no_plural(self):
        (self.tmp / "data" / "rule.yaml").write_text("- name: R\n")
        self.assertEqual(
            self.server.data_file_for("rule"),
            self.tmp / "data" / "rule.yaml",
        )

    def test_data_file_for_returns_none_for_blanks(self):
        self.assertIsNone(self.server.data_file_for("leader-blank"))
        self.assertIsNone(self.server.data_file_for("zzz-unknown"))

    def test_data_file_for_strips_svg_suffix(self):
        (self.tmp / "data" / "spells.yaml").write_text("- name: S\n")
        self.assertEqual(
            self.server.data_file_for("spell.svg"),
            self.tmp / "data" / "spells.yaml",
        )

    # _find_image traversal guard
    def test_find_image_ok(self):
        h = self.server.Handler.__new__(self.server.Handler)
        self.assertEqual(h._find_image("ok.png"), self.imgs / "ok.png")
        self.assertEqual(h._find_image("alpha/x.png"), self.imgs / "alpha/x.png")

    def test_find_image_blocks_parent_escape(self):
        h = self.server.Handler.__new__(self.server.Handler)
        self.assertIsNone(h._find_image("../etc/passwd"))
        self.assertIsNone(h._find_image("alpha/../../../etc/passwd"))

    def test_find_image_missing(self):
        h = self.server.Handler.__new__(self.server.Handler)
        self.assertIsNone(h._find_image("nope.png"))

    # _find_font case-insensitive
    def test_find_font_case_insensitive(self):
        h = self.server.Handler.__new__(self.server.Handler)
        self.assertEqual(h._find_font("jblack.ttf"), self.fake_fonts / "JBLACK.TTF")
        self.assertEqual(h._find_font("JBLACK.TTF"), self.fake_fonts / "JBLACK.TTF")
        self.assertEqual(h._find_font("alegreya-vf.ttf"),
                         self.fake_fonts / "Alegreya-VF.ttf")

    def test_find_font_missing(self):
        h = self.server.Handler.__new__(self.server.Handler)
        self.assertIsNone(h._find_font("nope.ttf"))


# ---------- end-to-end tests on a live server --------------------------------

class LiveServerTest(unittest.TestCase):
    """Spin up the real server bound to a random port, hit it with HTTP."""

    @classmethod
    def setUpClass(cls):
        try:
            import yaml  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("PyYAML not available; skipping live tests")

        cls.tmp = Path(tempfile.mkdtemp(prefix="editor-live-"))
        (cls.tmp / "templates").mkdir()
        (cls.tmp / "data").mkdir()
        cls.imgs = cls.tmp / "imgs"
        cls.imgs.mkdir()
        cls.fonts = cls.tmp / "fonts"
        cls.fonts.mkdir()

        # Fixture content
        (cls.tmp / "templates" / "weapon.svg").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
            '<text x="1" y="1">{{NAME}}</text></svg>\n'
        )
        (cls.tmp / "templates" / "leader-blank.svg").write_text(
            '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'
        )
        (cls.tmp / "data" / "weapons.yaml").write_text(
            "- name: Sword\n  cost: 10\n- name: Mace\n  cost: 15\n"
        )
        (cls.imgs / "thing.png").write_bytes(b"\x89PNG\r\nfake")
        (cls.fonts / "JBLACK.TTF").write_bytes(b"FAKE-FONT-1")
        (cls.fonts / "AlegreyaSC-Regular.ttf").write_bytes(b"FAKE-FONT-2")

        if "server" in sys.modules:
            del sys.modules["server"]
        cls.server_mod = importlib.import_module("server")
        cls.server_mod.TPL_DIR = cls.tmp / "templates"
        cls.server_mod.DATA_DIR = cls.tmp / "data"
        cls.server_mod.IMG_DIR = cls.imgs
        cls.server_mod.FONT_DIRS = [cls.fonts]
        cls.server_mod._BACKED_UP.clear()

        cls.port = free_port()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", cls.port), cls.server_mod.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}"
        # tiny wait for socket
        for _ in range(20):
            try:
                http("GET", cls.base + "/api/templates")
                break
            except Exception:
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # --- index ---
    def test_index_html_served(self):
        # Need a real index.html — copy ours into the editor dir
        # (the server reads from EDITOR_DIR which still points to the real one)
        status, body, _ = http("GET", self.base + "/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>Necropolis Card Editor</title>", body)

    # --- templates list ---
    def test_templates_list(self):
        status, body, headers = http("GET", self.base + "/api/templates")
        self.assertEqual(status, 200)
        self.assertIn("json", headers.get("Content-Type", ""))
        names = json.loads(body)["templates"]
        self.assertEqual(sorted(names), ["leader-blank", "weapon"])

    # --- get template ---
    def test_get_template_ok(self):
        status, body, headers = http("GET", self.base + "/api/template/weapon")
        self.assertEqual(status, 200)
        self.assertIn("svg", headers.get("Content-Type", ""))
        self.assertIn(b"{{NAME}}", body)

    def test_get_template_404(self):
        status, body, _ = http("GET", self.base + "/api/template/nope")
        self.assertEqual(status, 404)
        self.assertIn("no such template", json.loads(body)["error"])

    def test_get_template_traversal_blocked(self):
        # safe_name strips slashes/dots, so this lands as "etcpasswd" -> 404
        status, _, _ = http("GET", self.base + "/api/template/..%2Fetc%2Fpasswd")
        self.assertEqual(status, 404)

    # --- data ---
    def test_get_data_weapons(self):
        status, body, _ = http("GET", self.base + "/api/data/weapon")
        self.assertEqual(status, 200)
        j = json.loads(body)
        self.assertEqual(len(j["rows"]), 2)
        self.assertEqual(j["rows"][0]["name"], "Sword")
        self.assertTrue(j["source"].endswith("weapons.yaml"))

    def test_get_data_unknown_returns_empty(self):
        status, body, _ = http("GET", self.base + "/api/data/leader-blank")
        self.assertEqual(status, 200)
        j = json.loads(body)
        self.assertEqual(j["rows"], [])
        self.assertIsNone(j["source"])

    # --- images ---
    def test_get_image_ok(self):
        status, body, _ = http("GET", self.base + "/api/image/thing.png")
        self.assertEqual(status, 200)
        self.assertEqual(body[:4], b"\x89PNG")

    def test_get_image_traversal_blocked(self):
        status, _, _ = http("GET", self.base + "/api/image/../etc/passwd")
        self.assertEqual(status, 404)

    def test_get_image_missing(self):
        status, _, _ = http("GET", self.base + "/api/image/nothere.png")
        self.assertEqual(status, 404)

    # --- fonts ---
    def test_get_font_case_insensitive(self):
        status, body, _ = http("GET", self.base + "/fonts/jblack.ttf")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"FAKE-FONT-1")

    def test_get_font_missing(self):
        status, _, _ = http("GET", self.base + "/fonts/nope.ttf")
        self.assertEqual(status, 404)

    # --- PUT template (write-back) ---
    def test_put_template_writes_and_backs_up(self):
        new_svg = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><text x="2" y="2">{{NAME}}</text></svg>'
        status, body, _ = http("PUT", self.base + "/api/template/weapon", body=new_svg,
                               headers={"Content-Type": "image/svg+xml"})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ok"])
        # original now overwritten
        self.assertEqual(
            (self.tmp / "templates" / "weapon.svg").read_bytes(),
            new_svg,
        )
        # backup created
        baks = list((self.tmp / "templates").glob("weapon.svg.bak.*"))
        self.assertEqual(len(baks), 1, f"expected one .bak file, found {baks}")
        # second save should NOT make a new backup (one per session)
        status2, _, _ = http("PUT", self.base + "/api/template/weapon", body=new_svg,
                             headers={"Content-Type": "image/svg+xml"})
        self.assertEqual(status2, 200)
        baks2 = list((self.tmp / "templates").glob("weapon.svg.bak.*"))
        self.assertEqual(len(baks2), 1)

    def test_put_template_rejects_non_svg_body(self):
        status, body, _ = http("PUT", self.base + "/api/template/leader-blank",
                               body=b"hello not svg",
                               headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 400)
        self.assertIn("svg", json.loads(body)["error"].lower())

    # --- POST upload-image ---
    def test_post_upload_image(self):
        png = b"\x89PNG\r\n\x1a\nfake-pixels"
        status, body, _ = http("POST", self.base + "/api/upload-image",
                               body=png,
                               headers={"X-Filename": "tester.png",
                                        "Content-Type": "application/octet-stream"})
        self.assertEqual(status, 200)
        info = json.loads(body)
        self.assertTrue(info["ok"])
        self.assertTrue(info["rel"].startswith("uploads/"))
        self.assertTrue(info["file_uri"].startswith("file://"))
        # file actually written
        out = self.imgs / info["rel"]
        self.assertTrue(out.exists())
        self.assertEqual(out.read_bytes(), png)
        # second upload of same name gets a unique suffix
        status2, body2, _ = http("POST", self.base + "/api/upload-image",
                                 body=png,
                                 headers={"X-Filename": "tester.png"})
        self.assertEqual(status2, 200)
        info2 = json.loads(body2)
        self.assertNotEqual(info["rel"], info2["rel"])

    # --- categories index ---
    def test_get_categories_parses_index_yaml(self):
        # Write a minimal _categories.yaml into the fixture tree
        (self.tmp / "data" / "_categories.yaml").write_text(
            "groups:\n"
            "  - title: Reference Guide\n"
            "    items:\n"
            "      - { key: melee-weapons, title: Melee Weapons, template: weapon, data: weapons.yaml }\n"
            "      - { key: leaders, title: Leaders, template: leader-blank, data: null }\n"
        )
        try:
            status, body, _ = http("GET", self.base + "/api/categories")
            self.assertEqual(status, 200)
            j = json.loads(body)
            self.assertEqual(len(j["groups"]), 1)
            g = j["groups"][0]
            self.assertEqual(g["title"], "Reference Guide")
            self.assertEqual(g["items"][0]["key"], "melee-weapons")
            self.assertEqual(g["items"][0]["row_count"], 2)   # from weapons.yaml in setUpClass
            self.assertIsNone(g["items"][1]["row_count"])     # blank template
        finally:
            (self.tmp / "data" / "_categories.yaml").unlink(missing_ok=True)

    def test_template_resolves_via_category(self):
        # If a category lookup names a different template, /api/template/<key>
        # should serve THAT template, not <key>.svg.
        (self.tmp / "data" / "_categories.yaml").write_text(
            "groups:\n"
            "  - title: x\n"
            "    items:\n"
            "      - { key: melee-weapons, title: M, template: weapon, data: weapons.yaml }\n"
        )
        try:
            status, body, _ = http("GET", self.base + "/api/template/melee-weapons")
            self.assertEqual(status, 200)
            self.assertIn(b"{{NAME}}", body)  # weapon.svg fixture content
        finally:
            (self.tmp / "data" / "_categories.yaml").unlink(missing_ok=True)

    def test_data_resolves_via_category(self):
        (self.tmp / "data" / "_categories.yaml").write_text(
            "groups:\n"
            "  - title: x\n"
            "    items:\n"
            "      - { key: melee-weapons, title: M, template: weapon, data: weapons.yaml }\n"
        )
        try:
            status, body, _ = http("GET", self.base + "/api/data/melee-weapons")
            self.assertEqual(status, 200)
            j = json.loads(body)
            self.assertEqual(len(j["rows"]), 2)
            self.assertTrue(j["source"].endswith("weapons.yaml"))
        finally:
            (self.tmp / "data" / "_categories.yaml").unlink(missing_ok=True)

    def test_data_applies_equipment_adapter(self):
        """Server should derive ARMOUR_TAG ('Armour 1' / 'Armour 2' / '') from
        the integer `armour` field so the editor's {{ARMOUR_TAG}} placeholder
        resolves the same way the PDF build does."""
        (self.tmp / "data" / "_categories.yaml").write_text(
            "groups:\n"
            "  - title: x\n"
            "    items:\n"
            "      - { key: armours, title: A, template: equipment, data: armours.yaml }\n"
        )
        (self.tmp / "data" / "armours.yaml").write_text(
            "- name: Light Armour\n  armour: 1\n"
            "- name: Heavy Armour\n  armour: 2\n"
            "- name: Trinket\n  armour: '—'\n"
        )
        try:
            status, body, _ = http("GET", self.base + "/api/data/armours")
            self.assertEqual(status, 200)
            rows = json.loads(body)["rows"]
            self.assertEqual(rows[0]["armour_tag"], "Armour 1")
            self.assertEqual(rows[1]["armour_tag"], "Armour 2")
            self.assertEqual(rows[2]["armour_tag"], "")
        finally:
            (self.tmp / "data" / "_categories.yaml").unlink(missing_ok=True)
            (self.tmp / "data" / "armours.yaml").unlink(missing_ok=True)

    def test_data_injects_category_header(self):
        """Categories with a `header:` field inject it into every row so the
        shared template (e.g. weapon.svg) can show different banner text per
        category via {{HEADER}}."""
        (self.tmp / "data" / "_categories.yaml").write_text(
            "groups:\n"
            "  - title: x\n"
            "    items:\n"
            "      - { key: melee-weapons, title: M, template: weapon, data: weapons.yaml, header: Weapon }\n"
            "      - { key: colossal-weapons, title: C, template: weapon, data: weapons.yaml, header: Colossal Weapon }\n"
        )
        try:
            status, body, _ = http("GET", self.base + "/api/data/melee-weapons")
            self.assertEqual(status, 200)
            for r in json.loads(body)["rows"]:
                self.assertEqual(r.get("header"), "Weapon")
            status, body, _ = http("GET", self.base + "/api/data/colossal-weapons")
            for r in json.loads(body)["rows"]:
                self.assertEqual(r.get("header"), "Colossal Weapon")
        finally:
            (self.tmp / "data" / "_categories.yaml").unlink(missing_ok=True)

    def test_data_applies_profile_adapter(self):
        """Leader/Minion/Sellsword/Profile templates expect AP/M/VIOL/RNGD/HP
        as top-level fields, but the YAML nests them under `stats:`. The
        server must flatten."""
        (self.tmp / "data" / "_categories.yaml").write_text(
            "groups:\n"
            "  - title: x\n"
            "    items:\n"
            "      - { key: leaders, title: L, template: leader, data: leaders.yaml }\n"
        )
        (self.tmp / "data" / "leaders.yaml").write_text(
            "- name: Lich\n  stats: { AP: 2, M: 3, VIOL: 7+, RNGD: 7+, HP: 15 }\n"
        )
        try:
            status, body, _ = http("GET", self.base + "/api/data/leaders")
            self.assertEqual(status, 200)
            rows = json.loads(body)["rows"]
            self.assertEqual(rows[0]["ap"], 2)
            self.assertEqual(rows[0]["m"], 3)
            self.assertEqual(rows[0]["viol"], "7+")
            self.assertEqual(rows[0]["rngd"], "7+")
            self.assertEqual(rows[0]["hp"], 15)
        finally:
            (self.tmp / "data" / "_categories.yaml").unlink(missing_ok=True)
            (self.tmp / "data" / "leaders.yaml").unlink(missing_ok=True)

    # --- splotches ---
    def test_get_splotches_returns_seeded_items(self):
        """/api/splotches?seed=X should return a deterministic list of N
        splotch descriptors. Same seed → same output (mirrors build.py)."""
        status1, body1, _ = http("GET", self.base + "/api/splotches?seed=Lich&count=5")
        status2, body2, _ = http("GET", self.base + "/api/splotches?seed=Lich&count=5")
        self.assertEqual(status1, 200)
        self.assertEqual(body1, body2)  # deterministic
        items = json.loads(body1)["items"]
        self.assertEqual(len(items), 5)
        for it in items:
            for k in ("rel", "url", "file_uri", "x", "y", "width", "height",
                      "rotate", "cx", "cy", "opacity"):
                self.assertIn(k, it)
            self.assertTrue(it["url"].startswith("/api/image/alpha/"))
            self.assertTrue(it["file_uri"].startswith("file://"))

    def test_get_splotches_different_seeds_differ(self):
        _, a, _ = http("GET", self.base + "/api/splotches?seed=Lich")
        _, b, _ = http("GET", self.base + "/api/splotches?seed=Revenant")
        self.assertNotEqual(a, b)

    def test_get_splotches_count_clamped(self):
        _, body, _ = http("GET", self.base + "/api/splotches?count=999")
        self.assertLessEqual(len(json.loads(body)["items"]), 20)

    # --- image library listing ---
    def test_get_images_lists_recursively(self):
        # Add a subdir to verify recursion
        (self.imgs / "alpha").mkdir(exist_ok=True)
        (self.imgs / "alpha" / "stuff.jpg").write_bytes(b"jpegbytes")
        (self.imgs / "ignore.txt").write_bytes(b"not an image")
        status, body, _ = http("GET", self.base + "/api/images")
        self.assertEqual(status, 200)
        j = json.loads(body)
        rels = sorted(item["rel"] for item in j["images"])
        # 'thing.png' comes from setUpClass, plus our two new files
        self.assertIn("thing.png", rels)
        self.assertIn("alpha/stuff.jpg", rels)
        self.assertNotIn("ignore.txt", rels)
        # Each item has the expected shape
        first = j["images"][0]
        for key in ("rel", "name", "dir", "size", "mtime", "file_uri", "url"):
            self.assertIn(key, first)
        self.assertTrue(first["file_uri"].startswith("file://"))
        self.assertTrue(first["url"].startswith("/api/image/"))

    # --- 404 ---
    def test_unknown_route_returns_404(self):
        status, _, _ = http("GET", self.base + "/api/whatever")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main(verbosity=2)
