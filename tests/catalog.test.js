import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, bundle, APP_IDS } from "./helpers.js";
import { slug, matches } from "../web/js/builder/catalog.js";

test("every Companion App ID maps to exactly one row", () => {
  for (const id of APP_IDS) {
    const owners = [...catalog.rows.values()].filter(r => r.row.app_id === id)
      .concat((bundle.builder.covenants || []).filter(c => c.app_id === id && !catalog.rows.get(c.key)?.row.app_id));
    assert.equal(owners.length, 1, `${id} is on ${owners.length} rows`);
    assert.ok(catalog.byApp.get(id), `${id} has no key`);
  }
});

test("no row carries an app_id the app doesn't define", () => {
  for (const { key, row } of catalog.rows.values()) {
    if (row.app_id) assert.ok(APP_IDS.includes(row.app_id), `${key}: ${row.app_id}`);
  }
});

test("keys are unique within the bundle", () => {
  let n = 0;
  for (const cat of Object.values(bundle.categories)) n += cat.rows.length;
  // + the Wretched Undead covenant, which has no card row
  assert.equal(catalog.rows.size, n + 1);
});

test("every key the builder rules reference exists", () => {
  const refs = [];
  const rules = bundle.builder;
  for (const c of rules.covenants) refs.push(c.leader_trait, c.trait, ...(c.leader_types || []));
  for (const group of [rules.leaders, rules.minions]) {
    for (const [key, r] of Object.entries(group)) {
      refs.push(key, ...(r.weapons_only || []), ...(r.forbid || []), ...(r.except || []));
      for (const m of Object.values(r.affinity_mods || {})) refs.push(...(m.forbid || []));
    }
  }
  for (const m of Object.values(rules.leader_affinity_mods)) refs.push(...(m.forbid || []));
  for (const ref of refs.filter(Boolean)) {
    if (ref.endsWith("/*")) {
      assert.ok(bundle.categories[ref.slice(0, -2)], `no category for ${ref}`);
    } else if (!ref.startsWith("hands:")) {
      assert.ok(catalog.row(ref), `no row for ${ref}`);
    }
  }
});

test("slug and selectors", () => {
  assert.equal(slug("Throwing Axe or Mallet"), "throwing-axe-or-mallet");
  assert.equal(slug("Laberinto de Sepulcros"), "laberinto-de-sepulcros");
  assert.ok(matches(catalog, "armours/shield", "armours/*"));
  assert.ok(matches(catalog, "melee-weapons/great-weapon", "hands:2"));
  assert.ok(!matches(catalog, "melee-weapons/blade", "hands:2"));
});
