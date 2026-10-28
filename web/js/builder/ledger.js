/**
 * The improvement ledger: every change to a model's stats from the
 * campaign, with where it came from.
 *
 *   { id, stat, amount, source: { type, key?, ref?, note? }, battle, date }
 *
 * `stat` is ap / move / violence / ranged / hp / mana / spells; `amount` is
 * signed, + always better (Violence +1 turns 7+ into 6+). `source.type` is
 * "ambition", "malady" or "manual"; `source.ref` ties the entries one event
 * wrote together, so undoing the event (un-completing an ambition, Soul
 * Binder) removes exactly those. `battle` counts the battles logged before
 * the entry was written.
 *
 * Saves from before the ledger kept bare `improvements` numbers and a
 * `maladies` list; `ledgerOf` reads them as manual and malady entries.
 */

export const LEDGER_STATS = ["ap", "move", "violence", "ranged", "hp", "mana", "spells"];

/** The model's ledger, converting a pre-ledger save on the fly (no mutation). */
export function ledgerOf(model, rules = {}) {
  if (Array.isArray(model.ledger)) return model.ledger;
  const out = [];
  let n = 0;
  for (const [stat, amount] of Object.entries(model.improvements || {})) {
    if (Number(amount)) out.push({ id: `l${++n}`, stat, amount: Number(amount), source: { type: "manual", note: "" }, battle: null, date: null });
  }
  for (const mal of model.maladies || []) {
    const ref = `m${++n}`;
    for (const e of maladyEntries(rules, mal.key, mal.stat)) {
      out.push({ id: `l${++n}`, ...e, source: { type: "malady", key: mal.key, ref }, battle: null, date: null });
    }
  }
  return out;
}

/** Turn a pre-ledger model into a ledger one, in place. */
export function migrateModel(model, rules = {}) {
  if (Array.isArray(model.ledger)) return model;
  model.ledger = ledgerOf(model, rules);
  delete model.improvements;
  delete model.maladies;
  return model;
}

/** The stat changes a malady makes (p.66): [{stat, amount}]. */
export function maladyEntries(rules, key, stat = null) {
  const def = (rules.maladies || []).find(m => m.key === key);
  if (!def) return [];
  if (def.stat_by) return stat ? [{ stat, amount: -1 }] : [];
  const changes = def.modifiers || def.improvements || {};
  return Object.entries(changes).filter(([, v]) => typeof v === "number").map(([s, v]) => ({ stat: s, amount: v }));
}

/** An id no entry of `model` uses yet. */
function nextId(model, prefix) {
  const used = new Set((model.ledger || []).flatMap(e => [e.id, e.source?.ref]));
  let n = (model.ledger || []).length + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/**
 * Write entries for `changes` ({hp: 1, violence: 1}) from one event.
 * @returns {string} the event's ref (pass it to removeRef to undo)
 */
export function addEntries(model, changes, source, { battle = null, date = null, ref = null } = {}) {
  model.ledger ||= [];
  const r = ref || nextId(model, "r");
  for (const [stat, amount] of Object.entries(changes || {})) {
    if (!Number(amount)) continue;
    model.ledger.push({ id: nextId(model, "e"), stat, amount: Number(amount), source: { ...source, ref: r }, battle, date });
  }
  return r;
}

/** Remove every entry an event wrote. */
export function removeRef(model, ref) {
  const before = (model.ledger || []).length;
  model.ledger = (model.ledger || []).filter(e => e.source?.ref !== ref);
  return before - model.ledger.length;
}

/** Remove one entry by id. */
export function removeEntry(model, id) {
  model.ledger = (model.ledger || []).filter(e => e.id !== id);
}

/** The maladies a model carries: [{ref, key, stat, battle, date}], worsening ones only. */
export function maladiesOf(model, rules = {}) {
  const byRef = new Map();
  for (const e of ledgerOf(model, rules)) {
    if (e.source?.type !== "malady" || e.amount >= 0) continue;
    if (!byRef.has(e.source.ref)) {
      byRef.set(e.source.ref, { ref: e.source.ref, key: e.source.key, stat: e.stat === "hp" ? null : e.stat, battle: e.battle, date: e.date });
    }
  }
  return [...byRef.values()];
}
