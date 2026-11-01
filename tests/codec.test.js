import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, EXAMPLE_LINK } from "./helpers.js";
import { decodeLink, encodeLink, linkPayload, isLink, linkUrl } from "../web/js/builder/codec.js";

test("decodes the example link", () => {
  const { gathering: g, unknown } = decodeLink(EXAMPLE_LINK, catalog);
  assert.deepEqual(unknown, []);
  assert.equal(g.covenant, "covenants/cairn-born");
  assert.deepEqual(g.models.map(m => m.profile), [
    "leaders/lich", "minions/familiar", "minions/aberrant-husk",
    "minions/skeletal-husk", "minions/skeletal-husk", "minions/necromantic-remnant",
  ]);
  assert.ok(g.models.every(m => m.affinity === "bone"));
  const lich = g.models[0];
  assert.deepEqual(lich.traits, ["covenant-leader-traits/osseous-sacrifice", "basic-leader-traits/studious"]);
  assert.deepEqual(lich.spells, ["spells/summon", "spells/wither", "spells/vigour", "spells/tireless-command", "spells/bone-spear"]);
  // The app leaves the leader's free weapon out of the link; decoding adds it back.
  assert.deepEqual(lich.weapons, ["melee-weapons/improvised-weapon"]);
  assert.deepEqual(g.models[3].armour, ["armours/light-armour"]);
  assert.deepEqual(g.models[5].traits, ["wretched-undead-traits/acolyte"]);
  assert.deepEqual(g.models.map(m => m.uid), ["m1", "m2", "m3", "m4", "m5", "m6"]);
});

test("the example link round-trips unchanged", () => {
  const { gathering } = decodeLink(EXAMPLE_LINK, catalog);
  assert.equal(encodeLink(gathering, catalog), EXAMPLE_LINK);
});

test("accepts full links and bare payloads", () => {
  for (const s of [
    `necropolis28.vercel.app/gathering-creation?id=${EXAMPLE_LINK}`,
    `http://necropolis28.vercel.app/gathering?id=${EXAMPLE_LINK}`,
    `https://necropolis28.vercel.app/gathering-creation?id=${encodeURIComponent(EXAMPLE_LINK)}`,
  ]) {
    assert.ok(isLink(s), s);
    assert.equal(linkPayload(s), EXAMPLE_LINK);
  }
  assert.ok(isLink(EXAMPLE_LINK));
  assert.ok(!isLink('{"covenant": "Cairn-born"}'));
  const { gathering } = decodeLink(EXAMPLE_LINK, catalog);
  assert.equal(linkPayload(linkUrl(gathering, catalog)), EXAMPLE_LINK);
});

test("thrown weapons and misc equipment survive a round trip", () => {
  const link = "c4;pl1,a0,tb0,ewm1,ewt0,ea2,ei1,sn0,sbl3";
  const { gathering: g, unknown } = decodeLink(link, catalog);
  assert.deepEqual(unknown, []);
  assert.equal(g.covenant, "wretched-undead");
  // Thrown weapons are Miscellaneous Equipment (p.41).
  assert.deepEqual(g.models[0].weapons, ["melee-weapons/blade"]);
  assert.deepEqual(g.models[0].equipment, ["thrown-weapons/wardart", "miscellaneous-equipment/banner"]);
  assert.equal(encodeLink(g, catalog), link);
});

test("covenant affinity lock fills a missing affinity", () => {
  const { gathering: g } = decodeLink("c0;pl0,tc0,tb5,sn0;pm3,ewm6", catalog);
  assert.ok(g.models.every(m => m.affinity === "blood"));
});

test("a fixed-affinity model keeps its own, even against the covenant", () => {
  // A Ghast Husk is always Plasm; in Embalmed Hands that's a covenant warning,
  // not a Blood Ghast Husk.
  const { gathering: g } = decodeLink("c0;pl0,tc0,tb5,sn0;pm2,ewm1;pm7,ewm8", catalog);
  assert.equal(g.models[1].affinity, "plasm");
  assert.equal(g.models[2].affinity, "blood");   // Flying Beast: Blood or Bone
});

