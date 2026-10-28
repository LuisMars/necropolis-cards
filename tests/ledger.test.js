import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, EXAMPLE_LINK } from "./helpers.js";
import { decodeLink } from "../web/js/builder/codec.js";
import { evaluate } from "../web/js/builder/rules.js";
import { ledgerOf, migrateModel, maladiesOf } from "../web/js/builder/ledger.js";
import {
  ensureCampaign, startCampaign, completeAmbition, undoAmbition, addManualEntry, removeLedgerEntry,
  buyUpgrade, startAfterBattle, applyMalady,
} from "../web/js/builder/campaign.js";

function campaign() {
  const { gathering: g } = decodeLink(EXAMPLE_LINK, catalog);
  g.models[0].mana = { bone: 4 };
  g.models.splice(3, 2);
  startCampaign(g, catalog, { alreadyBuilt: true });
  return g;
}
const ev = (g) => evaluate(g, catalog);

test("an ambition's reward is ledger entries naming it, and undo removes them", () => {
  const g = campaign();
  completeAmbition(g, "ambitions/rain-iron-sleet", catalog, "m3");
  const [e] = g.models[2].ledger;
  assert.deepEqual([e.stat, e.amount, e.source.type, e.source.key], ["ranged", 1, "ambition", "ambitions/rain-iron-sleet"]);
  assert.equal(ev(g).models[2].stats.ranged, 6);
  const log = g.ambitions.log.at(-1);
  assert.ok(undoAmbition(g, log.id, catalog));
  assert.deepEqual(g.models[2].ledger, []);
  assert.equal(ev(g).models[2].stats.ranged, 7);
  assert.equal(g.ambitions.completed, 0);
  assert.equal(g.ambitions.progress["ambitions/rain-iron-sleet"], 2);   // back at its goal
});

test("undo reverses gathering-wide rewards too", () => {
  const g = campaign();
  completeAmbition(g, "ambitions/test-the-limits-of-undeath", catalog);
  completeAmbition(g, "ambitions/build-a-sanctuary", catalog);
  completeAmbition(g, "ambitions/strike-down-the-horrors", catalog);
  assert.deepEqual(ev(g).models.map(m => m.stats.hp), [16, 7, 13, 7]);
  assert.equal(ev(g).deploymentLimit, 400);
  for (const e of [...g.ambitions.log]) undoAmbition(g, e.id, catalog);
  assert.deepEqual(ev(g).models.map(m => m.stats.hp), [15, 6, 12, 6]);
  assert.equal(ev(g).deploymentLimit, 350);
  assert.equal(g.bonusTraits, 0);
});

test("every stat lists the sources behind it", () => {
  const g = campaign();
  buyUpgrade(g, "lair-upgrades/arcane-library", catalog);
  completeAmbition(g, "ambitions/search-for-ancient-lore", catalog);
  addManualEntry(g, "m1", "hp", 2, "painted a new head");
  const lich = ev(g).models[0];
  assert.deepEqual(lich.sources.violence.map(s => [s.type, s.amount]), [["affinity", 1]]);          // Bone
  assert.deepEqual(lich.sources.spells.map(s => [s.type, s.key, s.amount]),
    [["trait", "basic-leader-traits/studious", 1], ["lair", "lair-upgrades/arcane-library", 1],
     ["ambition", "ambitions/search-for-ancient-lore", 1]]);
  assert.deepEqual(lich.sources.hp.map(s => [s.type, s.note, s.amount]), [["manual", "painted a new head", 2]]);
  assert.equal(lich.stats.hp, 17);
  assert.equal(lich.spellsAllowed, 7);
  removeLedgerEntry(g, "m1", lich.sources.hp[0].id);
  assert.equal(ev(g).models[0].stats.hp, 15);
});

test("the improvement cap names the source that broke it", () => {
  const g = campaign();
  completeAmbition(g, "ambitions/settle-old-grudges", catalog, "m3");
  completeAmbition(g, "ambitions/settle-old-grudges", catalog, "m3");
  assert.deepEqual(ev(g).warnings, []);                                  // +2 is the limit
  addManualEntry(g, "m3", "violence", 1, "house rule");
  const w = ev(g).warnings.find(x => x.code === "improvement-cap");
  assert.deepEqual([w.model, w.params.stat, w.params.source], ["m3", "violence", "manual"]);
});

test("maladies are entries; battle and date say when", () => {
  const g = campaign();
  startAfterBattle(g, { date: "2026-11-02", leaderShattered: true });
  applyMalady(g, catalog, 2, { stat: "move" });
  const [mal] = maladiesOf(g.models[0], catalog.rules);
  assert.deepEqual([mal.key, mal.stat, mal.battle, mal.date], ["cursed-form", "move", 1, "2026-11-02"]);
  assert.equal(ev(g).models[0].stats.move, 2);
});

test("pre-ledger saves convert: improvements → manual, maladies → malady entries", () => {
  const m = { uid: "m1", profile: "leaders/lich", improvements: { hp: 2, violence: 1 },
              maladies: [{ key: "frail" }, { key: "incomplete-form", stat: "ranged" }] };
  const entries = ledgerOf(m, catalog.rules);
  assert.deepEqual(entries.map(e => [e.stat, e.amount, e.source.type]),
    [["hp", 2, "manual"], ["violence", 1, "manual"], ["hp", -1, "malady"], ["ranged", -1, "malady"]]);
  assert.equal(maladiesOf(m, catalog.rules).length, 2);
  migrateModel(m, catalog.rules);
  assert.equal(m.improvements, undefined);
  assert.equal(m.ledger.length, 4);
  const g = { models: [{ uid: "m1", profile: "leaders/lich", improvements: { hp: 1 } }] };
  ensureCampaign(g, catalog);
  assert.equal(g.models[0].ledger[0].source.type, "manual");
});
