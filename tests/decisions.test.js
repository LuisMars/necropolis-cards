import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, EXAMPLE_LINK } from "./helpers.js";
import { decodeLink, encodeLink, defaultWeapon } from "../web/js/builder/codec.js";
import { newGathering, newModel } from "../web/js/builder/gathering.js";
import { evaluate } from "../web/js/builder/rules.js";
import { label } from "../web/js/builder/messages.js";
import {
  startCampaign, startingWeapon, weaponLocked, recruit, recruitPrice, sellGear, stashGear, discardGear,
  buyGear, buyUpgrade, sellValue, deployCosts, payDeployment, hireSellsword, addBattle, startAfterBattle,
  finishAfterBattle, sellTreasure, giveTreasure, sellStashedGear,
} from "../web/js/builder/campaign.js";

const CLAWS = "melee-weapons/claws-and-fangs";
const LARGE = "melee-weapons/large-claws";
const IMPROVISED = "melee-weapons/improvised-weapon";

function campaign(treasury = 100) {
  const { gathering: g } = decodeLink(EXAMPLE_LINK, catalog);
  g.models[0].mana = { bone: 4 };
  startCampaign(g, catalog, { alreadyBuilt: true });
  g.treasury = treasury;
  return g;
}

/* D3: the covenant's leader trait comes "in addition to any others" (p.19). */

test("the covenant's own leader trait doesn't count towards the 3", () => {
  const g = newGathering({ covenant: "covenants/cairn-born" });
  const leader = newModel(g, { profile: "leaders/lich", affinity: "bone", spells: ["spells/summon"], traits: [
    "covenant-leader-traits/osseous-sacrifice",
    "basic-leader-traits/unyielding-will", "wretched-undead-traits/acolyte", "wretched-undead-traits/purloiner",
  ] });
  g.models.push(leader);
  const over = () => evaluate(g, catalog).warnings.filter(w => w.code === "too-many-traits");
  assert.deepEqual(over(), []);                                     // 3 + the covenant's
  leader.traits.push("wretched-undead-traits/skitter");
  assert.equal(over()[0].params.count, 4);
  // Another covenant's leader trait gets no such pass.
  leader.traits = ["covenant-leader-traits/moonlight-flit", "basic-leader-traits/unyielding-will",
                   "wretched-undead-traits/acolyte", "wretched-undead-traits/purloiner"];
  assert.equal(over()[0].params.count, 4);
});

/* D4: beasts start with Claws and Fangs; what a link says stays as it is. */

test("Familiar and the beasts start with Claws and Fangs; others with their free weapon", () => {
  for (const k of ["familiar", "small-beast", "flying-beast", "large-beast"]) {
    assert.equal(startingWeapon(catalog, `minions/${k}`), CLAWS, k);
  }
  assert.equal(startingWeapon(catalog, "minions/corpse-husk"), IMPROVISED);
  assert.equal(startingWeapon(catalog, "minions/necromantic-remnant"), IMPROVISED);
  assert.equal(startingWeapon(catalog, "leaders/lich"), IMPROVISED);
  assert.equal(startingWeapon(catalog, "minions/gigantic-horror"), "colossal-weapons/improvised-weapon");
  assert.equal(startingWeapon(catalog, "leaders/ascended-undead"), "colossal-weapons/improvised-weapon");
});

test("a share link keeps its contents: a weaponless beast still decodes with the free weapon", () => {
  const link = "c4;pl0,a1,tb0,sn0;pm6,a1";
  const { gathering: g } = decodeLink(link, catalog);
  assert.deepEqual(g.models[1].weapons, [IMPROVISED]);
  assert.equal(defaultWeapon(catalog, "minions/small-beast"), IMPROVISED);
  assert.equal(encodeLink(g, catalog), link);
});

