import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KEYS, LS } from "../web/js/sync/keys.js";

const WEB = fileURLToPath(new URL("../web", import.meta.url));
const SYNC_ITEMS = ["gatherings", "printed", "queue", "warband", "prefs"];

function sources(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "icons" || f === "fonts" || f === "images" || f === "templates" ? [] : sources(p);
    return /\.(js|html)$/.test(f) && f !== "lucide.js" ? [p] : [];
  });
}

test("every storage key the app uses is either synced or explicitly excluded", () => {
  const found = new Map();
  for (const file of sources(WEB)) {
    if (file.endsWith("sync/keys.js")) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/["'`](necropolis-[a-z0-9]+(?:-[a-z0-9]+)*-v\d+)["'`]/g)) found.set(m[1], file);
  }
  assert.ok(found.size >= 3, `scan found ${found.size} keys`);
  for (const [key, file] of found) {
    assert.ok(key in KEYS, `${key} (in ${file}) is neither synced nor excluded: classify it in web/js/sync/keys.js`);
  }
  // And the table is honest: synced keys name a real sync item, excluded ones say why.
  for (const [key, v] of Object.entries(KEYS)) {
    if (v.sync) assert.ok(SYNC_ITEMS.includes(v.sync), `${key}: unknown sync item ${v.sync}`);
    else assert.ok(v.note, `${key}: an excluded key needs a reason`);
  }
  for (const key of Object.values(LS)) assert.ok(key in KEYS, `${key} missing from KEYS`);
});

test("localStorage is only touched through known keys (no dynamic key names)", () => {
  for (const file of sources(WEB)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?:localStorage|storage)\.(?:get|set|remove)Item\(\s*([^,)]+)/g)) {
      const arg = m[1].trim();
      assert.ok(/^(LS_[A-Z]+|LS\.[a-zA-Z]+|KEY|DRAFTS_KEY|LS_KEY|["'][^"']+["']|k|key|"x")$/.test(arg), `${file}: unexpected key expression ${arg}`);
    }
  }
});
