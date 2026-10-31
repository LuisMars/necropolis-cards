/**
 * Saved gatherings, kept in the browser's localStorage.
 *
 * Several gatherings live side by side under one key, with the one last
 * opened remembered as `current`. The storage is passed in so the Node
 * tests can use a plain object instead of the browser's.
 */

import { FORMAT } from "./gathering.js";

const LS_KEY = "necropolis-builder-gatherings-v1";

/** A Storage-like object kept in memory (tests, or when localStorage throws). */
export function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

export function createStore(storage) {
  const read = () => {
    try {
      const v = JSON.parse(storage.getItem(LS_KEY) || "null");
      if (v && typeof v === "object" && v.gatherings) return v;
    } catch {}
    return { gatherings: {}, order: [], current: null };
  };
  const write = (data) => { try { storage.setItem(LS_KEY, JSON.stringify(data)); } catch {} };

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
      const d = read();
      if (!d.gatherings[g.id]) d.order.push(g.id);
      d.gatherings[g.id] = g;
      d.current = g.id;
      write(d);
      return g;
    },
    remove(id) {
      const d = read();
      delete d.gatherings[id];
      d.order = d.order.filter(x => x !== id);
      if (d.current === id) d.current = d.order.at(-1) || null;
      write(d);
    },
  };
}
