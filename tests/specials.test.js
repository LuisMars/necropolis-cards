import { test } from "node:test";
import assert from "node:assert/strict";
import { bundle, catalog, EXAMPLE_EXPORT, EXAMPLE_LINK } from "./helpers.js";
import { fromAppJson, toAppJson, profileSpecial } from "../web/js/builder/appjson.js";
import { decodeLink } from "../web/js/builder/codec.js";
import { normName } from "../web/js/matching.js";

/*
 * The Warband roster's own code (warband.js buildRoster) turns a payload's
 * `profile.special` into the lines it prints. It touches the DOM only to find
 * its containers, so a stub `document` lets it run here on the real bundle.
 */
globalThis.document ??= { getElementById: () => null };
const { state } = await import("../web/js/state.js");
const { buildRoster } = await import("../web/js/warband.js");
state.bundle = bundle;
state.index = {};
for (const [key, cat] of Object.entries(bundle.categories)) {
  for (const row of cat.rows || []) {
    const n = normName(row.name);
    if (n) (state.index[n] ||= []).push({ key, row });
  }
}

/** The special-rules lines the roster prints for each model of a payload. */
function lines(payload, lang = "en") {
  state.warband = payload;
  state.lang = lang;
  return buildRoster().members.map(m => m.special.map(s => `${s.name} | ${s.effect} | ${s.applied}`));
}

test("a gathering built from the app's import shows the same special rules as the raw import", () => {
  const { gathering } = fromAppJson(EXAMPLE_EXPORT, catalog);
  const ours = toAppJson(gathering, catalog);
  for (const lang of ["en", "es"]) {
    const raw = lines(EXAMPLE_EXPORT, lang);
    const built = lines(ours, lang);
    assert.equal(built.length, raw.length);
    raw.forEach((want, i) => {
      // The app gives the Necromantic Remnant a bare "Bone Warrior" (no
      // effect), which the roster marks applied; the rulebook (p.33) and the
      // app's own stats (Violence 9+) give a Bone Remnant nothing, so ours
      // leaves it out.
      if (EXAMPLE_EXPORT.gathering[i].profile.name === "Necromantic Remnant") {
        want = want.filter(l => !/^(Bone Warrior|Guerrero de Hueso) \|/.test(l));
      }
      assert.deepEqual(built[i], want, `${EXAMPLE_EXPORT.gathering[i].profile.name} (${lang})`);
    });
  }
  // And there is something to compare: Caster and Bone Leader on the Lich.
  assert.deepEqual(lines(ours)[0].map(l => l.split(" | ")[0]), ["Caster", "Bone Leader"]);
});

test("a gathering from a share link carries its profile special rules too", () => {
  const { gathering } = decodeLink(EXAMPLE_LINK, catalog);
  const json = toAppJson(gathering, catalog);
  assert.deepEqual(json.gathering[0].profile.special.map(s => s.name), ["Caster", "Bone Leader"]);
  assert.equal(json.gathering[3].profile.special, undefined);   // Skeletal Husk: its Bone Warrior is in its stats
});

test("affinity rules follow the chosen affinity", () => {
  const names = (key, aff) => profileSpecial(catalog, key, aff).map(s => s.name).filter(Boolean);
  assert.deepEqual(names("minions/aberrant-husk", "plasm"), ["Plasm Warrior", "Brutal"]);
  assert.deepEqual(names("leaders/revenant", "blood"), ["Ancient Skill", "Fighter", "Blood Leader"]);
  // No affinity chosen yet: all three, as the roster lists them then.
  assert.deepEqual(names("leaders/lich", null), ["Caster", "Blood Leader", "Bone Leader", "Plasm Leader"]);
});
