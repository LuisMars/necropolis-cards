import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, EXAMPLE_LINK } from "./helpers.js";
import { decodeLink } from "../web/js/builder/codec.js";
import { evaluate } from "../web/js/builder/rules.js";
import {
  startCampaign, buyUpgrade, giveTreasure, startAfterBattle, maladyFor, applyMalady,
  applyVictoryRewards, applyLairIncome, applyPurloiner, buyGear, recruit, sellGear, sellTreasure,
  soulBinder, tombRobber, buyAlchemy, buyPrice, rollScenarioPart, finishAfterBattle, completeAmbition,
  canRerollOmen,
} from "../web/js/builder/campaign.js";

/** The example gathering, legal and in a campaign with 100 obols. */
function campaign() {
  const { gathering: g } = decodeLink(EXAMPLE_LINK, catalog);
  g.models[0].mana = { bone: 4 };
  g.models.splice(3, 2);
  startCampaign(g, catalog, { alreadyBuilt: true });
  g.treasury = 100;
  return g;
}
const leader = (g) => evaluate(g, catalog).models[0];

test("the malady table follows the D10 roll", () => {
  assert.deepEqual([1, 2, 3, 5, 6, 9, 10].map(r => maladyFor(catalog, r).key),
    ["frail", "cursed-form", "incomplete-form", "incomplete-form", "pilfered", "pilfered", "perfect"]);
});

test("maladies change the leader, and Soul Binder takes them back", () => {
  const g = campaign();
  startAfterBattle(g, { result: "loss", leaderShattered: true });
  assert.throws(() => applyMalady(g, catalog, 4, {}));                  // needs a stat
  applyMalady(g, catalog, 4, { stat: "violence" });
  assert.equal(leader(g).stats.violence, 7);                            // 6+ → 7+
  assert.equal(applyMalady(g, catalog, 1), null);                       // once per sequence
  soulBinder(g, catalog, "m1", 0);
  assert.equal(leader(g).stats.violence, 6);
  assert.equal(g.treasury, 50);
});

test("Frail Reformation stops at 10 HP; Perfect adds 1", () => {
  const g = campaign();
  g.models[0].maladies = Array.from({ length: 7 }, () => ({ key: "frail" }));
  assert.equal(leader(g).stats.hp, 10);                                 // 15 - 7, floored at 10
  g.models[0].maladies = [];
  startAfterBattle(g, { leaderShattered: true });
  applyMalady(g, catalog, 10);
  assert.equal(leader(g).stats.hp, 16);
});

test("Pilfered takes the chosen minor treasure from the leader", () => {
  const g = campaign();
  giveTreasure(g, "minor-treasures/mana-bottle", "m1");
  giveTreasure(g, "minor-treasures/soul-tether", "m1");
  startAfterBattle(g, { leaderShattered: true });
  applyMalady(g, catalog, 7, { treasure: 1 });
  assert.deepEqual(g.models[0].treasures, ["minor-treasures/mana-bottle"]);
});

test("victory rewards, lair income and Purloiner add up in the treasury and the log", () => {
  const g = campaign();
  buyUpgrade(g, "lair-upgrades/abandoned-mine", catalog);                // 100 → 50
  startAfterBattle(g, { result: "win", mission: "missions/relic-hunters" });
  assert.equal(applyVictoryRewards(g, catalog, [4, 7]), 41);            // 30 + 2d10
  assert.equal(applyVictoryRewards(g, catalog, [10, 10]), 0);           // once
  assert.equal(g.campaign.afterBattle.treasuresLeft, 2);
  assert.equal(applyLairIncome(g, catalog, "lair-upgrades/abandoned-mine", 6), 6);
  assert.equal(applyLairIncome(g, catalog, "lair-upgrades/dank-culvert", 6), 0);   // not owned
  assert.equal(applyPurloiner(g, "m4", 3, 2, 8), 8);                   // 2 ≤ Move 3
  assert.equal(g.treasury, 50 + 41 + 6 + 8);
  finishAfterBattle(g, { mission: "missions/the-horde" });
  assert.equal(g.history.at(-1).obols, 55);
  assert.equal(g.history.at(-1).mission, "missions/relic-hunters");
  assert.equal(g.campaign.afterBattle, undefined);
  assert.equal(g.campaign.nextScenario.mission, "missions/the-horde");
  // The next sequence starts from the scenario rolled for it.
  assert.equal(startAfterBattle(g, {}).battle.mission, "missions/the-horde");
});