test("recruiting a beast charges its weapon too, and shows the total", () => {
  const g = campaign();
  assert.equal(recruitPrice(g, catalog, "minions/small-beast"), 65);
  const m = recruit(g, catalog, "minions/small-beast");
  assert.deepEqual(m.weapons, [CLAWS]);
  assert.equal(g.treasury, 35);
  assert.deepEqual(g.campaign.transactions.map(t => [t.type, t.item, t.obols]),
    [["recruit", "minions/small-beast", -60], ["buy", CLAWS, -5]]);
  // A minion with the free weapon pays only for itself.
  assert.equal(recruitPrice(g, catalog, "minions/corpse-husk"), 50);
  // The Forgotten Forge takes 20% off the weapon, as at the Markets, not the minion.
  buyUpgrade(g, "lair-upgrades/forgotten-forge", catalog);
  assert.equal(recruitPrice(g, catalog, "minions/small-beast"), 64);
});

test("a beast can't sell, stash or discard its last weapon for a free one", () => {
  const g = campaign();
  const m = recruit(g, catalog, "minions/large-beast");
  const held = g.treasury;
  assert.ok(weaponLocked(catalog, m, "weapons", 0));
  for (const fn of [sellGear, stashGear, discardGear]) {
    assert.throws(() => fn(g, catalog, m.uid, "weapons", 0), { code: "weaponLocked" });
  }
  assert.deepEqual(m.weapons, [CLAWS]);
  assert.equal(g.treasury, held);
  assert.notEqual(label("weaponLocked", "es"), label("weaponLocked", "en"));
  // With a second one to fall back on, either can go, and then the other is locked.
  buyGear(g, catalog, m.uid, "weapons", LARGE);
  assert.ok(!weaponLocked(catalog, m, "weapons", 0));
  assert.equal(sellGear(g, catalog, m.uid, "weapons", 0), 2);
  assert.deepEqual(m.weapons, [LARGE]);
  assert.ok(weaponLocked(catalog, m, "weapons", 0));
  // Other models aren't locked: a free weapon is theirs by right (p.36).
  assert.ok(!weaponLocked(catalog, g.models[2], "weapons", 0));
  // An older save's beast on the free weapon has nothing to lock.
  const old = { profile: "minions/small-beast", weapons: [IMPROVISED] };
  assert.ok(!weaponLocked(catalog, old, "weapons", 0));
});

/* The selling house rule. */

test("anything with a cost sells for half; a free item and treasures don't change", () => {
  assert.equal(sellValue(catalog, "miscellaneous-equipment/rope-and-hook"), 2);
  assert.equal(sellValue(catalog, "miscellaneous-equipment/banner"), 10);
  assert.equal(sellValue(catalog, "thrown-weapons/throwing-axe-or-mallet"), 2);
  assert.equal(sellValue(catalog, IMPROVISED), 0);
  const g = campaign();
  const husk = g.models[3];
  husk.weapons = [IMPROVISED];
  const held = g.treasury;
  assert.equal(sellGear(g, catalog, husk.uid, "weapons", 0), 0);
  assert.deepEqual(husk.weapons, [IMPROVISED]);
  assert.equal(g.treasury, held);
  assert.ok(!g.campaign.transactions.some(t => t.type === "sell"));
  // A free item in the stash stays too (nothing puts one there today).
  g.gearStash.push({ key: IMPROVISED, list: "weapons" });
  assert.equal(sellStashedGear(g, catalog, 0), 0);
  assert.equal(g.gearStash.length, 1);
  giveTreasure(g, "minor-treasures/mana-bottle", null);
  assert.equal(sellTreasure(g, catalog, null, 0), 10);              // p.72's fixed price
});

/* D8: deploying a sellsword (p.74). */

