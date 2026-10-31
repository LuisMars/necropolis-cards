import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeCouch, BASE } from "./fake-couch.js";
import { createSync } from "../web/js/sync/sync.js";
import { createCouchClient, configuredUrl, userDbName } from "../web/js/sync/couch.js";
import { createStore, createDrafts, memoryStorage } from "../web/js/builder/store.js";
import { newGathering } from "../web/js/builder/gathering.js";
import { LS } from "../web/js/sync/keys.js";
import { fromDoc } from "../web/js/sync/local.js";

const EMAIL = "Player@Example.com", PW = "correct horse battery";
let t = 1_000_000;
const clock = () => (t += 100);

function device(server, extra = {}) {
  const storage = memoryStorage();
  const client = createCouchClient({ baseUrl: BASE, fetch: server.fetchFor() });
  const sync = createSync({ storage, client, now: clock, delay: 1e9, sleep: async () => {}, copyName: n => `${n} (other)`, ...extra });
  return {
    storage, sync, store: createStore(storage), drafts: createDrafts(storage),
    names: () => createStore(storage).list().map(g => g.name).sort(),
    json: (key) => JSON.parse(storage.getItem(key) || "null"),
  };
}
const gathering = (name, extra = {}) => newGathering({ name, ...extra });
/** Two devices of one account, both signed in. */
async function pair(server) {
  const a = device(server), b = device(server);
  assert.equal((await a.sync.signUp(EMAIL, PW)).status, "ok");
  assert.equal((await b.sync.signIn(EMAIL, PW)).status, "ok");
  return { a, b };
}

test("signed out: no request ever leaves the device", async () => {
  const server = createFakeCouch();
  const a = device(server);
  a.store.save(gathering("Quiet"));
  await a.sync.sync();
  a.sync.schedule(0);
  assert.equal(server.log.length, 0);
  assert.equal(a.sync.state.phase, "off");
});

test("sign up uploads existing local data (migration) and never stores the password", async () => {
  const server = createFakeCouch();
  const a = device(server);
  // Data from before sync: no stamps, no tombstones.
  const g = gathering("Old band");
  a.storage.setItem(LS.gatherings, JSON.stringify({ gatherings: { [g.id]: g }, order: [g.id], current: g.id }));
  a.storage.setItem(LS.printed, JSON.stringify({ "spells\0Fulminate": 2 }));
  a.storage.setItem(LS.queue, JSON.stringify([{ key: "spells", row: { name: "Fulminate" } }]));
  a.storage.setItem(LS.lang, "es");
  const r = await a.sync.signUp(EMAIL, PW);
  assert.equal(r.status, "ok");
  assert.equal(a.sync.state.phase, "ok");
  const docs = server.docs("player@example.com");
  assert.deepEqual([...docs.keys()].sort(), [`necropolis-gathering:${g.id}`, "necropolis-prefs", "necropolis-printed", "necropolis-queue"].sort());
  assert.equal(docs.get(`necropolis-gathering:${g.id}`).gathering.name, "Old band");
  assert.equal(docs.get("necropolis-prefs").prefs.lang, "es");
  assert.equal(a.store.get(g.id).name, "Old band");
  for (const [k, v] of a.storage.entries()) assert.ok(!String(v).includes(PW), k);
  assert.ok(!JSON.stringify(server.log.filter(x => !x.path.startsWith("/_users") && x.path !== "/_session")).includes(PW));
  assert.ok(!(a.storage.getItem(LS.meta) || "").includes(PW));
});

test("a second device signs in and receives everything silently", async () => {
  const server = createFakeCouch();
  const a = device(server);
  a.store.save(gathering("One"));
  a.store.save(gathering("Two"));
  a.drafts.set({ ...a.store.current(), name: "Two draft" });
  a.storage.setItem(LS.palette, "vellum");
  await a.sync.signUp(EMAIL, PW);
  const b = device(server);
  await b.sync.signIn(EMAIL, PW);
  assert.equal(b.sync.state.phase, "ok");
  assert.deepEqual(b.names(), ["One", "Two"]);
  assert.equal(b.drafts.get(a.store.current().id).name, "Two draft");
  assert.equal(b.storage.getItem(LS.palette), "vellum");
  assert.equal(b.sync.state.conflicts.length, 0);
});

