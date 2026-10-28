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
  assert.deepEqual(g.models[0].weapons, ["melee-weapons/blade", "thrown-weapons/wardart"]);
  assert.deepEqual(g.models[0].equipment, ["miscellaneous-equipment/banner"]);
  assert.equal(encodeLink(g, catalog), link);
});

test("covenant affinity lock fills a missing affinity", () => {
  const { gathering: g } = decodeLink("c0;pl0,tc0,tb5,sn0;pm3,ewm6", catalog);
  assert.ok(g.models.every(m => m.affinity === "blood"));
});

test("reports IDs it doesn't know", () => {
  const { gathering: g, unknown } = decodeLink("c1;pl0,a1,zz9,tb0;pm1,ewm99", catalog);
  assert.deepEqual(unknown, ["zz9", "ewm99"]);
  assert.equal(g.models.length, 2);
});