test("an active sellsword's cost is due, not charged, until paid", () => {
  const g = campaign();
  assert.equal(deployCosts(g, catalog).total, 0);                   // none fielded
  const s = hireSellsword(g, "sellswords/blightblade-beast-hunter", catalog);   // 30 to the roster
  assert.equal(g.treasury, 70);
  assert.equal(deployCosts(g, catalog).total, 0);                   // on the roster, in reserve
  s.status = "active";
  const c = deployCosts(g, catalog);
  assert.equal(c.total, 20);
  assert.deepEqual(c.due.map(x => x.uid), [s.uid]);
  assert.equal(g.treasury, 70);                                     // asking charges nothing
  addBattle(g, { result: "win", obols: 0 }, catalog);               // nor does logging
  assert.equal(g.treasury, 70);
  assert.equal(payDeployment(g, catalog), 20);
  assert.equal(g.treasury, 50);
  assert.deepEqual(g.campaign.transactions.map(t => [t.type, t.uid, t.obols]), [["deploy", s.uid, -20]]);
  assert.equal(deployCosts(g, catalog).total, 0);                   // paid for this battle
  assert.equal(payDeployment(g, catalog), 0);
  // The payment goes into the battle's entry, and the next battle asks again.
  addBattle(g, { result: "loss", obols: 0 }, catalog);
  assert.deepEqual(g.history.at(-1).transactions.map(t => t.type), ["deploy"]);
  assert.equal(deployCosts(g, catalog).total, 20);
});

test("the opponent's 100+ deployment limit waives it (p.74)", () => {
  const g = campaign();
  const s = hireSellsword(g, "sellswords/neoteric-arcuballista", catalog);
  s.status = "active";
  assert.equal(deployCosts(g, catalog).total, 30);
  g.campaign.opponentHigher = true;
  const c = deployCosts(g, catalog);
  assert.ok(c.waived);
  assert.equal(c.total, 0);
  assert.deepEqual(c.models.map(x => x.uid), [s.uid]);
  const held = g.treasury;
  assert.equal(payDeployment(g, catalog), 0);
  assert.equal(g.treasury, held);
  assert.deepEqual(g.campaign.transactions.filter(t => t.type === "deploy"), []);
});

test("paid during the after-battle sequence, it lands in that battle's entry", () => {
  const g = campaign();
  const s = hireSellsword(g, "sellswords/desperate-rabble", catalog);
  s.status = "active";
  startAfterBattle(g, { result: "win" });
  payDeployment(g, catalog);
  finishAfterBattle(g);
  assert.deepEqual(g.history.at(-1).transactions.map(t => [t.type, t.obols]), [["hire", -10], ["deploy", -20]]);
  assert.equal(g.history.at(-1).obols, 0);                          // what the battle brought in
});

/* D5: the corrected card lines, and only those. */

test("the five card lines follow the rulebook in both languages", () => {
  const rows = catalog.bundle.categories["special-rules"].rows;
  const lines = Object.fromEntries(rows.map(r => [r.name, [r.restrictions, r.restrictions_es]]));
  assert.deepEqual(lines["Ancient Skill"], ["Revenant", "Renacido"]);
  assert.deepEqual(lines["Threatening Aura"], ["Colossal", "Colosal"]);
  assert.deepEqual(lines["Bone Leader"], ["Leader · Bone", "Líder · Hueso"]);
  assert.deepEqual(lines["Blood Leader"], ["Leader · Blood", "Líder · Sangre"]);
  assert.deepEqual(lines["Plasm Leader"], ["Leader · Plasm", "Líder · Plasma"]);
  assert.deepEqual(lines["Bone Warrior"], ["Husk · Bone", "Cáscara · Hueso"]);
  assert.deepEqual(lines["Blood Warrior"], ["Husk · Blood", "Cáscara · Sangre"]);
  assert.deepEqual(lines["Plasm Warrior"], ["Necromantic Remnant · Plasm", "Remanente Nigromántico · Plasma"]);   // not in scope
  const horror = catalog.row("minions/gigantic-horror");
  assert.match(horror.special_rules, /Colossal Weapons list\./);
  assert.match(horror.special_rules_es, /lista de Armas Colosales\./);
});

/* The prompts' words exist in both languages. */

test("the new prompts have English and Spanish", () => {
  for (const k of ["removeTraitNote", "removeAnyway", "deployPayTitle", "deployPayNote", "deployPay", "deployNoPay",
                   "deployDueNote", "deployWaived", "tx-deploy", "removeHint", "removeHintFree"]) {
    assert.notEqual(label(k, "en"), k, k);
    assert.notEqual(label(k, "es"), label(k, "en"), k);
  }
});
