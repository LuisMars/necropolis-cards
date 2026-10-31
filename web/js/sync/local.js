/**
 * What sync reads from and writes to the browser's storage, as named items:
 *
 *   g:<id>   one gathering with its draft, or its delete tombstone
 *   printed  { "<key>\0<name>": count }
 *   queue    [{ key, row, override }]
 *   warband  the last Companion App import, or null
 *   prefs    { lang?, palette?, rosterSkip? }
 *
 * Also the validation of documents that came from the server: they are
 * untrusted, and nothing reaches storage unless it passes `fromDoc`.
 */

import { createStore, createDrafts } from "../builder/store.js";
import { FORMAT } from "../builder/gathering.js";
import { LS } from "./keys.js";

export const PALETTES = ["auto", "ink-bone", "obsidian", "soft-ash", "slate", "vellum"];
const GID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_JSON = 2_000_000;

/* ---- hashing: equal content, equal hash, whatever the key order ---------------- */

export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
export function hash(v) {   // cyrb53
  const s = stable(v);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + s.length.toString(36);
}

/* ---- names and ids ---------------------------------------------------------- */

export const SINGLETONS = ["printed", "queue", "warband", "prefs"];
export const isGathering = (name) => name.startsWith("g:");
export const docId = (name) => (isGathering(name) ? `necropolis-gathering:${name.slice(2)}` : `necropolis-${name}`);
export function nameOfDocId(id) {
  const m = /^necropolis-gathering:(.+)$/.exec(id);
  if (m) return GID.test(m[1]) ? `g:${m[1]}` : null;
  const s = /^necropolis-(printed|queue|warband|prefs)$/.exec(id);
  return s ? s[1] : null;
}
export const emptyValue = (name) => (name === "printed" || name === "prefs" ? {} : name === "queue" ? [] : null);
export const isEmpty = (name, v) =>
  v === undefined || (name === "queue" ? v.length === 0 : name === "warband" ? v === null : isGathering(name) ? false : Object.keys(v).length === 0);

/* ---- validation ------------------------------------------------------------- */

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const small = (v) => { try { return JSON.stringify(v).length <= MAX_JSON; } catch { return false; } };

export function validGathering(g, id) {
  if (!isObj(g) || g.format !== FORMAT || g.id !== id) return false;
  if (typeof (g.name ?? "") !== "string" || !Array.isArray(g.models) || g.models.length > 500) return false;
  for (const k of ["stash", "gearStash", "history"]) if (g[k] !== undefined && !Array.isArray(g[k])) return false;
  for (const k of ["lair", "ambitions", "campaign"]) if (g[k] !== undefined && !isObj(g[k])) return false;
  return g.models.every(isObj) && small(g);
}

function cleanPrinted(v) {
  if (!isObj(v)) return null;
  const out = {};
  for (const [k, n] of Object.entries(v)) {
    if (k.length > 300 || !Number.isFinite(n) || n < 1) continue;
    out[k] = Math.min(Math.floor(n), 100000);
  }
  return out;
}
function cleanQueue(v) {
  if (!Array.isArray(v) || v.length > 2000) return null;
  const out = [];
  for (const e of v) {
    if (!isObj(e) || typeof e.key !== "string" || !isObj(e.row)) return null;
    out.push({ key: e.key, row: e.row, ...(isObj(e.override) ? { override: e.override } : {}) });
  }
  return small(out) ? out : null;
}
function cleanPrefs(v) {
  if (!isObj(v)) return null;
  const out = {};
  if (v.lang === "en" || v.lang === "es") out.lang = v.lang;
  if (PALETTES.includes(v.palette)) out.palette = v.palette;
  if (typeof v.rosterSkip === "boolean") out.rosterSkip = v.rosterSkip;
  return out;
}

