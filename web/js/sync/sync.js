/**
 * Device sync through CouchDB, off until the player signs in.
 *
 * Data is split into items (see local.js): one per gathering (with its draft
 * and delete tombstone) plus printed, queue, warband and prefs. Each is one
 * CouchDB doc in the player's private db. For every item the engine keeps,
 * locally, the revision and content hash it last agreed on (`base`), so it
 * can tell what changed on each side since:
 *
 *   only this device changed  -> push
 *   only the server changed   -> adopt it silently
 *   both changed:
 *     gathering -> ask: this device / server / keep both (never auto-merged)
 *     printed   -> merge, taking the larger count per card
 *     queue, prefs, warband -> newest change wins (queue and prefs merge on
 *                              a first sync, where nothing is known to be newer)
 *
 * Data that predates sync has no base and no stamps, so on first sign-in
 * everything counts as changed on both sides and is merged or asked about,
 * never overwritten. Anything this device gives up is first copied to a small
 * local backup. A failure leaves local data untouched and is reported.
 */

import { LS } from "./keys.js";
import { onLocalChange } from "./bus.js";
import {
  createLocal, fromDoc, toDoc, docId, hash, isGathering, isEmpty, emptyValue,
} from "./local.js";
import { newGathering } from "../builder/gathering.js";

const MAX_BACKUPS = 5;
const ROUNDS = 3;

