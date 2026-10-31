/**
 * Themed dropdowns: progressive enhancement over native <select>.
 *
 *   import { enhanceSelects, observeSelects } from "./select.js";
 *   observeSelects(document);            // enhance now + anything rendered later
 *
 * The native <select> stays in the DOM and in the form as the source of
 * truth: it keeps its id, name, data-* attributes and value. It is hidden
 * visually and from assistive tech; a WAI-ARIA "select-only combobox"
 * trigger and a portal listbox stand in for it. Choosing an option sets
 * select.value and dispatches bubbling `input` + `change` on the native
 * select, so delegated listeners (data-act, …) keep working unchanged.
 *
 * Skipped: select[data-native], select[multiple], select[size].
 * select.css is screen-only and has no print rules: the trigger and popup
 * carry `hidden`, which only the screen styles override, so print shows the
 * native select exactly as before.
 *
 * Coarse pointers (touch) keep the native picker, only restyled, unless
 * { force: true } is passed.
 *
 * Long lists (more than 12 options) get a filter field at the top of the
 * popup. Options may carry data-reason (or title): shown muted under the
 * label and exposed as the option's accessible description.
 */

import { foldText as norm } from "./util.js";

const SKIP = "[data-native],[multiple],[size]";
const FILTER_OVER = 12;          // > this many options: show the filter field
const MARGIN = 8;                // keep the popup this far from viewport edges
const GAP = 4;                   // space between trigger and popup
const MAX_H = 380;               // popup height cap
const PAGE = 10;                 // PageUp / PageDown step
const TYPE_MS = 600;             // type-ahead buffer lifetime

const instances = new WeakMap(); // select -> instance
let uid = 0;
let current = null;              // the open instance, if any

const proto = HTMLSelectElement.prototype;
const VALUE = Object.getOwnPropertyDescriptor(proto, "value");
const INDEX = Object.getOwnPropertyDescriptor(proto, "selectedIndex");

const optText = o => String(o.label || o.text || "").replace(/\s+/g, " ").trim();
const isCoarse = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const el = (tag, cls, attrs = {}) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/**
 * Enhance every eligible <select> in `root` (or `root` itself).
 * @param {ParentNode|Element} [root=document]
 * @param {{force?: boolean, filterPlaceholder?: string, noMatches?: string}} [opts]
 *   force: enhance even on coarse pointers.
 *   filterPlaceholder / noMatches: UI strings (per select: data-filter-placeholder,
 *   data-no-matches).
 * @returns {HTMLSelectElement[]} the selects enhanced by this call
 */
export function enhanceSelects(root = document, opts = {}) {
  const found = [];
  if (root instanceof HTMLSelectElement) found.push(root);
  root.querySelectorAll?.("select").forEach(s => found.push(s));
  const done = [];
  const coarse = !opts.force && isCoarse();
  for (const s of found) {
    if (instances.has(s) || s.matches(SKIP)) continue;
    if (coarse) { s.classList.add("nc-select-native"); continue; }
    enhance(s, opts);
    done.push(s);
  }
  return done;
}

/**
 * Enhance now, then keep enhancing selects added under `root` and drop
 * wrappers whose select was removed. Returns a function that stops observing.
 */
export function observeSelects(root = document, opts = {}) {
  enhanceSelects(root, opts);
  const target = root.nodeType === 9 ? root.documentElement : root;
  const mo = new MutationObserver(muts => {
    let removed = false;
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeType === 1) enhanceSelects(n, opts);
      if (m.removedNodes.length) removed = true;
    }
    if (!removed) return;
    if (current && !current.select.isConnected) close(current, false);
    target.querySelectorAll(".nc-select").forEach(w => {
      if (!w.querySelector(":scope > select")) w.remove();
    });
  });
  mo.observe(target, { childList: true, subtree: true });
  return () => mo.disconnect();
}

