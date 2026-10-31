/** Tells device sync that local data changed (stores call it; sync listens). */
const subs = new Set();
export const onLocalChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const localChanged = (group) => { for (const f of subs) { try { f(group); } catch {} } };