/** A server document as { name, value, at, rev }, or null when it is not one of ours or is malformed. */
export function fromDoc(doc) {
  if (!isObj(doc) || typeof doc._id !== "string" || typeof doc._rev !== "string") return null;
  const name = nameOfDocId(doc._id);
  if (!name) return null;
  const at = Number.isFinite(doc.updatedAt) && doc.updatedAt >= 0 ? doc.updatedAt : 0;
  const rev = doc._rev;
  let value = null;
  if (isGathering(name)) {
    const id = name.slice(2);
    if (doc.deleted === true) value = { deleted: true, gathering: null, draft: null };
    else if (validGathering(doc.gathering, id) && (doc.draft == null || validGathering(doc.draft, id))) {
      value = { deleted: false, gathering: doc.gathering, draft: doc.draft || null };
    }
  } else if (name === "printed") value = cleanPrinted(doc.printed);
  else if (name === "queue") value = cleanQueue(doc.queue);
  else if (name === "warband") value = doc.warband === null ? null : isObj(doc.warband) && small(doc.warband) ? doc.warband : undefined;
  else if (name === "prefs") value = cleanPrefs(doc.prefs);
  if (value === null && name !== "warband") return null;
  if (value === undefined) return null;
  return { name, value, at, rev };
}

/** The document body for an item. */
export function toDoc(name, value, at, device) {
  const base = { type: name === "prefs" ? "prefs" : isGathering(name) ? "gathering" : name, updatedAt: at, device };
  if (isGathering(name)) return { ...base, deleted: !!value.deleted, gathering: value.gathering, draft: value.draft };
  return { ...base, [name]: value };
}

/* ---- the browser's storage ----------------------------------------------------- */

const parse = (storage, key) => { try { return JSON.parse(storage.getItem(key)); } catch { return null; } };

export function createLocal(storage) {
  const store = createStore(storage);
  const drafts = createDrafts(storage);
  const del = (key) => { try { storage.removeItem ? storage.removeItem(key) : storage.setItem(key, ""); } catch {} };
  const put = (key, v) => { try { storage.setItem(key, typeof v === "string" ? v : JSON.stringify(v)); } catch {} };

  function names() {
    return [...store.list().map(g => `g:${g.id}`), ...Object.keys(store.tombstones()).map(id => `g:${id}`), ...SINGLETONS]
      .filter((n, i, a) => a.indexOf(n) === i);
  }

  /** { value, at } with `at` only known for gatherings; undefined when there is nothing. */
  function read(name) {
    if (isGathering(name)) {
      const id = name.slice(2), g = store.get(id);
      if (g) return { value: { deleted: false, gathering: g, draft: drafts.get(id) }, at: store.updatedAt(id) };
      const t = store.tombstones()[id];
      return t ? { value: { deleted: true, gathering: null, draft: null }, at: Number(t) || 0 } : undefined;
    }
    if (name === "printed") return { value: cleanPrinted(parse(storage, LS.printed)) || {} };
    if (name === "queue") return { value: cleanQueue(parse(storage, LS.queue)) || [] };
    if (name === "warband") { const w = parse(storage, LS.warband); return { value: isObj(w) ? w : null }; }
    const prefs = {};
    let v = null;
    try { v = storage.getItem(LS.lang); } catch {}
    if (v === "en" || v === "es") prefs.lang = v;
    try { v = storage.getItem(LS.palette); } catch {}
    if (PALETTES.includes(v)) prefs.palette = v;
    try { v = storage.getItem(LS.rosterSkip); } catch {}
    if (v === "1" || v === "0") prefs.rosterSkip = v === "1";
    return { value: prefs };
  }

  function write(name, value, at) {
    if (isGathering(name)) {
      const id = name.slice(2);
      if (value.deleted) { drafts.remove(id); store.drop(id, at || Date.now()); return; }
      store.put(value.gathering, at);
      if (value.draft) drafts.set(value.draft); else drafts.remove(id);
    } else if (name === "printed") put(LS.printed, value);
    else if (name === "queue") put(LS.queue, value);
    else if (name === "warband") { if (value) put(LS.warband, value); else del(LS.warband); }
    else {
      if (value.lang) put(LS.lang, value.lang);
      if (value.palette) put(LS.palette, value.palette);
      if (typeof value.rosterSkip === "boolean") put(LS.rosterSkip, value.rosterSkip ? "1" : "0");
    }
  }
  return { names, read, write, store, drafts };
}
