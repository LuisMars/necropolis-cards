import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, EXAMPLE_LINK } from "./helpers.js";
import { decodeLink, encodeLink } from "../web/js/builder/codec.js";
import { evaluate } from "../web/js/builder/rules.js";
import { fromAppJson, toAppJson } from "../web/js/builder/appjson.js";
import { createStore, memoryStorage } from "../web/js/builder/store.js";
import { newGathering } from "../web/js/builder/gathering.js";
import {
  ensureCampaign, startCampaign, buyGear, sellGear, stashGear, takeGear, sellStashedGear,
  discardStashedGear, completeAmbition, undoAmbition, spellTargets, channelBonuses, tickAmbition,
  addBattle,
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
const IMPROVISED = "melee-weapons/improvised-weapon";
const tx = (g) => g.campaign.transactions.map(t => [t.type, t.item, t.uid, t.obols]);

/* ---- the gear stash -------------------------------------------------------- */

test("older saves get an empty gear stash, separate from the treasure stash", () => {
  const g = { models: [] };
  ensureCampaign(g);
  assert.deepEqual(g.gearStash, []);
  assert.deepEqual(g.stash, []);
  assert.deepEqual(newGathering().gearStash, []);
});

test("stashing and taking gear back is free", () => {
  const g = campaign();
  assert.equal(stashGear(g, catalog, "m3", "weapons", 0), "melee-weapons/blade");
  assert.deepEqual(g.gearStash, [{ key: "melee-weapons/blade", list: "weapons" }]);
  assert.deepEqual(g.stash, []);                                       // treasures stay apart
  assert.deepEqual(g.models[2].weapons, [IMPROVISED]);                 // its last weapon: the Improvised one comes back
  assert.equal(takeGear(g, "m1", 0), "melee-weapons/blade");
  assert.deepEqual(g.models[0].weapons, ["melee-weapons/blade"]);      // replaced the lone Improvised Weapon
  assert.deepEqual(g.gearStash, []);
  assert.equal(g.treasury, 100);
  assert.deepEqual(tx(g), [["stash", "melee-weapons/blade", "m3", 0], ["take", "melee-weapons/blade", "m1", 0]]);
});

test("buying costs obols; selling, from a model or the stash, gives half, rounded down", () => {
  const g = campaign();
  assert.equal(buyGear(g, catalog, "m3", "weapons", "melee-weapons/great-weapon"), 35);
  assert.equal(g.treasury, 65);
  // From a model: the Great Weapon (35) sells for 17.
  assert.equal(sellGear(g, catalog, "m3", "weapons", 1), 17);
  assert.equal(g.treasury, 82);
  // From the stash: the same.
  buyGear(g, catalog, "m3", "weapons", "melee-weapons/great-weapon");
  stashGear(g, catalog, "m3", "weapons", 1);
  buyGear(g, catalog, "m3", "armour", "armours/light-armour");
  stashGear(g, catalog, "m3", "armour", 0);
  assert.equal(g.treasury, 82 - 35 - 20);
  assert.equal(sellStashedGear(g, catalog, 0), 17);
  assert.equal(sellStashedGear(g, catalog, 0), 10);                    // Light Armour, 20
  assert.equal(g.treasury, 27 + 27);
  assert.deepEqual(g.gearStash, []);
  assert.deepEqual(tx(g).filter(t => t[0] === "sell"), [
    ["sell", "melee-weapons/great-weapon", "m3", 17],
    ["sell", "melee-weapons/great-weapon", null, 17],
    ["sell", "armours/light-armour", null, 10],
  ]);
});

test("equipment with a cost sells for half (house rule), from a model or the stash, or can be discarded", () => {
  const g = campaign();
  buyGear(g, catalog, "m2", "equipment", "miscellaneous-equipment/banner");   // 20
  buyGear(g, catalog, "m3", "equipment", "thrown-weapons/wardart");           // 5
  const before = g.treasury;
  assert.equal(sellGear(g, catalog, "m3", "equipment", 0), 2);                // half of 5, rounded down
  assert.equal(g.treasury, before + 2);
  stashGear(g, catalog, "m2", "equipment", 0);
  assert.equal(sellStashedGear(g, catalog, 0), 10);
  assert.deepEqual(g.gearStash, []);
  assert.equal(g.treasury, before + 12);
  buyGear(g, catalog, "m2", "equipment", "miscellaneous-equipment/banner");
  stashGear(g, catalog, "m2", "equipment", 0);
  const held = g.treasury;
  assert.equal(discardStashedGear(g, 0), "miscellaneous-equipment/banner");
  assert.deepEqual(g.gearStash, []);
  assert.equal(g.treasury, held);
  assert.deepEqual(tx(g).at(-1), ["discard", "miscellaneous-equipment/banner", null, 0]);
});

test("the free Improvised Weapon is never stashed", () => {
  const g = campaign();
  // A lone Improvised Weapon: removing it gives it straight back.
  assert.equal(stashGear(g, catalog, "m1", "weapons", 0), null);
  assert.deepEqual(g.models[0].weapons, [IMPROVISED]);
  // Next to a thrown weapon it is just removed, not stashed.
  buyGear(g, catalog, "m1", "weapons", "thrown-weapons/wardart");
  assert.deepEqual(g.models[0].weapons, [IMPROVISED, "thrown-weapons/wardart"]);
  assert.equal(stashGear(g, catalog, "m1", "weapons", 0), null);
  assert.deepEqual(g.models[0].weapons, ["thrown-weapons/wardart"]);
  assert.deepEqual(g.gearStash, []);
  assert.ok(!tx(g).some(t => t[0] === "stash"));
  // Taking a thrown weapon doesn't replace a lone Improvised one; a real one does.
  stashGear(g, catalog, "m1", "weapons", 0);
  assert.deepEqual(g.models[0].weapons, [IMPROVISED]);
  takeGear(g, "m1", 0);
  assert.deepEqual(g.models[0].weapons, [IMPROVISED, "thrown-weapons/wardart"]);
});

test("stash moves go into the next battle's log entry", () => {
  const g = campaign();
  stashGear(g, catalog, "m3", "weapons", 0);
  takeGear(g, "m6", 0);
  addBattle(g, { result: "win", obols: 0 }, catalog);
  assert.deepEqual(g.history.at(-1).transactions.map(t => t.type), ["stash", "take"]);
  assert.deepEqual(g.campaign.transactions, []);
});

test("the gear stash survives the app JSON, the store and a draft", () => {
  const g = campaign();
  stashGear(g, catalog, "m3", "weapons", 0);
  buyGear(g, catalog, "m2", "equipment", "miscellaneous-equipment/banner");
  stashGear(g, catalog, "m2", "equipment", 0);
  const want = [{ key: "melee-weapons/blade", list: "weapons" }, { key: "miscellaneous-equipment/banner", list: "equipment" }];

  const json = toAppJson(g, catalog);
  assert.deepEqual(json.builder.gearStash.map(({ key, list }) => ({ key, list })), want);
  assert.equal(json.builder.gearStash[0].name, "Blade");
  const { gathering: back, unmatched } = fromAppJson(JSON.parse(JSON.stringify(json)), catalog);
  assert.deepEqual(unmatched, []);
  assert.deepEqual(back.gearStash, want);
  // The share link doesn't carry it, and is unchanged by it.
  assert.equal(encodeLink(back, catalog), encodeLink(g, catalog));
  assert.equal(toAppJson(campaign(), catalog).builder, undefined);   // nothing stashed: no block

  // localStorage (the store and the drafts both keep the gathering as JSON).
  const storage = memoryStorage();
  createStore(storage).save(g);
  assert.deepEqual(createStore(storage).get(g.id).gearStash, want);
});

test("unknown stash entries in an export are reported", () => {
  const json = toAppJson(campaign(), catalog);
  json.builder = { gearStash: [{ key: "melee-weapons/laser-sword", list: "weapons", name: "Laser Sword" }] };
  const { gathering, unmatched } = fromAppJson(json, catalog);
  assert.deepEqual(gathering.gearStash, []);
  assert.deepEqual(unmatched, [{ where: "gearStash", name: "Laser Sword" }]);
});

/* ---- Master Abyssal Artillery: +1 to channel a spell (p.67) ---------------- */

const MAA = "ambitions/master-abyssal-artillery";

test("the reward goes to one of the leader's spells", () => {
  const g = campaign();
  assert.equal(catalog.row(MAA).reward_effect.target, "spell");
  assert.deepEqual(spellTargets(g, catalog, MAA), g.models[0].spells);
  assert.throws(() => completeAmbition(g, MAA, catalog));                                  // none chosen
  assert.throws(() => completeAmbition(g, MAA, catalog, { spell: "spells/dominate" }));    // not the leader's
  assert.equal(g.ambitions.completed, 0);
  completeAmbition(g, MAA, catalog, null, { spell: "spells/wither" });
  const e = g.ambitions.log.at(-1);
  assert.equal(e.applied.channel, "spells/wither");
  assert.equal(e.to, "m1");
  assert.deepEqual(channelBonuses(g), { "spells/wither": 1 });
  // The options may also take the uid's place; completing it again stacks.
  completeAmbition(g, MAA, catalog, { spell: "spells/wither" });
  completeAmbition(g, MAA, catalog, { spell: "spells/bone-spear" });
  assert.deepEqual(channelBonuses(g), { "spells/wither": 2, "spells/bone-spear": 1 });
  assert.equal(g.ambitions.completed, 3);
});

test("undoing it removes the bonus", () => {
  const g = campaign();
  completeAmbition(g, MAA, catalog, { spell: "spells/wither" });
  completeAmbition(g, MAA, catalog, { spell: "spells/wither" });
  assert.ok(undoAmbition(g, g.ambitions.log[0].id, catalog));
  assert.deepEqual(channelBonuses(g), { "spells/wither": 1 });
  undoAmbition(g, g.ambitions.log[0].id, catalog);
  assert.deepEqual(channelBonuses(g), {});
  assert.equal(g.ambitions.progress[MAA], 3);                                             // back at its goal
});

test("a channel bonus on a spell the leader no longer knows is a warning", () => {
  const g = campaign();
  completeAmbition(g, MAA, catalog, { spell: "spells/wither" });
  const codes = () => evaluate(g, catalog).warnings.filter(w => w.code === "channel-spell-missing");
  assert.deepEqual(codes(), []);
  g.models[0].spells = g.models[0].spells.filter(s => s !== "spells/wither");
  assert.deepEqual(codes().map(w => w.item), ["spells/wither"]);
});

test("the positional uid still works for a model-of-your-choice reward", () => {
  const g = campaign();
  tickAmbition(g, "ambitions/rain-iron-sleet", catalog, 9);
  completeAmbition(g, "ambitions/rain-iron-sleet", catalog, "m3");
  assert.equal(g.ambitions.log.at(-1).to, "m3");
  assert.equal(evaluate(g, catalog).models[2].stats.ranged, 6);
});
