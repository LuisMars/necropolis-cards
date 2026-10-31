/** Common tiny helpers. */

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;",
  }[c]));
}

export const $  = (id) => document.getElementById(id);

/** Text for search: accents and case dropped, spaces collapsed ("Maná" → "mana"). */
export const foldText = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();

/* A redraw that lands between a button's mousedown and mouseup replaces the
 * button under the pointer, and its click never fires (a name field's change
 * on blur is the usual trigger). `whenPointerFree` runs `fn` on the next tick,
 * or, while a pointer is pressed, just after it is released: the timer set
 * on pointerup runs after that press's click. */
let pressed = false;
let waiting = [];
const release = () => {
  pressed = false;
  const run = waiting;
  waiting = [];
  if (run.length) setTimeout(() => run.forEach(f => f()), 0);
};
if (typeof addEventListener === "function") {
  addEventListener("pointerdown", () => { pressed = true; }, true);
  addEventListener("pointerup", release, true);
  addEventListener("pointercancel", release, true);
  addEventListener("blur", release);
}
export function whenPointerFree(fn) {
  if (!pressed) { setTimeout(fn, 0); return; }
  if (!waiting.includes(fn)) waiting.push(fn);
  // A release outside the page never reaches us: don't wait forever.
  setTimeout(() => { if (waiting.includes(fn)) release(); }, 1000);
}