test("only one side changed: adopted silently, both directions", async () => {
  const server = createFakeCouch();
  const { a, b } = await pair(server);
  const g = a.store.save(gathering("Shared"));
  await a.sync.sync(); await b.sync.sync();
  assert.deepEqual(b.names(), ["Shared"]);
  a.store.save({ ...g, name: "Renamed on A" });
  await a.sync.sync(); await b.sync.sync();
  assert.equal(b.store.get(g.id).name, "Renamed on A");
  b.store.save({ ...b.store.get(g.id), name: "Renamed on B" });
  await b.sync.sync(); await a.sync.sync();
  assert.equal(a.store.get(g.id).name, "Renamed on B");
  assert.equal(a.sync.state.phase, "ok");
  assert.ok(a.store.updatedAt(g.id) > 0);
});

test("both changed a gathering: nothing moves until the player chooses", async () => {
  const server = createFakeCouch();
  const { a, b } = await pair(server);
  const g = a.store.save(gathering("Base"));
  await a.sync.sync(); await b.sync.sync();
  a.store.save({ ...g, name: "From A" });
  b.store.save({ ...g, name: "From B" });
  await a.sync.sync();
  const r = await b.sync.sync();
  assert.equal(r.phase, "conflicts");
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].local.name, "From B");
  assert.equal(r.conflicts[0].server.name, "From A");
  assert.equal(b.store.get(g.id).name, "From B");                       // untouched
  assert.equal(server.docs("player@example.com").get(`necropolis-gathering:${g.id}`).gathering.name, "From A");
  return { a, b, g, server };
});

test("conflict: keep this device", async () => {
  const server = createFakeCouch();
  const { a, b } = await pair(server);
  const g = a.store.save(gathering("Base"));
  await a.sync.sync(); await b.sync.sync();
  a.store.save({ ...g, name: "From A" }); b.store.save({ ...g, name: "From B" });
  await a.sync.sync(); await b.sync.sync();
  const r = await b.sync.resolve(`g:${g.id}`, "mine");
  assert.equal(r.phase, "ok");
  assert.equal(server.docs("player@example.com").get(`necropolis-gathering:${g.id}`).gathering.name, "From B");
  await a.sync.sync();
  assert.equal(a.store.get(g.id).name, "From B");
});

test("conflict: keep the server's, and the replaced one is backed up locally", async () => {
  const server = createFakeCouch();
  const { a, b } = await pair(server);
  const g = a.store.save(gathering("Base"));
  await a.sync.sync(); await b.sync.sync();
  a.store.save({ ...g, name: "From A" }); b.store.save({ ...g, name: "From B" });
  await a.sync.sync(); await b.sync.sync();
  const r = await b.sync.resolve(`g:${g.id}`, "server");
  assert.equal(r.phase, "ok");
  assert.equal(b.store.get(g.id).name, "From A");
  const backups = b.json(LS.backups);
  assert.equal(backups.at(-1).value.gathering.name, "From B");
});

test("conflict: keep both makes a copy and loses nothing", async () => {
  const server = createFakeCouch();
  const { a, b } = await pair(server);
  const g = a.store.save(gathering("Base"));
  await a.sync.sync(); await b.sync.sync();
  a.store.save({ ...g, name: "From A" }); b.store.save({ ...g, name: "From B" });
  await a.sync.sync(); await b.sync.sync();
  const r = await b.sync.resolve(`g:${g.id}`, "both");
  assert.equal(r.phase, "ok");
  assert.deepEqual(b.names(), ["From A (other)", "From B"]);
  await a.sync.sync();
  assert.deepEqual(a.names(), ["From A (other)", "From B"]);
  assert.equal(server.docs("player@example.com").size, 2);               // the original and the copy
});

