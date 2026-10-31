import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, EXAMPLE_LINK } from "./helpers.js";
import { decodeLink } from "../web/js/builder/codec.js";
import { evaluate } from "../web/js/builder/rules.js";
import {
  startCampaign, buyUpgrade, refundUpgrade, tickAmbition, completeAmbition, greaterOwed,
  rollTreasure, treasureTable, giveTreasure, moveTreasure, hireSellsword, freeSellsword,
  addBattle, removeBattle, rewardTargets,
} from "../web/js/builder/campaign.js";

const codes = (g) => evaluate(g, catalog).warnings.map(w => w.code).sort();
/** The example gathering, fixed up to be legal: mana split, 2 Skeletal Husks dropped (345 → 185). */
function example() {
  const { gathering: g } = decodeLink(EXAMPLE_LINK, catalog);
  g.models[0].mana = { bone: 4 };
  g.models.splice(3, 2);
  return g;
}
/** A fixed die: returns `values` in turn as d(sides) results. */
const dice = (...values) => { let i = 0; return () => (values[i++ % values.length] - 0.5) / 10; };

test("starting the campaign turns the leftover budget into the treasury", () => {
  const g = example();
  assert.equal(evaluate(g, catalog).total, 185);
  assert.equal(startCampaign(g, catalog), 115);
  const ev = evaluate(g, catalog);
  assert.equal(ev.budget, null);                 // no more build budget
  assert.deepEqual(ev.warnings, []);
});

test("a band that was already built starts with a treasury of 0", () => {
  const { gathering: g } = decodeLink(EXAMPLE_LINK, catalog);   // 345 obols
  g.models[0].mana = { bone: 4 };
  assert.deepEqual(codes(g), ["over-budget"]);                   // first build: 300
  startCampaign(g, catalog, { alreadyBuilt: true });
  assert.equal(g.treasury, 0);
  assert.deepEqual(codes(g), []);                                // 345 fits the 350 limit
});

test("lair upgrades cost 50 once, and change the gathering", () => {
  const g = example();
  startCampaign(g, catalog);
  assert.ok(buyUpgrade(g, "lair-upgrades/bell-tower", catalog));
  assert.ok(!buyUpgrade(g, "lair-upgrades/bell-tower", catalog));   // once only
  buyUpgrade(g, "lair-upgrades/arcane-library", catalog);
  buyUpgrade(g, "lair-upgrades/gloomy-hall", catalog);
  assert.equal(g.treasury, 115 - 150);
  const ev = evaluate(g, catalog);
  assert.equal(ev.deploymentLimit, 400);
  assert.equal(ev.models[0].spellsAllowed, 6);   // + Arcane Library
  assert.deepEqual(codes(g), ["spell-count", "treasury-negative"]);
  refundUpgrade(g, "lair-upgrades/gloomy-hall", catalog);
  assert.equal(g.treasury, 15);
});

test("the deployment limit stops at 500", () => {
  const g = example();
  g.deploymentLimit = 450;
  buyUpgrade(g, "lair-upgrades/bell-tower", catalog);
  buyUpgrade(g, "lair-upgrades/dusty-crypts", catalog);
  const ev = evaluate(g, catalog);
  assert.equal(ev.deploymentLimit, 500);
  assert.ok(ev.warnings.some(w => w.code === "deployment-cap"));
});

test("ambitions: progress, rewards, and a greater treasure every 5", () => {
  const g = example();
  startCampaign(g, catalog);
  assert.ok(!tickAmbition(g, "ambitions/rain-iron-sleet", catalog));
  assert.ok(tickAmbition(g, "ambitions/rain-iron-sleet", catalog));          // goal 2
  const husk = g.models[2];
  completeAmbition(g, "ambitions/rain-iron-sleet", catalog, husk.uid);
  assert.equal(evaluate(g, catalog).models[2].stats.ranged, 6);              // 7+ → 6+
  assert.equal(g.ambitions.progress["ambitions/rain-iron-sleet"], 0);

  completeAmbition(g, "ambitions/test-the-limits-of-undeath", catalog);
  assert.deepEqual(evaluate(g, catalog).models.map(m => m.stats.hp), [16, 7, 13, 7]);
  completeAmbition(g, "ambitions/commune-with-the-truth", catalog);
  assert.equal(evaluate(g, catalog).models[0].mana, 5);
  completeAmbition(g, "ambitions/build-a-sanctuary", catalog);
  assert.equal(evaluate(g, catalog).deploymentLimit, 400);
  assert.equal(greaterOwed(g), 0);
  const r = completeAmbition(g, "ambitions/scour-the-lands", catalog);
  assert.equal(r.treasure, "minor");
  assert.ok(r.ambition);                                                       // so undo can take it back
  assert.equal(greaterOwed(g), 1);
  giveTreasure(g, "greater-treasures/cinder-ash-bolts", null, { greaterClaim: true });
  assert.equal(greaterOwed(g), 0);
});

