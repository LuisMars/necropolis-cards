/**
 * Which model cards and card lists are folded on this device. Interface
 * state only: kept per model uid in its own localStorage key, never in the
 * gathering, a draft, an export, a link or a sync. Everything starts open.
 * "model" folds the whole card; the other sections are the card's lists.
 */
import { LS } from "./sync/keys.js";

const KEY = LS.fold;
let cache = null;

function load() {
  if (cache) return cache;
  cache = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    for (const [uid, secs] of Object.entries(raw || {})) {
      if (Array.isArray(secs) && secs.length) cache[uid] = secs.filter(s => typeof s === "string");
    }
  } catch { /* unreadable or blocked: everything open */ }
  return cache;
}

function save() {
  try {
    if (Object.keys(cache).length) localStorage.setItem(KEY, JSON.stringify(cache));
    else localStorage.removeItem(KEY);
  } catch { /* the fold just isn't remembered */ }
}

export const isFolded = (uid, sec) => !!load()[uid]?.includes(sec);

export function setFolded(uid, sec, folded) {
  const c = load();
  const set = new Set(c[uid] || []);
  if (folded) set.add(sec); else set.delete(sec);
  if (set.size) c[uid] = [...set]; else delete c[uid];
  save();
}

/** Forget a model (removed): its folds go with it. */
export function forgetFolds(uid) {
  if (load()[uid]) { delete cache[uid]; save(); }
}