test("deleting syncs as a tombstone; a delete never wipes a newer edit", async () => {
  const server = createFakeCouch();
  const { a, b } = await pair(server);
  const g = a.store.save(gathering("Doomed"));
  const keep = a.store.save(gathering("Kept"));
  await a.sync.sync(); await b.sync.sync();
  a.store.remove(g.id);
  assert.ok(a.store.tombstones()[g.id] > 0);
  await a.sync.sync(); await b.sync.sync();
  assert.deepEqual(b.names(), ["Kept"]);
  assert.ok(b.store.tombstones()[g.id]);
  assert.equal(server.docs("player@example.com").get(`necropolis-gathering:${g.id}`).deleted, true);

  // Delete on A, edit on B: a conflict, and the edit survives.
  a.store.remove(keep.id);
  b.store.save({ ...b.store.get(keep.id), name: "Kept, edited" });
  await a.sync.sync();
  const r = await b.sync.sync();
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].server.deleted, true);
  assert.equal(b.store.get(keep.id).name, "Kept, edited");
  await b.sync.resolve(`g:${keep.id}`, "mine");
  await a.sync.sync();
  assert.equal(a.store.get(keep.id).name, "Kept, edited");                 // undeleted
});

test("printed counts merge by max, in both directions", async () => {
  const server = createFakeCouch();
  const { a, b } = await pair(server);
  a.storage.setItem(LS.printed, JSON.stringify({ x: 2, y: 1 }));
  b.storage.setItem(LS.printed, JSON.stringify({ x: 1, z: 4 }));
  await a.sync.sync();
  const r = await b.sync.sync();
  assert.equal(r.phase, "ok");
  assert.deepEqual(b.json(LS.printed), { x: 2, y: 1, z: 4 });
  await a.sync.sync();
  assert.deepEqual(a.json(LS.printed), { x: 2, y: 1, z: 4 });
});

test("queue, warband and prefs: the newer change wins", async () => {
  const server = createFakeCouch();
  const { a, b } = await pair(server);
  const q = (n) => JSON.stringify([{ key: "spells", row: { name: n } }]);
  a.storage.setItem(LS.queue, q("A")); a.storage.setItem(LS.warband, JSON.stringify({ covenant: "a" }));
  a.storage.setItem(LS.lang, "es");
  await a.sync.sync(); await b.sync.sync();
  assert.equal(b.json(LS.queue)[0].row.name, "A");
  // B changes later than A.
  a.storage.setItem(LS.queue, q("A2")); a.storage.setItem(LS.lang, "en");
  b.storage.setItem(LS.queue, q("B2")); b.storage.setItem(LS.lang, "es");
  await a.sync.sync();                       // A first (older)
  await b.sync.sync();                       // B later: newest wins everywhere
  await a.sync.sync();
  assert.equal(a.json(LS.queue)[0].row.name, "B2");
  assert.equal(b.json(LS.queue)[0].row.name, "B2");
  assert.equal(a.storage.getItem(LS.lang), "en");   // only A changed it; B only repeated the old value
  assert.equal(b.storage.getItem(LS.lang), "en");
  assert.equal(b.json(LS.warband).covenant, "a");
});

test("first sync with data on both sides merges and never overwrites", async () => {
  const server = createFakeCouch();
  const a = device(server);
  const shared = gathering("Shared band");
  const onlyA = gathering("Only A");
  a.store.save(shared); a.store.save(onlyA);
  a.storage.setItem(LS.printed, JSON.stringify({ x: 5 }));
  a.storage.setItem(LS.queue, JSON.stringify([{ key: "k", row: { name: "A" } }]));
  await a.sync.signUp(EMAIL, PW);
  // A fresh device already holds different data, and the same gathering id edited.
  const b = device(server);
  b.store.save({ ...shared, name: "Shared band, edited on B" });
  b.store.save(gathering("Only B"));
  b.storage.setItem(LS.printed, JSON.stringify({ x: 1, y: 3 }));
  b.storage.setItem(LS.queue, JSON.stringify([{ key: "k", row: { name: "B" } }]));
  const r = await b.sync.signIn(EMAIL, PW);
  assert.equal(r.phase, "conflicts");
  assert.equal(r.conflicts.length, 1);                                      // only the shared id
  assert.deepEqual(b.names(), ["Only A", "Only B", "Shared band, edited on B"]);
  assert.deepEqual(b.json(LS.printed), { x: 5, y: 3 });
  assert.deepEqual(b.json(LS.queue).map(e => e.row.name).sort(), ["A", "B"]);
  assert.equal(server.docs("player@example.com").get(`necropolis-gathering:${shared.id}`).gathering.name, "Shared band");
  const docs = server.docs("player@example.com");
  assert.ok(docs.has(`necropolis-gathering:${onlyA.id}`));
});

