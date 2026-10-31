import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, EXAMPLE_LINK } from "./helpers.js";
import { decodeLink } from "../web/js/builder/codec.js";
import { evaluate } from "../web/js/builder/rules.js";
import { newGathering, newModel } from "../web/js/builder/gathering.js";

const codes = (ev) => ev.warnings.map(w => w.code).sort();

/** A small valid Cairn-born gathering to break one rule at a time. */
function base() {
  const g = newGathering({ covenant: "covenants/cairn-born" });
  g.models.push(newModel(g, {
    profile: "leaders/lich", affinity: "bone", mana: { bone: 4 },
    traits: ["covenant-leader-traits/osseous-sacrifice", "basic-leader-traits/combatant"],
    spells: ["spells/summon", "spells/wither", "spells/teeth", "spells/bone-spear"],
    weapons: ["melee-weapons/improvised-weapon"],
  }));
  g.models.push(newModel(g, {
    profile: "minions/skeletal-husk", affinity: "bone", weapons: ["melee-weapons/blade"],
  }));
  return g;
}

test("example gathering: costs and stats match the Companion App", () => {
  const { gathering } = decodeLink(EXAMPLE_LINK, catalog);
  const ev = evaluate(gathering, catalog);
  assert.deepEqual(ev.models.map(m => m.cost), [0, 45, 100, 80, 80, 40]);
  assert.equal(ev.total, 345);
  const lich = ev.models[0];
  assert.deepEqual(lich.stats, { ap: 2, move: 3, violence: 6, ranged: 7, hp: 15 });
  assert.equal(lich.spellsAllowed, 5);   // Summon + 3 + Studious
  assert.equal(ev.models[2].stats.violence, 5);  // Aberrant Husk, Bone
  assert.equal(ev.models[1].stats.ranged, null); // Familiar has no Ranged
});

test("example gathering: only the real problems are flagged", () => {
  const { gathering } = decodeLink(EXAMPLE_LINK, catalog);
  // 345 obols is over the 300 to build, and a link carries no mana split.
  assert.deepEqual(codes(evaluate(gathering, catalog)), ["mana-split", "over-budget"]);
});

test("a valid gathering has no warnings", () => {
  const ev = evaluate(base(), catalog);
  assert.deepEqual(ev.warnings, []);
  assert.equal(ev.models[0].stats.violence, 5);  // Bone + Combatant
});

test("gear rules", () => {
  const g = base();
  g.models[0].armour = ["armours/heavy-armour"];                      // Caster
  g.models[1].weapons = ["melee-weapons/great-weapon"];
  g.models[1].armour = ["armours/shield"];                            // 2 + 1 hands
  assert.deepEqual(codes(evaluate(g, catalog)), ["forbidden-item", "too-many-hands"]);

  const r = base();
  r.models.push(newModel(r, { profile: "minions/necromantic-remnant", affinity: "bone",
    weapons: ["melee-weapons/claws-and-fangs"] }));
  assert.deepEqual(codes(evaluate(r, catalog)), []);                  // the exception
  r.models[2].weapons = ["ranged-weapons/bow"];
  assert.deepEqual(codes(evaluate(r, catalog)), ["forbidden-item"]);
});

test("plasm affinity forbids heavy armour", () => {
  const g = newGathering({ covenant: "wretched-undead" });
  g.models.push(newModel(g, { profile: "minions/aberrant-husk", affinity: "plasm",
    weapons: ["melee-weapons/blade"], armour: ["armours/heavy-armour"] }));
  const ev = evaluate(g, catalog);
  assert.ok(codes(ev).includes("forbidden-item"));
  assert.equal(ev.models[0].stats.hp, 10);
  assert.ok(ev.models[0].keywords.includes("Fly"));
});

test("covenant rules", () => {
  const g = base();
  g.models.push(newModel(g, { profile: "minions/ghast-husk", weapons: ["melee-weapons/blade"] }));
  assert.ok(codes(evaluate(g, catalog)).includes("covenant-keyword"));   // Plasm in Cairn-born

  const m = base();
  m.models[0].traits = ["basic-leader-traits/combatant"];
  assert.deepEqual(codes(evaluate(m, catalog)), ["covenant-leader-trait-missing"]);

  const w = base();
  w.models[1].traits = ["wretched-undead-traits/acolyte"];
  w.models.push(newModel(w, { profile: "minions/skeletal-husk", traits: ["covenant-wretched-traits/adamant-structure"],
    weapons: ["melee-weapons/blade"] }));
  assert.deepEqual(codes(evaluate(w, catalog)), ["covenant-traits"]);    // 2 of 1
  w.covenant = "wretched-undead";
  w.models[0].traits = ["basic-leader-traits/combatant"];
  w.models[2].traits = ["wretched-undead-traits/gnarled"];
  assert.deepEqual(codes(evaluate(w, catalog)), []);                     // Wretched Undead: 2
});

test("traits, spells and uniques", () => {
  const g = base();
  g.models[1].traits = ["wretched-undead-traits/balefire-body"];          // Plasm only
  g.models.push(newModel(g, { profile: "minions/familiar", affinity: "bone", weapons: ["melee-weapons/claws-and-fangs"] }));
  g.models.push(newModel(g, { profile: "minions/familiar", affinity: "bone", weapons: ["melee-weapons/claws-and-fangs"] }));
  g.models[0].spells = ["spells/wither"];
  assert.deepEqual(codes(evaluate(g, catalog)),
    ["spell-count", "summon-missing", "trait-requirement", "unique-model"]);
});

test("revenant caps and the budget bonus from Miserly", () => {
  const g = newGathering({ covenant: "wretched-undead" });
  g.models.push(newModel(g, {
    profile: "leaders/revenant", affinity: "blood", mana: { blood: 2, bone: 1 },
    traits: ["basic-leader-traits/miserly"],
    spells: ["spells/summon", "spells/flare"], weapons: ["melee-weapons/great-weapon"],
  }));
  const ev = evaluate(g, catalog);
  assert.deepEqual(ev.warnings, []);
  assert.equal(ev.budget, 350);
  assert.equal(ev.models[0].stats.hp, 19);  // Blood +2
});