test("a loss pays 20 + 2d10 and one treasure roll", () => {
  const g = campaign();
  startAfterBattle(g, { result: "loss" });
  assert.equal(applyVictoryRewards(g, catalog, [1, 1]), 22);
  assert.equal(g.campaign.afterBattle.treasuresLeft, 1);
});

test("the Markets: buying (with the Forgotten Forge), recruiting, selling", () => {
  const g = campaign();
  assert.equal(buyGear(g, catalog, "m3", "armour", "armours/light-armour"), 20);
  buyUpgrade(g, "lair-upgrades/forgotten-forge", catalog);              // 80 → 30
  assert.equal(buyPrice(g, catalog, "melee-weapons/great-weapon"), 28); // 35 - 20%, rounded down
  assert.equal(buyPrice(g, catalog, "miscellaneous-equipment/banner"), 20); // not discounted
  g.treasury = 200;
  buyGear(g, catalog, "m1", "weapons", "melee-weapons/blade");
  assert.deepEqual(g.models[0].weapons, ["melee-weapons/blade"]);       // replaced the improvised one
  assert.equal(g.treasury, 192);
  const m = recruit(g, catalog, "minions/skeletal-husk", "melee-weapons/improvised-weapon");
  assert.equal(m.affinity, "bone");
  assert.equal(g.treasury, 142);
  assert.equal(sellGear(g, catalog, "m3", "armour", 0), 10);            // half of 20
  assert.equal(sellGear(g, catalog, "m3", "weapons", 0), 5);            // its only weapon, a Blade
  assert.deepEqual(g.models[2].weapons, ["melee-weapons/improvised-weapon"]);
  g.treasury -= 5;
  assert.throws(() => sellGear(g, catalog, "m1", "equipment", 0));
  giveTreasure(g, "greater-treasures/cinder-ash-bolts", null);
  giveTreasure(g, "potions/mana-bottle", null);
  assert.equal(sellTreasure(g, catalog, null, 0), 50);
  assert.equal(sellTreasure(g, catalog, null, 0), 10);
  assert.equal(g.treasury, 212);
});

test("Tomb Robber once per gathering; the Alchemy Workshop once per sequence", () => {
  const g = campaign();
  startAfterBattle(g, {});
  assert.ok(tombRobber(g, catalog, "minor-treasures/blade-oil", { to: "m1" }));
  assert.equal(g.treasury, 70);
  assert.ok(!tombRobber(g, catalog, "minor-treasures/blade-oil"));
  assert.ok(!buyAlchemy(g, catalog, "potions/mana-bottle"));           // no workshop
  buyUpgrade(g, "lair-upgrades/alchemy-workshop", catalog);
  assert.ok(buyAlchemy(g, catalog, "throwing-pots/thunderclap", "m1"));
  assert.ok(!buyAlchemy(g, catalog, "potions/mana-bottle"));
  assert.equal(g.treasury, 70 - 50 - 10);
  assert.deepEqual(g.models[0].treasures, ["minor-treasures/blade-oil", "throwing-pots/thunderclap"]);
});

test("rolling the next scenario, and the Read the Omens reroll", () => {
  const seq = (...v) => { let i = 0; return () => (v[i++] - 0.5) / 10; };
  assert.equal(rollScenarioPart(catalog, "missions", seq(1)), "missions/consult-the-seer");
  assert.equal(rollScenarioPart(catalog, "dread-omens", seq(10)), "dread-omens/winged-nightmares");
  assert.equal(rollScenarioPart(catalog, "environments", () => 0.999), "environments/flatwater-mire");
  const g = campaign();
  assert.ok(!canRerollOmen(g));
  completeAmbition(g, "ambitions/read-the-omens", catalog);
  assert.ok(canRerollOmen(g));
});
