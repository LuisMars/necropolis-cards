import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle, catalog, EXAMPLE_LINK } from "./helpers.js";
import { decodeLink } from "../web/js/builder/codec.js";
import { newGathering, newModel } from "../web/js/builder/gathering.js";
import { label } from "../web/js/builder/messages.js";
import {
  startCampaign, startAfterBattle, applyVictoryRewards, applyLairIncome, applyPurloiner,
  buyUpgrade, d10, today, setDeploymentBase, hireSellsword, buyGear, completeAmbition, tickAmbition,
} from "../web/js/builder/campaign.js";
import { evaluate } from "../web/js/builder/rules.js";

function campaign() {
  const { gathering: g } = decodeLink(EXAMPLE_LINK, catalog);
  g.models[0].mana = { bone: 4 };
  g.models.splice(3, 2);
  startCampaign(g, catalog, { alreadyBuilt: true });
  g.treasury = 100;
  return g;
}

/* code-js #1: typed dice must be a whole number from 1 to 10. */

test("d10 takes 1-10 and refuses anything else with a code the UI can show", () => {
  assert.equal(d10(1), 1);
  assert.equal(d10("10"), 10);
  assert.equal(d10(" 7 "), 7);
  for (const bad of ["", null, undefined, "0", 0, 11, "4.5", "x", "-3"]) {
    assert.throws(() => d10(bad), (e) => e.code === "invalidDie", String(bad));
  }
  assert.notEqual(label("invalidDie", "en"), "invalidDie");
  assert.notEqual(label("invalidDie", "es"), label("invalidDie", "en"));
});

test("an invalid die records nothing, so the step can be applied again", () => {
  const g = campaign();
  buyUpgrade(g, "lair-upgrades/abandoned-mine", catalog);                // 100 → 50
  startAfterBattle(g, { result: "win" });
  assert.throws(() => applyVictoryRewards(g, catalog, ["", 4]), { code: "invalidDie" });
  assert.throws(() => applyVictoryRewards(g, catalog, [4]), { code: "invalidDie" });   // 2d10
  assert.equal(g.campaign.afterBattle.done.rewards, undefined);
  assert.equal(applyVictoryRewards(g, catalog, ["4", "7"]), 41);
  assert.throws(() => applyLairIncome(g, catalog, "lair-upgrades/abandoned-mine", ""), { code: "invalidDie" });
  assert.equal(g.campaign.afterBattle.done.income["lair-upgrades/abandoned-mine"], undefined);
  assert.equal(applyLairIncome(g, catalog, "lair-upgrades/abandoned-mine", 6), 6);
  // Purloiner: the first die always; the second only when the first passes.
  assert.throws(() => applyPurloiner(g, "m4", 3, "", ""), { code: "invalidDie" });
  assert.throws(() => applyPurloiner(g, "m4", 3, 2, ""), { code: "invalidDie" });
  assert.equal(g.campaign.afterBattle.done.purloiner.m4, undefined);
  assert.equal(applyPurloiner(g, "m4", 3, 9, ""), 0);                   // 9 > Move 3: no second roll
  assert.equal(g.treasury, 50 + 41 + 6);
});

/* code-js #3: uids are never reused. */

test("a removed model's uid is not handed to the next one", () => {
  const g = campaign();
  hireSellsword(g, "sellswords/desperate-rabble", catalog);
  const hired = g.models.at(-1).uid;
  assert.equal(hired, "m7");                                         // m1-m6 decoded, two removed
  g.models = g.models.filter(m => m.uid !== hired);                      // dismissed
  const next = newModel(g, {}).uid;
  assert.notEqual(next, hired);
  assert.equal(next, "m8");
});

test("an older save (no uidSeq) skips uids its logs still mention", () => {
  const g = campaign();
  g.models[0].mana = { bone: 4 };
  // A transaction and an ambition log entry for a model since removed.
  g.campaign.transactions.push({ type: "buy", item: "armours/light-armour", uid: "m9", obols: -20 });
  g.ambitions.log.push({ id: "a1", ambition: "ambitions/x", to: "m12", applied: { models: ["m12"] } });
  delete g.uidSeq;
  assert.equal(newModel(g).uid, "m13");
  // Existing uids are left as they were.
  assert.deepEqual(g.models.map(m => m.uid), ["m1", "m2", "m3", "m6"]);
});

test("a fresh gathering still numbers m1, m2, …", () => {
  const g = newGathering();
  g.models.push(newModel(g), newModel(g));
  assert.deepEqual(g.models.map(m => m.uid), ["m1", "m2"]);
  assert.equal(g.campaign.opponentLimit, undefined);                    // code-js #22
  assert.equal(g.campaign.opponentHigher, false);
});

