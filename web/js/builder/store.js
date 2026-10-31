/**
 * Saved gatherings, kept in the browser's localStorage.
 *
 * Several gatherings live side by side under one key, with the one last
 * opened remembered as `current`. The storage is passed in so the Node
 * tests can use a plain object instead of the browser's.
 */

import { FORMAT } from "./gathering.js";
import { LS } from "../sync/keys.js";
import { localChanged } from "../sync/bus.js";

const LS_KEY = LS.gatherings;
const DRAFTS_KEY = LS.drafts;

/** A Storage-like object kept in memory (tests, or when localStorage throws). */
export function memoryStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    entries: () => [...m],
  };
}

/**
 * Drafts: the Builder's unsaved changes, one per gathering. Edits land here
 * first; Save copies the draft over the gathering, Discard drops it.
 */
export function createDrafts(storage) {
  const read = () => {
    try { const v = JSON.parse(storage.getItem(DRAFTS_KEY) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
  };
  const write = (d) => { try { storage.setItem(DRAFTS_KEY, JSON.stringify(d)); } catch {} localChanged("drafts"); };
  return {
    get: (id) => read()[id] || null,
    set(g) { const d = read(); d[g.id] = g; write(d); },
    remove(id) { const d = read(); if (!(id in d)) return; delete d[id]; write(d); },
  };
}

export function createStore(storage) {
  const read = () => {
    try {
      const v = JSON.parse(storage.getItem(LS_KEY) || "null");
      if (v && typeof v === "object" && v.gatherings) return v;
    } catch {}
    return { gatherings: {}, order: [], current: null };
  };
  const write = (data) => { try { storage.setItem(LS_KEY, JSON.stringify(data)); } catch {} localChanged("gatherings"); };
  // `stamps` (id -> ms of the last save) and `tombstones` (id -> ms of the
  // delete) live beside the gatherings, not inside them, so a gathering's own
  // JSON (exports, share links, draft comparison) never changes. Missing
  // means 0: data saved before sync keeps working.
  const maps = (d) => {
    d.stamps = d.stamps && typeof d.stamps === "object" ? d.stamps : {};
    d.tombstones = d.tombstones && typeof d.tombstones === "object" ? d.tombstones : {};
    return d;
  };

  return {
    /** All saved gatherings, oldest first. */
    list() {
      const d = read();
      return d.order.map(id => d.gatherings[id]).filter(Boolean);
    },
    get(id) { return read().gatherings[id] || null; },
    current() { const d = read(); return d.gatherings[d.current] || null; },
    /** Insert or replace a gathering and make it current. */
    save(g) {
      if (g?.format !== FORMAT || !g.id) throw new Error("Not a builder gathering");
      const d = maps(read());
      if (!d.gatherings[g.id]) d.order.push(g.id);
      d.gatherings[g.id] = g;
      d.current = g.id;
      d.stamps[g.id] = Date.now();
      delete d.tombstones[g.id];
      write(d);
      return g;
    },
    remove(id) {
      const d = maps(read());
      if (d.gatherings[id]) d.tombstones[id] = Date.now();
      delete d.stamps[id];
      delete d.gatherings[id];
      d.order = d.order.filter(x => x !== id);
      if (d.current === id) d.current = d.order.at(-1) || null;
      write(d);
    },
    /** When the gathering was last saved (ms; 0 when saved before sync existed). */
    updatedAt(id) { return Number(maps(read()).stamps[id]) || 0; },
    /** { id: ms } of gatherings deleted on this device. */
    tombstones() { return { ...maps(read()).tombstones }; },
    /** Sync: store a gathering from another device with its own stamp. Keeps
     *  the current one unless nothing is open. */
    put(g, updatedAt) {
      const d = maps(read());
      if (!d.gatherings[g.id]) d.order.push(g.id);
      d.gatherings[g.id] = g;
      d.stamps[g.id] = updatedAt;
      delete d.tombstones[g.id];
      if (!d.gatherings[d.current]) d.current = g.id;
      write(d);
    },
    /** Sync: another device deleted it. */
    drop(id, at) {
      const d = maps(read());
      delete d.gatherings[id];
      delete d.stamps[id];
      d.tombstones[id] = at;
      d.order = d.order.filter(x => x !== id);
      if (d.current === id || !d.gatherings[d.current]) d.current = d.order.at(-1) || null;
      write(d);
    },
  };
}
