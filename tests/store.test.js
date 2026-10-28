import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, memoryStorage } from "../web/js/builder/store.js";
import { newGathering } from "../web/js/builder/gathering.js";

test("saves, lists and removes gatherings", () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  const a = store.save(newGathering({ name: "A" }));
  const b = store.save(newGathering({ name: "B" }));
  assert.deepEqual(store.list().map(g => g.name), ["A", "B"]);
  assert.equal(store.current().id, b.id);

  // A second store on the same storage sees the same data (a page reload).
  const again = createStore(storage);
  assert.equal(again.get(a.id).name, "A");

  again.save({ ...again.get(a.id), name: "A2" });
  assert.deepEqual(again.list().map(g => g.name), ["A2", "B"]);
  again.remove(a.id);
  assert.deepEqual(again.list().map(g => g.name), ["B"]);
  assert.equal(again.current().id, b.id);
});

test("refuses things that aren't builder gatherings", () => {
  const store = createStore(memoryStorage());
  assert.throws(() => store.save({ covenant: "x" }));
});

test("survives corrupt storage", () => {
  const storage = memoryStorage();
  storage.setItem("necropolis-builder-gatherings-v1", "{not json");
  assert.deepEqual(createStore(storage).list(), []);
});