/** Re-read a select's options, value and state (rarely needed: it's automatic). */
export function refreshSelect(select) {
  const inst = instances.get(select);
  if (inst) sync(inst, true);
}

/* ------------------------------------------------------------------ */

function enhance(select, opts) {
  const id = `nc-select-${++uid}`;
  const wrap = el("span", "nc-select");
  const trigger = el("div", "nc-select-trigger", {
    id: `${id}-trigger`, role: "combobox", tabindex: "0",
    "aria-haspopup": "listbox", "aria-expanded": "false",
  });
  // `hidden` + a screen-only display rule in select.css: in print (or if
  // select.css is missing) the trigger stays hidden and the native select shows.
  trigger.hidden = true;
  const value = el("span", "nc-select-value");
  trigger.append(value, el("span", "nc-select-chevron", { "aria-hidden": "true" }));
  // builder-tab.js restores focus by data-fid after each redraw.
  if (select.dataset.fid) trigger.dataset.fid = select.dataset.fid;

  const hadFocus = document.activeElement === select;
  select.before(wrap);
  wrap.append(select, trigger);
  select.classList.add("nc-select-src");
  select.setAttribute("aria-hidden", "true");
  select.tabIndex = -1;

  const inst = {
    id, select, wrap, trigger, value, opts,
    pop: null, list: null, filter: null, empty: null,
    items: [], groups: [], active: null, dirty: true,
    typed: "", typedAt: 0, queued: false,
  };
  instances.set(select, inst);

  // Programmatic `select.value = x` / `selectedIndex = n` fire no event: wrap the setters.
  Object.defineProperty(select, "value", {
    configurable: true, get() { return VALUE.get.call(this); },
    set(v) { VALUE.set.call(this, v); queue(inst); },
  });
  Object.defineProperty(select, "selectedIndex", {
    configurable: true, get() { return INDEX.get.call(this); },
    set(v) { INDEX.set.call(this, v); queue(inst); },
  });
  select.addEventListener("change", () => sync(inst));
  select.addEventListener("input", () => sync(inst));
  select.addEventListener("focus", () => { if (!isDisabled(inst)) trigger.focus(); });
  select.form?.addEventListener("reset", () => setTimeout(() => sync(inst)));
  new MutationObserver(() => { inst.dirty = true; queue(inst); }).observe(select, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["disabled", "label", "selected", "hidden", "title", "data-reason",
      "aria-label", "aria-labelledby", "required", "aria-invalid"],
  });

  trigger.addEventListener("click", e => {
    e.preventDefault();                 // no <label> activation
    if (isDisabled(inst)) return;
    if (current === inst) close(inst, true);
    else { trigger.focus(); open(inst); }
  });
  trigger.addEventListener("keydown", e => onKey(inst, e, false));
  trigger.addEventListener("focusout", e => leave(inst, e));

  sync(inst, true);
  if (hadFocus) trigger.focus();
  return inst;
}

function queue(inst) {
  if (inst.queued) return;
  inst.queued = true;
  queueMicrotask(() => { inst.queued = false; sync(inst); });
}

const isDisabled = inst => inst.select.disabled || !!inst.select.closest("fieldset:disabled");

function sync(inst, force) {
  const { select, trigger, value } = inst;
  // A hidden select hides its stand-in too (.nc-select's display beats [hidden]).
  inst.wrap.style.display = select.hidden ? "none" : "";
  const opt = select.options[INDEX.get.call(select)];
  value.textContent = opt ? optText(opt) || " " : " ";
  trigger.toggleAttribute("data-placeholder", !opt || opt.value === "");
  const dis = isDisabled(inst);
  trigger.setAttribute("aria-disabled", String(dis));
  trigger.tabIndex = dis ? -1 : 0;
  if (select.required) trigger.setAttribute("aria-required", "true");
  else trigger.removeAttribute("aria-required");
  const inv = select.getAttribute("aria-invalid");
  if (inv) trigger.setAttribute("aria-invalid", inv); else trigger.removeAttribute("aria-invalid");
  label(inst);
  if (force) inst.dirty = true;
  if (current === inst) {
    if (dis) close(inst, false);
    else if (inst.dirty) { render(inst); inst.width = 0; place(inst); }
    else markSelected(inst);
  }
}