/* code-js #10: dates are the player's local date. */

test("today() is the local date, not UTC's", () => {
  assert.equal(today(new Date(2026, 0, 5, 0, 30)), "2026-01-05");      // 00:30 local
  assert.equal(today(new Date(2026, 11, 31, 23, 59)), "2026-12-31");
});

/* code-js #11: a deployment base of 0 is kept. */

test("the deployment base keeps 0; blank goes back to the default", () => {
  const g = campaign();
  setDeploymentBase(g, "0");
  assert.equal(g.deploymentLimit, 0);
  assert.equal(evaluate(g, catalog).deploymentLimit, 0);
  setDeploymentBase(g, "abc");
  assert.equal(g.deploymentLimit, 0);
  setDeploymentBase(g, "");
  assert.equal(g.deploymentLimit, null);
  assert.equal(evaluate(g, catalog).deploymentLimit, 350);
  setDeploymentBase(g, "400");
  assert.equal(g.deploymentLimit, 400);
});

/* code-js #4: a "$" in a banner name stays literal. */

test("a banner override with $ patterns prints as typed", async () => {
  globalThis.document ??= { getElementById: () => null };
  const { state } = await import("../web/js/state.js");
  const { renderCardSvg } = await import("../web/js/templates.js");
  state.bundle = bundle;
  state.lang = "en";
  state.templates = { leader: readFileSync(new URL("../web/templates/leader.svg", import.meta.url), "utf8") };
  const key = Object.keys(bundle.categories).find(k => bundle.categories[k].template === "leader");
  const row = bundle.categories[key].rows[0];
  for (const name of ["Lord $1", "Ash $& $$ $` $'"]) {
    const svg = renderCardSvg({ key, row, override: { header: name } });
    const title = /<text\s+class="banner-title"[^>]*>([^<]*)<\/text>/.exec(svg)[1];
    assert.equal(title, name.replace(/&/g, "&amp;"));
  }
  // A normal name prints exactly as before.
  const plain = renderCardSvg({ key, row, override: { header: "Darth Vader" } });
  assert.match(plain, />Darth Vader<\/text>/);
});

/* code-js #18 and rules-gear: thrown weapons are Miscellaneous Equipment (p.41). */

test("thrown weapons land in equipment from app JSON, whichever list they came in", async () => {
  const { fromAppJson } = await import("../web/js/builder/appjson.js");
  const { EXAMPLE_EXPORT } = await import("./helpers.js");
  const json = structuredClone(EXAMPLE_EXPORT);
  json.gathering[1].weapons.push({ name: "Wardart" });
  json.gathering[2].miscEquipment = [{ name: "Throwing Axe or Mallet" }];
  const { gathering: g, unmatched } = fromAppJson(json, catalog);
  assert.deepEqual(unmatched, []);
  assert.ok(!g.models[1].weapons.includes("thrown-weapons/wardart"));
  assert.deepEqual(g.models[1].equipment, ["thrown-weapons/wardart"]);
  assert.deepEqual(g.models[2].equipment, ["thrown-weapons/throwing-axe-or-mallet"]);
});

test("a thrown weapon counts against the one piece of Miscellaneous Equipment", () => {
  const g = newGathering({ covenant: "wretched-undead" });
  g.models.push(newModel(g, { profile: "minions/corpse-husk", weapons: ["melee-weapons/blade"],
    equipment: ["thrown-weapons/wardart", "miscellaneous-equipment/banner"] }));
  const w = evaluate(g, catalog).warnings.filter(x => x.code === "too-much-equipment");
  assert.equal(w.length, 1);
  assert.equal(w[0].params.count, 2);
  // An older save that filed it under weapons is counted the same way, and
  // it still takes no hand next to a two-handed weapon.
  g.models[0] = { ...g.models[0], weapons: ["melee-weapons/heavy-polearm", "thrown-weapons/wardart"],
                  equipment: ["miscellaneous-equipment/banner"] };
  const codes = evaluate(g, catalog).warnings.map(x => x.code);
  assert.ok(codes.includes("too-much-equipment"));
  assert.ok(!codes.includes("too-many-hands"));
  // One thrown weapon alone is fine.
  g.models[0] = { ...g.models[0], weapons: ["melee-weapons/blade"], equipment: ["thrown-weapons/wardart"] };
  assert.ok(!evaluate(g, catalog).warnings.some(x => x.code === "too-much-equipment"));
});