test("reports IDs it doesn't know", () => {
  const { gathering: g, unknown } = decodeLink("c1;pl0,a1,zz9,tb0;pm1,ewm99", catalog);
  assert.deepEqual(unknown, ["zz9", "ewm99"]);
  assert.equal(g.models.length, 2);
});

/* ---- forced keyword (affinity) and covenant-locked mana ---------------------- */
import { forcedAffinity, applyForcedAffinities, lockMana, evaluate as evalG } from "../web/js/builder/rules.js";
import { newGathering, newModel } from "../web/js/builder/gathering.js";

const mk = (covenant, profile, extra = {}) => {
  const g = newGathering({ covenant });
  g.models.push(newModel(g, { profile, weapons: ["melee-weapons/blade"], ...extra }));
  return g;
};

test("forced keyword: type first, then the covenant lock, else free", () => {
  const cairn = newGathering({ covenant: "covenants/cairn-born" });
  assert.equal(forcedAffinity(cairn, "leaders/lich", catalog), "bone");
  assert.equal(forcedAffinity(cairn, "minions/familiar", catalog), "bone");
  // Ghast Husk is always Plasm, even in Cairn-born (it keeps its covenant warning).
  assert.equal(forcedAffinity(cairn, "minions/ghast-husk", catalog), "plasm");
  for (const cov of ["covenants/recusant-maleficar", "covenants/crawling-dark", "wretched-undead", null]) {
    assert.equal(forcedAffinity(newGathering({ covenant: cov }), "leaders/lich", catalog), null);
  }
});

test("a stored null or wrong keyword under a lock is corrected; the Ghast keeps Plasm", () => {
  const g = mk("covenants/cairn-born", "leaders/lich", { affinity: null });
  g.models.push(newModel(g, { profile: "minions/familiar", affinity: "blood", weapons: ["melee-weapons/blade"] }));
  g.models.push(newModel(g, { profile: "minions/ghast-husk", affinity: null, weapons: ["melee-weapons/blade"] }));
  assert.equal(applyForcedAffinities(g, catalog), true);
  assert.deepEqual(g.models.map(m => m.affinity), ["bone", "bone", "plasm"]);
  const w = evalG(g, catalog).models.map(e => e.warnings.map(x => x.code));
  assert.ok(w.every(c => !c.includes("affinity-missing")));
  assert.ok(w[2].includes("covenant-keyword"));
  assert.equal(applyForcedAffinities(g, catalog), false);
});

test("a covenant that doesn't lock leaves the keyword and mana free", () => {
  const g = mk("covenants/recusant-maleficar", "leaders/lich", { affinity: null });
  assert.equal(applyForcedAffinities(g, catalog), false);
  assert.equal(g.models[0].affinity, null);
  assert.equal(lockMana(g, catalog), false);
  assert.deepEqual(g.models[0].mana, {});
});

test("locked mana: prefilled when empty, kept when set, topped up only with the allowance", () => {
  const g = mk("covenants/cairn-born", "leaders/lich");
  const allowed = () => evalG(g, catalog).models[0].mana;
  assert.equal(lockMana(g, catalog), true);
  assert.deepEqual(g.models[0].mana, { bone: allowed() });
  // A custom split is never overwritten, even with topUp.
  g.models[0].mana = { bone: 1, plasm: allowed() - 1 };
  assert.equal(lockMana(g, catalog, { topUp: true }), false);
  assert.deepEqual(g.models[0].mana, { bone: 1, plasm: allowed() - 1 });
  // All in the lock keyword but short: load leaves it, a topUp raises it.
  g.models[0].mana = { bone: 1 };
  assert.equal(lockMana(g, catalog), false);
  const before = allowed();
  g.models[0].traits.push("basic-leader-traits/sorcerous-talent");
  assert.ok(allowed() > before);
  assert.equal(lockMana(g, catalog, { topUp: true }), true);
  assert.deepEqual(g.models[0].mana, { bone: allowed() });
});

test("decoding a link prefills locked mana", () => {
  const { gathering: g } = decodeLink("c1;pl0,tc0,tb5,sn0;pm3,ewm6", catalog);
  assert.deepEqual(g.models[0].mana, { bone: evalG(g, catalog).models[0].mana });
});