/** Accessible name: aria-labelledby, aria-label, <label>, title, placeholder option. */
function label(inst) {
  const { select, trigger } = inst;
  const by = select.getAttribute("aria-labelledby");
  trigger.removeAttribute("aria-labelledby");
  trigger.removeAttribute("aria-label");
  if (by) { trigger.setAttribute("aria-labelledby", by); inst.name = by; return; }
  let name = select.getAttribute("aria-label") || "";
  if (!name && select.labels?.length) {
    name = [...select.labels].map(l => {
      const c = l.cloneNode(true);
      c.querySelectorAll("select,.nc-select").forEach(n => n.remove());
      return c.textContent;
    }).join(" ").replace(/\s+/g, " ").trim();
  }
  if (!name) name = select.title || "";
  if (!name && select.options[0]?.value === "") name = optText(select.options[0]);
  if (name) trigger.setAttribute("aria-label", name);
  inst.name = name;
}

/* ---------------------------- popup -------------------------------- */

function build(inst) {
  const { id, opts, select } = inst;
  const pop = el("div", "nc-select-pop", { id: `${id}-pop`, hidden: "" });
  const list = el("div", "nc-select-list", { id: `${id}-list`, role: "listbox", tabindex: "-1" });
  inst.pop = pop; inst.list = list;
  if (select.options.length > FILTER_OVER) {
    const box = el("div", "nc-select-filter");
    const f = el("input", "nc-select-filter-input", {
      type: "text", role: "combobox", autocomplete: "off", spellcheck: "false",
      "aria-autocomplete": "list", "aria-expanded": "true", "aria-controls": `${id}-list`,
      placeholder: select.dataset.filterPlaceholder || opts.filterPlaceholder || "Filter…",
    });
    box.append(f);
    pop.append(box);
    inst.filter = f;
    f.addEventListener("input", () => applyFilter(inst, true));
    f.addEventListener("keydown", e => onKey(inst, e, true));
    f.addEventListener("focusout", e => leave(inst, e));
  }
  inst.empty = el("div", "nc-select-empty", { role: "presentation" });
  inst.empty.textContent = select.dataset.noMatches || opts.noMatches || "No matches";
  inst.empty.hidden = true;
  pop.append(list, inst.empty);

  // Keep focus on the trigger / filter while using the mouse in the list.
  list.addEventListener("mousedown", e => e.preventDefault());
  list.addEventListener("click", e => {
    const item = itemOf(inst, e.target);
    if (!item || item.disabled) return;
    choose(inst, item);
    close(inst, true);
    fire(inst);
  });
  list.addEventListener("pointermove", e => {
    const item = itemOf(inst, e.target);
    if (item && !item.disabled && item !== inst.active) setActive(inst, item, false);
  });
  // The popup lives in <body>: keep its events away from app-wide handlers.
  for (const t of ["keydown", "keyup", "input", "change"]) pop.addEventListener(t, e => e.stopPropagation());
}

function itemOf(inst, node) {
  const o = node.closest?.(".nc-select-option");
  return o ? inst.items.find(i => i.el === o) : null;
}