test("identical data on both sides is not a conflict", async () => {
  const server = createFakeCouch();
  const a = device(server);
  const g = gathering("Same");
  a.store.save(g);
  await a.sync.signUp(EMAIL, PW);
  const b = device(server);
  b.store.save(g);
  const r = await b.sync.signIn(EMAIL, PW);
  assert.equal(r.phase, "ok");
});

test("failures are reported and leave local data untouched", async () => {
  const server = createFakeCouch();
  const { a } = await pair(server);
  const g = a.store.save(gathering("Safe"));
  a.storage.setItem(LS.printed, JSON.stringify({ k: 1 }));
  const before = [LS.gatherings, LS.printed].map(k => a.storage.getItem(k));

  server.down = true;
  assert.equal((await a.sync.sync()).error, "offline");
  server.down = false;
  for (const [status, code] of [[500, "offline"], [401, "unauthorized"], [403, "forbidden"], [418, "error"]]) {
    server.status = status;
    const r = await a.sync.sync();
    assert.equal(r.phase, "error");
    assert.equal(r.error, code);
  }
  server.status = null;
  assert.deepEqual([LS.gatherings, LS.printed].map(k => a.storage.getItem(k)), before);
  assert.equal((await a.sync.sync()).phase, "ok");                          // and recovers
  assert.ok(a.store.get(g.id));
});

test("a failed request on one item does not stop the others", async () => {
  const server = createFakeCouch();
  const { a } = await pair(server);
  a.store.save(gathering("Big"));
  a.storage.setItem(LS.printed, JSON.stringify({ k: 1 }));
  server.beforePut = (db, id) => { if (id === "necropolis-printed") throw new TypeError("boom"); };
  const r = await a.sync.sync();
  assert.equal(r.phase, "error");
  assert.equal(r.error, "offline");
  assert.equal(server.docs("player@example.com").size, 1);                  // the gathering still went up
});

test("a write race (409) is retried after reading the newer doc", async () => {
  const server = createFakeCouch();
  const { a, b } = await pair(server);
  const g = a.store.save(gathering("Race"));
  await a.sync.sync(); await b.sync.sync();
  a.store.save({ ...g, name: "A edit" });
  // Meanwhile B wins the race to the server.
  let raced = false;
  server.beforePut = (db, id) => {
    if (raced || !id.startsWith("necropolis-gathering")) return;
    raced = true;
    const cur = db.get(id);
    db.set(id, { ...cur, _rev: `${Number(cur._rev.split("-")[0]) + 1}-ffffffff`, gathering: { ...cur.gathering, name: "B won" }, updatedAt: 1 });
  };
  const r = await a.sync.sync();
  assert.equal(r.phase, "conflicts");                                       // both changed: asked, not overwritten
  assert.equal(a.store.get(g.id).name, "A edit");
});

test("server documents are validated before they reach storage", async () => {
  const server = createFakeCouch();
  const { a, b } = await pair(server);
  a.store.save(gathering("Fine"));
  await a.sync.sync();
  const docs = server.docs("player@example.com");
  docs.set("necropolis-gathering:evil", { _id: "necropolis-gathering:evil", _rev: "1-a", gathering: { format: "necropolis-gathering", id: "other", models: [] } });
  docs.set("necropolis-gathering:bad2", { _id: "necropolis-gathering:bad2", _rev: "1-a", gathering: "<img src=x onerror=alert(1)>" });
  docs.set("necropolis-gathering:../x", { _id: "necropolis-gathering:../x", _rev: "1-a", gathering: gathering("Path", { id: "../x" }) });
  docs.set("necropolis-printed", { _id: "necropolis-printed", _rev: "1-a", printed: { good: 2, neg: -1, str: "9", huge: 1e12, nan: null } });
  docs.set("necropolis-queue", { _id: "necropolis-queue", _rev: "1-a", queue: "not a list" });
  docs.set("necropolis-prefs", { _id: "necropolis-prefs", _rev: "1-a", prefs: { lang: "fr", palette: "<x>", rosterSkip: "yes" } });
  docs.set("someone-elses-doc", { _id: "someone-elses-doc", _rev: "1-a" });
  const r = await b.sync.sync();
  assert.equal(r.phase, "ok");
  assert.equal(r.ignored >= 3, true);
  assert.deepEqual(b.names(), ["Fine"]);
  assert.deepEqual(b.json(LS.printed), { good: 2, huge: 100000 });
  assert.equal(b.storage.getItem(LS.queue), null);
  assert.equal(b.storage.getItem(LS.lang), null);
  assert.equal(b.storage.getItem(LS.palette), null);
  assert.equal(fromDoc({ _id: "necropolis-prefs", _rev: "1", prefs: { palette: "vellum" } }).value.palette, "vellum");
});

