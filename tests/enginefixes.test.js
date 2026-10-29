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

/* rules-gear: colossal weapons only where the entry says so; weapon counts. */

const warnings = (g, uid) => evaluate(g, catalog).warnings.filter(w => !uid || w.model === uid);
const has = (g, code, item) => warnings(g).some(w => w.code === code && (!item || w.item === item));

test("colossal weapons warn on a model whose entry doesn't allow them (pp.38-39)", () => {
  const { gathering: g } = decodeLink(EXAMPLE_LINK, catalog);
  g.models[0].weapons = ["colossal-weapons/massive-hand-weapon"];                // a Lich
  assert.ok(has(g, "weapon-not-allowed", "colossal-weapons/massive-hand-weapon"));
  g.models[0].weapons = ["melee-weapons/blade"];
  assert.ok(!has(g, "weapon-not-allowed"));
  // The Gigantic Horror's entry allows them, and only them.
  const h = newGathering({ covenant: "wretched-undead" });
  h.models.push(newModel(h, { profile: "minions/gigantic-horror", affinity: "bone",
                              weapons: ["colossal-weapons/massive-hand-weapon"] }));
  assert.ok(!has(h, "weapon-not-allowed"));
});

test("a leader carries up to 2 weapons, a minion 1 (p.36)", () => {
  const { gathering: g } = decodeLink(EXAMPLE_LINK, catalog);
  g.models[0].weapons = ["melee-weapons/blade", "ranged-weapons/sling"];
  assert.ok(!has(g, "too-many-weapons"));
  g.models[0].weapons.push("melee-weapons/axe");
  assert.ok(warnings(g, "m1").some(w => w.code === "too-many-weapons" && w.params.count === 3 && w.params.max === 2));
  g.models[1].weapons = ["melee-weapons/blade", "melee-weapons/axe"];
  assert.ok(warnings(g, "m2").some(w => w.code === "too-many-weapons" && w.params.max === 1));
  // The free Improvised Weapon and a thrown weapon don't count.
  g.models[1].weapons = ["melee-weapons/improvised-weapon", "melee-weapons/blade", "thrown-weapons/wardart"];
  assert.ok(!warnings(g, "m2").some(w => w.code === "too-many-weapons"));
});

/* rules-gathering / rules-spells: covenant traits belong to their covenant. */

test("another covenant's traits warn, and Wretched Undead takes none", () => {
  const { gathering: g } = decodeLink(EXAMPLE_LINK, catalog);              // Cairn-born
  g.models[1].traits = ["covenant-wretched-traits/march-of-the-hands"];      // Embalmed Hands'
  assert.ok(has(g, "foreign-covenant-trait", "covenant-wretched-traits/march-of-the-hands"));
  g.models[1].traits = ["covenant-wretched-traits/adamant-structure"];       // its own
  assert.ok(!has(g, "foreign-covenant-trait"));
  g.covenant = "wretched-undead";
  assert.ok(has(g, "foreign-covenant-trait", "covenant-wretched-traits/adamant-structure"));
  assert.ok(has(g, "foreign-covenant-trait", "covenant-leader-traits/osseous-sacrifice"));
  // Wretched Undead traits are fine in a covenant gathering too (p.19: "or a
  // trait from the Wretched Undead trait list").
  g.covenant = "covenants/cairn-born";
  g.models[1].traits = ["wretched-undead-traits/acolyte"];
  assert.ok(!has(g, "foreign-covenant-trait"));
});

test("an Apprentice may know one spell its leader knows (p.22)", () => {
  const g = newGathering({ covenant: "covenants/recusant-maleficar" });
  g.models.push(newModel(g, { profile: "leaders/lich", affinity: "bone",
    traits: ["covenant-leader-traits/erudite"], spells: ["spells/summon"] }));
  g.models.push(newModel(g, { profile: "minions/skeletal-husk", weapons: ["melee-weapons/blade"],
    traits: ["covenant-wretched-traits/apprentice"], spells: ["spells/summon"] }));
  const codes = () => warnings(g, "m2").map(w => w.code);
  assert.ok(!codes().includes("spells-on-minion"));
  assert.ok(!codes().includes("apprentice-spell"));
  g.models[1].spells = ["spells/dominate"];                                   // the leader doesn't know it
  assert.ok(codes().includes("apprentice-spell"));
  g.models[1].spells = ["spells/summon", "spells/dominate"];
  assert.ok(codes().includes("spell-count"));
  // Without the trait a minion still knows no spells.
  g.models[1].traits = [];
  g.models[1].spells = ["spells/summon"];
  assert.ok(codes().includes("spells-on-minion"));
});