function render(inst) {
  const { select, list, id } = inst;
  list.textContent = "";
  inst.items = []; inst.groups = [];
  list.removeAttribute("aria-label");
  list.removeAttribute("aria-labelledby");
  if (inst.name && !inst.trigger.hasAttribute("aria-labelledby")) list.setAttribute("aria-label", inst.name);
  else list.setAttribute("aria-labelledby", inst.trigger.getAttribute("aria-labelledby") || inst.trigger.id);
  let g = 0;
  const add = (opt, parent, group) => {
    if (opt.hidden) return;
    const oid = `${id}-o${opt.index}`;
    const node = el("div", "nc-select-option", { id: oid, role: "option" });
    const text = optText(opt);
    const lab = el("span", "nc-select-label");
    lab.textContent = text || " ";
    node.append(lab);
    const reason = (opt.dataset.reason || opt.title || "").trim();
    if (reason) {
      const r = el("span", "nc-select-reason", { id: `${oid}-why` });
      r.textContent = reason;
      node.append(r);
      node.setAttribute("aria-describedby", r.id);
    }
    const disabled = opt.disabled || !!group?.disabled;
    if (disabled) node.setAttribute("aria-disabled", "true");
    if (opt.value === "") node.dataset.placeholder = "";
    parent.append(node);
    inst.items.push({ el: node, opt, disabled, key: norm(text), group: group ? norm(group.label) : "" });
  };
  for (const child of select.children) {
    if (child instanceof HTMLOptGroupElement) {
      const hid = `${id}-g${g++}`;
      const box = el("div", "nc-select-groupbox", { role: "group", "aria-labelledby": hid });
      const head = el("div", "nc-select-group", { id: hid, role: "presentation" });
      head.textContent = child.label;
      box.append(head);
      for (const o of child.children) if (o instanceof HTMLOptionElement) add(o, box, child);
      list.append(box);
      inst.groups.push(box);
    } else if (child instanceof HTMLOptionElement) add(child, list, null);
  }
  inst.dirty = false;
  markSelected(inst);
  if (inst.filter) applyFilter(inst, false);
  else list.firstElementChild?.classList.add("is-first");
}

function markSelected(inst) {
  const sel = INDEX.get.call(inst.select);
  for (const i of inst.items) i.el.setAttribute("aria-selected", String(i.opt.index === sel));
}

function applyFilter(inst, fromTyping) {
  const q = norm(inst.filter?.value);
  let any = false;
  for (const i of inst.items) {
    const hit = !q || i.key.includes(q) || (i.group && i.group.includes(q));
    i.el.hidden = !hit;
    any ||= hit;
  }
  for (const g of inst.groups) g.hidden = !g.querySelector(".nc-select-option:not([hidden])");
  inst.list.querySelector(":scope > .is-first")?.classList.remove("is-first");
  inst.list.querySelector(":scope > :not([hidden])")?.classList.add("is-first");
  inst.empty.hidden = any;
  if (fromTyping) {
    const nav = navigable(inst);
    const sel = nav.find(i => i.opt.selected);
    setActive(inst, q ? nav[0] || null : sel || nav[0] || null, true);
    if (inst.pop.isConnected) place(inst);
  }
}

const navigable = inst => inst.items.filter(i => !i.disabled && !i.el.hidden);
const focusTarget = inst => inst.filter || inst.trigger;

function setActive(inst, item, scroll) {
  inst.active?.el.classList.remove("is-active");
  inst.active = item;
  const f = focusTarget(inst);
  if (!item) { f.removeAttribute("aria-activedescendant"); return; }
  item.el.classList.add("is-active");
  f.setAttribute("aria-activedescendant", item.el.id);
  if (inst.filter) inst.trigger.setAttribute("aria-activedescendant", item.el.id);
  if (scroll) reveal(inst.list, item.el);
}

function reveal(list, node) {
  const lr = list.getBoundingClientRect(), r = node.getBoundingClientRect();
  if (r.top < lr.top) list.scrollTop -= lr.top - r.top;
  else if (r.bottom > lr.bottom) list.scrollTop += r.bottom - lr.bottom;
}