test("sign in errors: wrong password, taken name, db not ready yet", async () => {
  const server = createFakeCouch();
  const a = device(server);
  await a.sync.signUp(EMAIL, PW);
  const b = device(server);
  assert.equal((await b.sync.signIn(EMAIL, "nope")).status, "unauthorized");
  assert.equal((await b.sync.signUp(EMAIL, "another password")).status, "conflict");
  assert.equal(b.sync.state.phase, "off");

  const s2 = createFakeCouch();
  s2.notReady = 1;
  const c = device(s2);
  const r = await c.sync.signUp("new@example.com", PW);
  assert.equal(r.status, "ok");
  assert.equal(c.sync.state.phase, "ok");                                   // retried after notReady
});

test("sign out keeps local data and stops all requests", async () => {
  const server = createFakeCouch();
  const { a } = await pair(server);
  const g = a.store.save(gathering("Stays"));
  await a.sync.sync();
  await a.sync.signOut();
  const n = server.log.length;
  a.store.save({ ...g, name: "Offline edit" });
  await a.sync.sync();
  assert.equal(server.log.length, n);
  assert.equal(a.store.get(g.id).name, "Offline edit");
  assert.equal(a.sync.state.user, null);
});

test("an expired session is reported on resume, data untouched", async () => {
  const server = createFakeCouch();
  const { a } = await pair(server);
  a.store.save(gathering("Local"));
  const again = createSync({ storage: a.storage, client: createCouchClient({ baseUrl: BASE, fetch: server.fetchFor() }), now: clock, delay: 1e9 });
  await again.resume();                          // a new browser session: no cookie
  assert.equal(again.state.phase, "error");
  assert.equal(again.state.error, "unauthorized");
  assert.deepEqual(a.names(), ["Local"]);
});

test("couch client: user db name, server override, no server means no request", async () => {
  assert.equal(userDbName("A@b.c"), "userdb-6140622e63");
  const doc = (content) => ({ querySelector: () => (content === undefined ? null : { getAttribute: () => content }) });
  assert.equal(configuredUrl({ doc: doc() }), "https://couch.luismars.com");
  assert.equal(configuredUrl({ doc: doc("https://x.example/") }), "https://x.example");
  assert.equal(configuredUrl({ doc: doc("") }), "");
  let called = false;
  const c = createCouchClient({ baseUrl: "", fetch: async () => { called = true; } });
  assert.equal((await c.login("a@b.c", "x")).status, "error");
  assert.equal(called, false);
});

test("store: stamps and tombstones leave the gathering itself unchanged and old data working", () => {
  const storage = memoryStorage();
  const g = newGathering({ name: "Plain" });
  storage.setItem(LS.gatherings, JSON.stringify({ gatherings: { [g.id]: g }, order: [g.id], current: g.id }));
  const store = createStore(storage);
  assert.equal(store.updatedAt(g.id), 0);
  const saved = store.save({ ...g, name: "Plain 2" });
  assert.equal("updatedAt" in saved, false);
  assert.ok(store.updatedAt(g.id) > 0);
  store.remove(g.id);
  assert.ok(store.tombstones()[g.id] > 0);
  assert.equal(store.updatedAt(g.id), 0);
  assert.equal(store.get(g.id), null);
});
