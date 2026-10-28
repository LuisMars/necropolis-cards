import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, EXAMPLE_LINK, EXAMPLE_EXPORT } from "./helpers.js";
import { fromAppJson, toAppJson } from "../web/js/builder/appjson.js";
import { decodeLink, encodeLink } from "../web/js/builder/codec.js";

test("the app's JSON export imports as the gathering its link describes", () => {
  const { gathering, unmatched } = fromAppJson(EXAMPLE_EXPORT, catalog);
  assert.deepEqual(unmatched, []);
  // The export was taken before Tireless Command (sb3) was added to the link.
  assert.equal(encodeLink(gathering, catalog), EXAMPLE_LINK.replace("sb3,", ""));
});

test("our export matches the app's numbers model by model", () => {
  const { gathering } = decodeLink(EXAMPLE_LINK, catalog);
  const ours = toAppJson(gathering, catalog);
  assert.equal(ours.covenant, EXAMPLE_EXPORT.covenant);
  assert.equal(ours.totalObols, 345);
  ours.gathering.forEach((e, i) => {
    const app = EXAMPLE_EXPORT.gathering[i].profile;
    for (const k of ["hp", "actionPoints", "move", "violence", "ranged", "obols", "affinity"]) {
      assert.equal(e.profile[k], app[k], `${app.name}.${k}`);
    }
    // The rulebook (p.33) gives the Necromantic Remnant the Beast keyword; the app doesn't.
    const ourKeywords = e.profile.keywords.filter(k => !(app.name === "Necromantic Remnant" && k === "Beast"));
    assert.deepEqual(new Set(ourKeywords), new Set(app.keywords || []), `${app.name} keywords`);
  });
  assert.equal(ours.gathering[0].profile.mana, 4);
  assert.equal(ours.gathering[0].profile.maxSpells, 4);
});

test("names and the mana pool survive our own export", () => {
  const { gathering } = decodeLink(EXAMPLE_LINK, catalog);
  gathering.models[0].name = "The Mire Walker";
  gathering.models[0].mana = { bone: 3, plasm: 1 };
  const json = toAppJson(gathering, catalog);
  assert.equal(json.gathering[0].modelName, "The Mire Walker");
  assert.deepEqual(json.manaPool, { bone: 3, plasm: 1 });
  const back = fromAppJson(json, catalog).gathering;
  assert.equal(back.models[0].name, "The Mire Walker");
  assert.deepEqual(back.models[0].mana, { bone: 3, plasm: 1 });
  assert.equal(encodeLink(back, catalog), EXAMPLE_LINK);
});

test("unknown names are reported, not dropped silently", () => {
  const json = structuredClone(EXAMPLE_EXPORT);
  json.gathering[1].weapons[0].name = "Laser Sword";
  const { unmatched } = fromAppJson(json, catalog);
  assert.deepEqual(unmatched, [{ where: "weapons", name: "Laser Sword" }]);
});

test("our export carries the campaign's changes for the roster, and the app's fields stay clean", async () => {
  const C = await import("../web/js/builder/campaign.js");
  const { gathering: g } = decodeLink(EXAMPLE_LINK, catalog);
  C.startCampaign(g, catalog, { alreadyBuilt: true });
  C.completeAmbition(g, "ambitions/rain-iron-sleet", catalog, "m3");
  const json = toAppJson(g, catalog);
  assert.deepEqual(json.gathering[2].builder.changes.ranged,
    [{ amount: 1, type: "ambition", key: "ambitions/rain-iron-sleet", note: null }]);
  assert.equal(json.gathering[0].builder, undefined);        // the Bone keyword is not a campaign change
  assert.equal(json.gathering[2].profile.ranged, 6);
  assert.equal(encodeLink(fromAppJson(json, catalog).gathering, catalog), EXAMPLE_LINK);
});