test("a familiar's reward only goes to a familiar", () => {
  const g = example();
  assert.deepEqual(rewardTargets(g, catalog, "ambitions/a-favoured-familiar").map(m => m.profile), ["minions/familiar"]);
  assert.throws(() => completeAmbition(g, "ambitions/a-favoured-familiar", catalog, g.models[2].uid));
  completeAmbition(g, "ambitions/a-favoured-familiar", catalog, g.models[1].uid);
  assert.deepEqual(evaluate(g, catalog).models[1].stats, { ap: 2, move: 4, violence: 8, ranged: null, hp: 7 });
});

test("improvements past the rulebook's limits warn", () => {
  const g = example();
  g.models[2].improvements = { violence: 3, ap: 1 };
  assert.deepEqual(codes(g), ["improvement-cap"]);
});

test("treasures: rolls, carrying limits, moving", () => {
  assert.equal(treasureTable(catalog, "minor").length, 10);
  const [minor] = rollTreasure(catalog, "minor", dice(3));
  assert.equal(minor, treasureTable(catalog, "minor")[2]);
  assert.equal(rollTreasure(catalog, "greater", dice(1, 10)).length, 2);

  const g = example();
  const t = treasureTable(catalog, "minor");
  for (const k of t.slice(0, 3)) giveTreasure(g, k, g.models[2].uid);       // husk: 2 minor
  giveTreasure(g, t[0], g.models[1].uid);                                    // familiar: Beast, none
  assert.deepEqual(codes(g), ["too-many-treasures", "too-many-treasures"]);
  moveTreasure(g, g.models[2].uid, 2, null);
  moveTreasure(g, g.models[1].uid, 0, g.models[0].uid);
  assert.deepEqual(codes(g), []);
  assert.equal(g.stash.length, 1);
  // potions count as minor treasures
  giveTreasure(g, "potions/mana-bottle", g.models[2].uid);
  assert.deepEqual(codes(g), ["too-many-treasures"]);
});

test("sellswords: roster cost, the free Rabble, outside the deployment limit", () => {
  const g = example();
  startCampaign(g, catalog);
  assert.ok(!freeSellsword(g));
  g.campaign.opponentHigher = true;                    // opponent's limit 100+ higher (p.74)
  assert.ok(freeSellsword(g));
  const rabble = hireSellsword(g, "sellswords/desperate-rabble", catalog, { free: true });
  assert.equal(g.treasury, 115);
  assert.ok(g.campaign.freeRabbleUsed);
  hireSellsword(g, "sellswords/blightblade-beast-hunter", catalog);
  assert.equal(g.treasury, 85);
  rabble.affinity = "bone";
  g.models.at(-1).affinity = "bone";
  rabble.status = "active";
  const ev = evaluate(g, catalog);
  assert.equal(ev.fielded, 185);                       // sellswords don't count
  assert.deepEqual(ev.warnings, []);
  g.models.at(-1).status = "active";
  assert.deepEqual(codes(g), ["too-many-sellswords"]);
});

test("battle log: obols go into the treasury and back out", () => {
  const g = example();
  addBattle(g, { mission: "missions/relic-hunters", result: "win", obols: 41 }, catalog);
  assert.equal(g.treasury, 115 + 41);
  assert.equal(g.history.length, 1);
  assert.equal(evaluate(g, catalog).budget, null);
  removeBattle(g, 0);
  assert.equal(g.treasury, 115);
});

test("purchases and sales are recorded, then handed to the next battle's log entry", async () => {
  const { buyGear, sellGear, recruit, record } = await import("../web/js/builder/campaign.js");
  const g = example();
  startCampaign(g, catalog);                           // 115
  buyUpgrade(g, "lair-upgrades/bell-tower", catalog);
  buyGear(g, catalog, "m3", "armour", "armours/light-armour");
  sellGear(g, catalog, "m3", "weapons", 0);
  recruit(g, catalog, "minions/skeletal-husk", "melee-weapons/improvised-weapon");
  hireSellsword(g, "sellswords/desperate-rabble", catalog, { free: true });
  assert.deepEqual(g.campaign.transactions.map(t => [t.type, t.obols]),
    [["upgrade", -50], ["buy", -20], ["sell", 5], ["recruit", -50], ["hire-free", 0]]);
  assert.equal(g.treasury, 115 - 50 - 20 + 5 - 50);
  addBattle(g, { result: "win", obols: 30 }, catalog);
  assert.equal(g.history.at(-1).transactions.length, 5);
  assert.deepEqual(g.campaign.transactions, []);
});