export function createSync({
  storage, client, now = () => Date.now(), delay = 1500, copyName = (n) => `${n} (other device)`,
  sleep = (ms) => new Promise(r => setTimeout(r, ms)),
} = {}) {
  const local = createLocal(storage);
  const listeners = new Set();
  let timer = null, running = null, again = false, applying = false, pulls = 0;

  /* ---- bookkeeping, kept in storage so it survives a reload --------------------- */
  const readMeta = () => {
    try {
      const m = JSON.parse(storage.getItem(LS.meta) || "null");
      if (m && typeof m === "object") return { user: null, base: {}, seen: {}, lastSyncAt: 0, device: "", ...m };
    } catch {}
    return { user: null, base: {}, seen: {}, lastSyncAt: 0, device: "" };
  };
  let meta = readMeta();
  if (!meta.device) meta.device = `d${now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const saveMeta = () => { try { storage.setItem(LS.meta, JSON.stringify(meta)); } catch {} };
  const backup = (name, value, at) => {
    try {
      const list = JSON.parse(storage.getItem(LS.backups) || "[]");
      const next = [...(Array.isArray(list) ? list : []), { at: now(), name, value, savedAt: at || 0 }].slice(-MAX_BACKUPS);
      storage.setItem(LS.backups, JSON.stringify(next));
    } catch {}
  };

  /* ---- observable state ---------------------------------------------------------- */
  const state = { phase: meta.user ? "idle" : "off", user: meta.user, error: null, conflicts: [], lastSyncAt: meta.lastSyncAt || 0, ignored: 0, pulls: 0 };
  const emit = (patch) => { Object.assign(state, patch, { pulls, user: meta.user, lastSyncAt: meta.lastSyncAt || 0 }); for (const f of listeners) { try { f({ ...state }); } catch {} } };
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  /* ---- what is local ---------------------------------------------------------- */
  /** Notice what changed since last looking; `at` is when we noticed. */
  function scan() {
    let changed = false;
    for (const name of local.names()) {
      const cur = local.read(name);
      if (!cur) continue;
      const h = hash(cur.value), seen = meta.seen[name];
      if (seen?.hash === h) continue;
      const at = isGathering(name) ? cur.at : (seen || meta.base[name] ? now() : 0);
      meta.seen[name] = { hash: h, at };
      changed = true;
    }
    if (changed) saveMeta();
  }
  /** The local side of an item: null when there is nothing worth syncing. */
  function localEntry(name) {
    const cur = local.read(name);
    if (!cur) return null;
    if (!isGathering(name) && isEmpty(name, cur.value) && !meta.base[name]) return null;
    return { value: cur.value, at: isGathering(name) ? cur.at : meta.seen[name]?.at || 0 };
  }

  const applyLocal = (name, value, at) => {
    applying = true;
    try { local.write(name, value, at); } finally { applying = false; }
    pulls++;
    meta.seen[name] = { hash: hash(local.read(name)?.value ?? emptyValue(name)), at };
  };

  /* ---- merging when both sides changed -------------------------------------------- */
  function mergeSingle(name, L, R, hasBase) {
    if (name === "printed") {
      const out = { ...L.value };
      for (const [k, n] of Object.entries(R.value)) out[k] = Math.max(out[k] || 0, n);
      return out;
    }
    if (name === "prefs") return hasBase && L.at >= R.at ? { ...R.value, ...L.value } : { ...L.value, ...R.value };
    if (name === "queue" && !hasBase) {
      const seen = new Set(), out = [];
      for (const e of [...L.value, ...R.value]) { const k = hash(e); if (!seen.has(k)) { seen.add(k); out.push(e); } }
      return out;
    }
    // warband, queue with history: newest wins; first sync, the server's
    const useLocal = hasBase && L.at > R.at;
    return useLocal ? L.value : R.value;
  }

  /* ---- one item ------------------------------------------------------------------ */
  /** Returns { conflict } or nothing; throws { code } on a failed request. */
  async function reconcile(name, R, user, decisions) {
    for (let round = 0; round < ROUNDS; round++) {
      const L = localEntry(name);
      const base = meta.base[name];
      const lh = L && hash(L.value), rh = R && hash(R.value);
      const lc = !!L && (!base || lh !== base.hash);
      const rc = !!R && (!base || R.rev !== base.rev);

      let push = null;   // { value, at }
      let adopt = null;  // { value, at }
      if (!R) { if (!L) return; push = { value: L.value, at: L.at || now() }; }
      else if (!L) adopt = R;
      else if (lh === rh) { meta.base[name] = { rev: R.rev, hash: rh }; meta.seen[name] = { hash: lh, at: L.at }; return; }
      else if (lc && !rc) push = { value: L.value, at: L.at || now() };
      else if (rc && !lc) adopt = R;
      else if (!lc && !rc) return;
      else if (isGathering(name)) {
        const choice = decisions[name];
        if (choice === "mine") push = { value: L.value, at: now() };
        else if (choice === "server") { backup(name, L.value, L.at); adopt = R; }
        else if (choice === "both") {
          if (L.value.deleted) { adopt = R; }           // nothing of ours to keep: the server's version comes back
          else {
            if (!R.value.deleted) await keepCopy(R, user);
            push = { value: L.value, at: now() };
          }
        } else return { conflict: { name, id: name.slice(2), local: brief(L), server: brief(R) } };
      } else {
        const merged = mergeSingle(name, L, R, !!base);
        const mh = hash(merged);
        if (mh !== lh) { if (!base) backup(name, L.value, L.at); applyLocal(name, merged, Math.max(L.at, R.at)); }
        if (mh === rh) { meta.base[name] = { rev: R.rev, hash: rh }; return; }
        push = { value: merged, at: now() };
      }

      if (adopt) {
        applyLocal(name, adopt.value, adopt.at);
        meta.base[name] = { rev: adopt.rev, hash: hash(adopt.value) };
        return;
      }
      const r = await client.putDoc(user, docId(name), toDoc(name, push.value, push.at, meta.device), R?.rev);
      if (r.status === "ok") {
        meta.base[name] = { rev: r.rev, hash: hash(push.value) };
        meta.seen[name] = { hash: hash(push.value), at: push.at };
        return;
      }
      if (r.status !== "conflict") throw { code: r.status };
      // Someone wrote first: read it again and decide again.
      const g = await client.getDoc(user, docId(name));
      if (g.status === "missing") R = null;
      else if (g.status === "ok") R = fromDoc(g.doc);
      else throw { code: g.status };
      if (R === null && g.status === "ok") throw { code: "error" };
    }
    throw { code: "conflict" };
  }
  const brief = (e) => ({
    name: e.value.deleted ? "" : String(e.value.gathering?.name ?? ""),
    at: e.at || 0,
    deleted: !!e.value.deleted,
    draft: !!e.value.draft,
    models: e.value.deleted ? 0 : e.value.gathering?.models?.length || 0,
  });

  /** "Keep both": the server's version becomes a second gathering here. */
  async function keepCopy(R, user) {
    const id = newGathering().id;
    const rename = (g) => g && { ...g, id, name: copyName(String(g.name || "")) };
    const value = { deleted: false, gathering: rename(R.value.gathering), draft: rename(R.value.draft) };
    const name = `g:${id}`;
    applyLocal(name, value, now());
    const r = await client.putDoc(user, docId(name), toDoc(name, value, now(), meta.device));
    if (r.status === "ok") meta.base[name] = { rev: r.rev, hash: hash(value) };
    else if (r.status !== "conflict") throw { code: r.status };
  }

  /* ---- a whole sync --------------------------------------------------------------- */
  async function run(decisions) {
    const user = meta.user;
    scan();
    emit({ phase: "syncing", error: null });
    const listed = await client.listDocs(user);
    if (listed.status !== "ok") return finish(listed.status, []);
    const remote = new Map();
    let ignored = 0;
    for (const d of listed.docs) {
      const e = fromDoc(d);
      if (e) remote.set(e.name, e);
      else if (/^necropolis-(gathering:|printed$|queue$|warband$|prefs$)/.test(d._id)) ignored++;
    }
    const names = [...new Set([...local.names(), ...remote.keys()])];
    const conflicts = [];
    let error = null;
    for (const name of names) {
      try {
        const c = await reconcile(name, remote.get(name) || null, user, decisions);
        if (c?.conflict) conflicts.push(c.conflict);
      } catch (e) {
        error = error || e?.code || "error";
      }
    }
    return finish(error, conflicts, ignored);
  }

  function finish(error, conflicts, ignored = 0) {
    if (!error) meta.lastSyncAt = now();
    saveMeta();
    const patch = error
      ? { phase: "error", error, conflicts: [], ignored }
      : conflicts.length ? { phase: "conflicts", error: null, conflicts, ignored } : { phase: "ok", error: null, conflicts: [], ignored };
    emit(patch);
    return { ...state };
  }

  /** Sync now (one at a time; a request while one runs queues one more run). */
  function sync({ decisions = {} } = {}) {
    if (!meta.user) return Promise.resolve({ ...state });
    clearTimeout(timer);
    if (running) { again = true; return running; }
    running = (async () => {
      let r;
      try { r = await run(decisions); } catch { r = finish("error", []); }
      running = null;
      if (again) { again = false; schedule(0); }
      return r;
    })();
    return running;
  }
  function schedule(ms = delay) {
    if (!meta.user) return;
    clearTimeout(timer);
    timer = setTimeout(() => { sync(); }, ms);
    timer.unref?.();
  }
  const resolve = (name, choice) => sync({ decisions: { [name]: choice } });

  /* ---- accounts ------------------------------------------------------------------- */
  async function enter(r, email) {
    if (r.status !== "ok") { emit({ phase: meta.user ? "idle" : "off", error: r.status }); return { status: r.status }; }
    meta.user = r.name;
    meta.base = {}; meta.seen = {};
    saveMeta();
    emit({ phase: "idle", error: null, conflicts: [] });
    let out = await sync();
    // couch_peruser makes the db a moment after sign-up.
    for (let i = 0; i < 3 && out.error === "notReady"; i++) { await sleep(800); out = await sync(); }
    return { status: "ok", ...out };
  }
  const signIn = async (email, password) => enter(await client.login(email, password));
  const signUp = async (email, password) => enter(await client.signup(email, password));
  async function signOut() {
    clearTimeout(timer);
    await client.logout().catch(() => {});
    meta.user = null; meta.base = {}; meta.seen = {};
    saveMeta();
    emit({ phase: "off", error: null, conflicts: [] });
  }
  /** On page load: is the cookie still good? Never changes data. */
  async function resume() {
    if (!meta.user) return;
    const s = await client.session();
    if (s.status === "ok" && s.name !== meta.user) { emit({ phase: "error", error: "unauthorized" }); return; }
    if (s.status === "ok") await sync(); else emit({ phase: "error", error: s.status });
  }

  /** Local data changed: remember when, and push soon. */
  onLocalChange(() => {
    if (applying || !meta.user) return;
    scan();
    schedule();
  });

  return { state, subscribe, sync, resolve, signIn, signUp, signOut, resume, schedule };
}
