/**
 * The page's saved builder gatherings (web/js/builder/store.js on the
 * browser's localStorage), shared by the Import and Builder tabs.
 *
 * localStorage can throw (private mode, blocked site data); then the store
 * falls back to memory, so importing and building still work for the visit.
 */

import { createStore, memoryStorage } from "./builder/store.js";

let storage;
try { storage = window.localStorage; storage.getItem("x"); } catch { storage = memoryStorage(); }

export const store = createStore(storage);

/**
 * Drafts: the Builder's unsaved changes, one per gathering. Edits land here
 * first, so a player can try options and gear without committing to them;
 * Save copies the draft over the gathering, Discard drops it. Drafts are
 * kept in the browser too, so a reload doesn't lose them.
 */
const DRAFTS_KEY = "necropolis-builder-drafts-v1";
const readDrafts = () => {
  try { return JSON.parse(storage.getItem(DRAFTS_KEY) || "{}") || {}; } catch { return {}; }
};
const writeDrafts = (d) => { try { storage.setItem(DRAFTS_KEY, JSON.stringify(d)); } catch {} };

export const drafts = {
  get: (id) => readDrafts()[id] || null,
  set(g) { const d = readDrafts(); d[g.id] = g; writeDrafts(d); },
  remove(id) { const d = readDrafts(); delete d[id]; writeDrafts(d); },
};
