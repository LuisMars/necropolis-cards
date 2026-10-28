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