function open(inst, seed = "") {
  if (current === inst || isDisabled(inst)) return;
  if (current) close(current, false);
  if (!inst.pop) build(inst);
  // The strings can follow a language switch (getters in opts): read them
  // on every open, not only when the popup is first built.
  const { select, opts } = inst;
  if (inst.filter) inst.filter.placeholder = select.dataset.filterPlaceholder || opts.filterPlaceholder || "Filter…";
  inst.empty.textContent = select.dataset.noMatches || opts.noMatches || "No matches";
  inst.width = 0;
  if (inst.filter) inst.filter.value = "";
  render(inst);
  document.body.append(inst.pop);
  current = inst;
  // aria-controls only while the listbox is in the DOM.
  inst.trigger.setAttribute("aria-controls", inst.list.id);
  inst.trigger.setAttribute("aria-expanded", "true");
  inst.wrap.classList.add("is-open");
  place(inst);                          // measures the unfiltered width
  if (inst.filter && seed) { inst.filter.value = seed; applyFilter(inst, true); }
  else {
    const nav = navigable(inst);
    setActive(inst, nav.find(i => i.opt.selected) || nav[0] || null, true);
  }
  if (inst.filter) inst.filter.focus({ preventScroll: true });
  document.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
}

function close(inst, refocus) {
  if (current !== inst) return;
  current = null;
  inst.pop.remove();
  inst.active?.el.classList.remove("is-active");
  inst.active = null;
  inst.trigger.setAttribute("aria-expanded", "false");
  inst.trigger.removeAttribute("aria-controls");
  inst.trigger.removeAttribute("aria-activedescendant");
  inst.wrap.classList.remove("is-open");
  inst.typed = "";
  document.removeEventListener("pointerdown", onOutside, true);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", onScroll);
  if (refocus && inst.trigger.isConnected) inst.trigger.focus({ preventScroll: true });
}

function onOutside(e) {
  const inst = current;
  if (inst && !inst.wrap.contains(e.target) && !inst.pop.contains(e.target)) close(inst, false);
}

let raf = 0;
function onScroll(e) {
  const inst = current;
  if (!inst || (e?.target instanceof Node && inst.pop.contains(e.target))) return;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    if (current !== inst) return;
    const r = inst.trigger.getBoundingClientRect();
    if (!inst.trigger.isConnected || r.bottom < 0 || r.top > innerHeight) close(inst, false);
    else place(inst);
  });
}

function leave(inst, e) {
  if (current !== inst) return;
  const to = e.relatedTarget;
  if (to && (inst.wrap.contains(to) || inst.pop.contains(to))) return;
  // relatedTarget is null for clicks on non-focusable things; onOutside handles those.
  if (!to) return;
  close(inst, false);
}

/** Position the fixed popup under (or above) the trigger, inside the viewport. */
function place(inst) {
  const { pop, trigger } = inst;
  const r = trigger.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const maxW = vw - 2 * MARGIN;
  pop.style.minWidth = `${Math.min(r.width, maxW)}px`;
  pop.style.maxWidth = `${Math.min(maxW, Math.max(r.width, 480))}px`;
  // Measure the natural width once per opening, so filtering doesn't make it jump.
  const first = !inst.width;
  if (first) { pop.style.width = ""; pop.style.left = "0px"; inst.width = pop.offsetWidth; }
  pop.style.width = `${Math.min(inst.width, maxW)}px`;
  pop.style.maxHeight = "none";
  pop.style.left = "0px"; pop.style.top = "0px";
  const natural = pop.offsetHeight;
  const below = vh - r.bottom - GAP - MARGIN, above = r.top - GAP - MARGIN;
  const want = Math.min(natural, MAX_H);
  // Decide the side once per opening (or when it no longer fits), so filtering doesn't flip it.
  let up = first || inst.up === undefined ? want > below && above > below : inst.up;
  if (!first && (up ? above : below) < Math.min(want, 96)) up = !up;
  inst.up = up;
  const room = Math.max(96, Math.min(MAX_H, up ? above : below));
  pop.style.maxHeight = `${room}px`;
  const h = pop.offsetHeight, w = pop.offsetWidth;
  const left = Math.max(MARGIN, Math.min(r.left, vw - w - MARGIN));
  const top = up ? r.top - GAP - h : r.bottom + GAP;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.dataset.placement = up ? "top" : "bottom";
  if (inst.active) reveal(inst.list, inst.active.el);
}

