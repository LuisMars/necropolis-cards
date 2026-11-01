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
      budget: 300, limit: 350, hands: 3, stat: "hp", affinity: "plasm", needs: ["Blood"], types: ["leaders/lich"], kind: "minor", treasury: -10 } };
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

test("counts of 1 take the singular", () => {
  const w = (code, params) => ({ code, item: "spells/summon", params });
  assert.match(describe(w("too-many-treasures", { count: 1, max: 0, kind: "minor" }), catalog, "en"), /^1 minor treasure; /);
  assert.match(describe(w("too-many-treasures", { count: 1, max: 0, kind: "greater" }), catalog, "es"), /^1 tesoro mayor; /);
  assert.match(describe(w("too-many-treasures", { count: 2, max: 1, kind: "minor" }), catalog, "es"), /^2 tesoros menores; /);
  assert.match(describe(w("too-many-weapons", { count: 1, max: 0 }), catalog, "en"), /^1 weapon; /);
  assert.match(describe(w("too-many-ambitions", { count: 1 }), catalog, "es"), /^1 ambición activa/);
  assert.match(describe(w("too-many-sellswords", { count: 1 }), catalog, "en"), /^1 sellsword fielded/);
  assert.match(describe(w("too-many-traits", { count: 1, max: 0 }), catalog, "es"), /^1 rasgo; /);
});
