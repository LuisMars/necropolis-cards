import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalog } from "./helpers.js";
import { describe, label } from "../web/js/builder/messages.js";

test("every warning rules.js can report has a message in both languages", () => {
  const src = readFileSync(new URL("../web/js/builder/rules.js", import.meta.url), "utf8");
  const codes = [...new Set([...src.matchAll(/warn\("([a-z-]+)"/g)].map(m => m[1]))];
  assert.ok(codes.length > 20, `found ${codes.length} codes`);
  for (const code of codes) {
    const w = { code, item: "spells/summon", params: { count: 2, max: 1, allowed: 1, total: 400,
      budget: 300, limit: 350, hands: 3, stat: "hp", affinity: "plasm", needs: ["Blood"], types: ["leaders/lich"] } };
    for (const lang of ["en", "es"]) {
      const text = describe(w, catalog, lang);
      assert.notEqual(text, code, `${code} has no ${lang} message`);
      assert.ok(!/undefined|\$\{/.test(text), `${code} (${lang}): ${text}`);
    }
  }
});

test("item names follow the card language", () => {
  const w = { code: "forbidden-item", item: "armours/heavy-armour" };
  assert.match(describe(w, catalog, "en"), /Heavy Armour/);
  assert.match(describe(w, catalog, "es"), /Armadura Pesada/);
  assert.equal(label("spells", "es"), "Hechizos");
});