/* --------------------------- choosing ------------------------------ */

function choose(inst, item) {
  const prev = INDEX.get.call(inst.select);
  INDEX.set.call(inst.select, item.opt.index);
  inst.changed = prev !== item.opt.index;
  sync(inst);
}

function fire(inst) {
  if (!inst.changed) return;
  inst.changed = false;
  inst.select.dispatchEvent(new Event("input", { bubbles: true }));
  inst.select.dispatchEvent(new Event("change", { bubbles: true }));
}

function move(inst, by) {
  const nav = navigable(inst);
  if (!nav.length) return;
  let i = nav.indexOf(inst.active);
  if (i < 0) i = by > 0 ? -1 : nav.length;
  setActive(inst, nav[Math.max(0, Math.min(nav.length - 1, i + by))], true);
}

function typeahead(inst, ch) {
  const now = Date.now();
  inst.typed = now - inst.typedAt > TYPE_MS ? ch : inst.typed + ch;
  inst.typedAt = now;
  const q = norm(inst.typed) || inst.typed;
  const same = [...q].every(c => c === q[0]);
  const needle = same ? q[0] : q;
  const nav = navigable(inst);
  if (!nav.length) return;
  const start = nav.indexOf(inst.active);
  const from = same || q.length === 1 ? start + 1 : Math.max(start, 0);
  for (let k = 0; k < nav.length; k++) {
    const item = nav[(from + k) % nav.length];
    if (item.key.startsWith(needle)) { setActive(inst, item, true); return; }
  }
}

function onKey(inst, e, inFilter) {
  if (e.isComposing) return;
  const isOpen = current === inst;
  const k = e.key;
  const printable = k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  const handled = () => { e.preventDefault(); e.stopPropagation(); };

  if (!isOpen) {
    if (isDisabled(inst)) return;
    if (k === "Enter" || k === " " || k === "ArrowDown" || k === "ArrowUp") {
      handled(); open(inst);
    } else if (k === "Home" || k === "End") {
      handled(); open(inst);
      const nav = navigable(inst);
      setActive(inst, k === "Home" ? nav[0] : nav[nav.length - 1], true);
    } else if (printable) {
      handled();
      if (inst.select.options.length > FILTER_OVER) open(inst, k);
      else { open(inst); typeahead(inst, k); }
    }
    return;
  }

  switch (k) {
    case "ArrowDown": handled(); move(inst, 1); return;
    case "ArrowUp":
      handled();
      if (e.altKey) { commit(inst); return; }
      move(inst, -1); return;
    case "PageDown": handled(); move(inst, PAGE); return;
    case "PageUp": handled(); move(inst, -PAGE); return;
    case "Home": case "End":
      if (inFilter) return;               // caret movement in the filter field
      handled();
      { const nav = navigable(inst); setActive(inst, k === "Home" ? nav[0] : nav[nav.length - 1], true); }
      return;
    case "Enter": handled(); commit(inst); return;
    case "Escape": handled(); close(inst, true); return;
    case "Tab":
      // Select, close, then let the browser move focus on from the trigger.
      if (inst.active) choose(inst, inst.active);
      close(inst, true);
      fire(inst);
      return;
    case " ":
      if (inFilter) return;
      handled();
      if (inst.typed && Date.now() - inst.typedAt < TYPE_MS) typeahead(inst, " ");
      else commit(inst);
      return;
  }
  if (printable && !inFilter) { handled(); typeahead(inst, k); }
}

function commit(inst) {
  if (inst.active) choose(inst, inst.active);
  close(inst, true);
  fire(inst);
}
