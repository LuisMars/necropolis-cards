/**
 * Boot, the header and the router.
 *
 * Keeps wiring small: every page's logic lives in its own module and
 * exposes an `init*` + `render*` function.
 *
 * Two destinations, each with a local switch, addressed by the hash:
 *   #gatherings            Builder, Gathering view
 *   #gatherings/campaign   Builder, Campaign view
 *   #gatherings/roster     Builder, Roster view: the warband roster sheet
 *   #gatherings/roster/cards  Roster view, Cards: the gathering's card sheets
 *   #cards                 Library
 *   #cards/queue           Print queue
 * The Builder's view state is the Builder's own (`setView`); the address
 * only drives it. The last place is remembered under its own UI key.
 *
 * The <section class="tab"> blocks stay as they were, because the print CSS
 * keys off them: a route just decides which of them are `.active`.
 */

import { state, loadQueue, loadPrinted, loadLang, saveLang, loadWarband, saveWarband } from "./state.js";
import { loadBundle }         from "./data.js";
import { loadFonts }          from "./fonts.js";
import { initImport }         from "./import.js";
import { initLibrary, renderLibrary } from "./library.js";
import { initWarband, renderWarband }  from "./warband.js";
import { initBuilder, renderBuilder, setView, rosterPayload } from "./builder-tab.js";
import { initPrint, renderPrint, printList, renderSheetsInto, sheetCount, stillNeeded } from "./print.js";
import { payloadCards }       from "./import.js";
import { store }              from "./gatherings.js";
import { label, fill }        from "./builder/messages.js";
import { $, escapeHtml }      from "./util.js";
import { observeSelects }     from "./select.js";
import { icon }               from "./lucide.js";

const L = (k) => label(k, state.lang || "en");

/* ---- routes ------------------------------------------------------------------ */

const ROUTES = {
  "gatherings":          { dest: "gatherings", tabs: ["builder"], view: "gathering" },
  "gatherings/campaign": { dest: "gatherings", tabs: ["builder"], view: "campaign" },
  "gatherings/roster":   { dest: "gatherings", tabs: ["builder", "warband"], view: "roster", part: "sheet" },
  "gatherings/roster/cards": { dest: "gatherings", tabs: ["builder", "warband"], view: "roster", part: "cards" },
  "cards":               { dest: "cards", tabs: ["library"] },
  "cards/queue":         { dest: "cards", tabs: ["print"] },
};
const LS_ROUTE = "necropolis-ui-route-v1";

let current = null;   // the route name on screen

/** First visit: the last place, else Gatherings if one is saved, else Cards. */
function startRoute() {
  const hash = location.hash.slice(1);
  if (ROUTES[hash]) return hash;
  try { const v = localStorage.getItem(LS_ROUTE); if (ROUTES[v]) return v; } catch {}
  return store.list().length ? "gatherings" : "cards";
}

/** Go somewhere: a new history entry, so Back returns. Applied at once, so
 *  a caller can rely on the new view being drawn when this returns. */
function navigate(name) {
  if (!ROUTES[name]) return;
  if (location.hash.slice(1) !== name) location.hash = name;
  applyRoute(name);
}

function applyRoute(name) {
  if (!ROUTES[name]) {
    name = current || startRoute();
    history.replaceState(null, "", `#${name}`);
  }
  current = name;
  try { localStorage.setItem(LS_ROUTE, name); } catch {}
  const r = ROUTES[name];
  if (r.view) setView(r.view);
  showSections();
  if (r.dest === "gatherings") renderBuilder();   // its onRender refreshes the header
  if (name === "cards") renderLibrary();
  refreshHeader();
}

/** The sections this route shows. The roster sheet only with a gathering open. */
function showSections() {
  const r = ROUTES[current];
  const tabs = r.tabs.filter(t => t !== "warband" || !!state.warband);
  document.querySelectorAll("section.tab").forEach(s => s.classList.toggle("active", tabs.includes(s.dataset.tab)));
}

// Back, forward, or an edited address.
window.addEventListener("hashchange", () => {
  const name = location.hash.slice(1);
  if (name !== current) applyRoute(name);
});

/* ---- the header -------------------------------------------------------------- */

const $nav        = $("main-nav");
const $queueCount = $("queue-count");
const $queueLink  = $("nav-queue-link");
const $printBtn   = $("global-print-btn");
const $printReason = $("print-reason");
const $settings   = $("nav-settings");

/** Static markup names its strings in data-i18n (the text after any icon
 *  or checkbox), data-i18n-html (trusted markup from messages.js) and
 *  data-i18n-{placeholder,title,aria-label}. */
function translateStatic() {
  document.title = L("appTitle");
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const text = L(el.dataset.i18n);
    if (!el.children.length) { el.textContent = text; return; }
    const node = [...el.childNodes].reverse().find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (node) node.textContent = ` ${text}`; else el.append(` ${text}`);
  });
  document.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = L(el.dataset.i18nHtml); });
  for (const a of ["placeholder", "title", "aria-label"]) {
    document.querySelectorAll(`[data-i18n-${a}]`).forEach(el => el.setAttribute(a, L(el.getAttribute(`data-i18n-${a}`))));
  }
}

/** Every label follows the Language setting. */
function refreshLabels() {
  document.documentElement.lang = state.lang || "en";
  translateStatic();
  $nav.setAttribute("aria-label", L("mainNav"));
  $nav.querySelector('a[data-dest="gatherings"]').textContent = L("navGatherings");
  $nav.querySelector('a[data-dest="cards"]').textContent = L("navCards");
  $("nav-settings-label").textContent = L("settings");
  $("lang-label").textContent = L("language");
  $("lang-select").closest("label").title = L("languageHint");
  $("theme-label").textContent = L("theme");
  $("bd-import-close").textContent = L("close");
}

function refreshHeader() {
  const n = state.queue.length;
  $queueCount.textContent = n;
  $queueLink.setAttribute("aria-label", `${n} ${L(n === 1 ? "queueCount1" : "queueCountN")}`);
  const r = ROUTES[current] || ROUTES.cards;

  $nav.querySelectorAll(".nav-item").forEach(item => {
    const on = item.dataset.dest === r.dest;
    item.classList.toggle("active", on);
    const a = item.querySelector("a.nav-dest");
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });

  // The Cards switch (Library / Print queue), one copy above each part.
  document.querySelectorAll('[data-local="cards"]').forEach(g => {
    g.setAttribute("aria-label", L("cardsView"));
    g.innerHTML = [["cards", "library"], ["cards/queue", "printQueue"]].map(([to, k]) =>
      `<button type="button" class="secondary" data-route="${to}" aria-pressed="${current === to}">${escapeHtml(L(k))}</button>`).join("");
  });

  // The one primary action names what it prints, or says why it can't.
  let rest, reason = "";
  if (r.part === "cards") {
    const k = rosterCards().length;
    rest = `${k} ${L(k === 1 ? "printCard1" : "printCardN")}`;
    if (!state.warband) reason = L("noGatheringToPrint");
    else if (!k) reason = L("allOwned");
  } else if (r.dest === "gatherings") {
    rest = L("printRoster");
    if (!state.warband) reason = L("noGatheringToPrint");
    else if (!(state.warband.gathering || []).length) reason = L("noModelsToPrint");
  } else {
    const k = printList().length;
    rest = `${k} ${L(k === 1 ? "printCard1" : "printCardN")}`;
    if (!n) reason = L("queueEmpty");
    else if (!k) reason = L("allPrinted");
  }
  const verb = L("printVerb");
  $printBtn.querySelector(".pb-verb").textContent = verb;
  $printBtn.querySelector(".pb-rest").textContent = ` ${rest}`;
  // Phones show only the verb; the name still says what it prints.
  $printBtn.setAttribute("aria-label", `${verb} ${rest}`);
  $printBtn.disabled = !!reason;
  $printBtn.title = reason;
  $printReason.textContent = reason;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-route]");
  if (b) navigate(b.dataset.route);
});

// Settings: a <details> disclosure that also closes on Escape and on a click
// outside it.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !$settings.open) return;
  $settings.open = false;
  $settings.querySelector("summary").focus();
});
document.addEventListener("pointerdown", (e) => {
  // A themed dropdown's list is a portal in <body>: choosing from the
  // Language or Theme list is still a click inside Settings.
  if ($settings.open && !$settings.contains(e.target) && !e.target.closest?.(".nc-select-pop")) $settings.open = false;
});

// Print. Show what will print first so it's laid out (some browsers freeze
// a snapshot of hidden tabs and print them as blank), then open the dialog
// on the next frame: the roster on Gatherings, the card sheets on Cards.
$printBtn.addEventListener("click", () => {
  const roster = ROUTES[current]?.dest === "gatherings";
  navigate(roster ? (ROUTES[current].part === "cards" ? "gatherings/roster/cards" : "gatherings/roster") : "cards/queue");
  if (roster) document.body.classList.add("printing-warband");
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
});

/* ---- the roster follows the Builder ---------------------------------------------- */

let rosterKey = "";

/* The Roster view's Cards part: every card the gathering uses, matched as
 * "Add cards to queue" matches them, minus the ones already printed when
 * "Skip cards I already have" is on. The shared queue is never touched. */
const LS_SKIP = "necropolis-ui-roster-skip-v1";
let rosterSkip = false;
try { rosterSkip = localStorage.getItem(LS_SKIP) === "1"; } catch {}
function rosterCards() {
  const all = payloadCards(state.warband);
  return rosterSkip ? stillNeeded(all) : all;
}
/** For the Builder's roster bar: which part, the skip choice and the counts. */
function rosterInfo() {
  const cards = state.catalog ? payloadCards(rosterPayload()) : [];
  const shown = rosterSkip ? stillNeeded(cards) : cards;
  return { part: ROUTES[current]?.part || "sheet", skip: rosterSkip, cards: shown.length, sheets: sheetCount(shown.length) };
}
function setRosterSkip(on) {
  rosterSkip = !!on;
  try { localStorage.setItem(LS_SKIP, rosterSkip ? "1" : "0"); } catch {}
  renderBuilder();
}
let rosterSheetsKey = "";
/** Show the part the route asks for; lay the card sheets out when shown. */
function renderRosterParts() {
  const cards = ROUTES[current]?.part === "cards";
  $("wb-pages").hidden = cards;
  document.querySelector(".wb-toolbar").hidden = cards;
  const $sheets = $("roster-sheets");
  $sheets.hidden = !cards;
  if (!cards) return;
  const list = rosterCards();
  const key = JSON.stringify([rosterKey, rosterSkip, $("bleed-toggle").checked, $("backs-toggle").checked, state.printed]);
  if (key === rosterSheetsKey) return;
  rosterSheetsKey = key;
  $sheets.innerHTML = "";
  if (list.length) renderSheetsInto($sheets, list);
  else $sheets.innerHTML = `<div class="empty-msg">${escapeHtml(L(state.warband ? "allOwned" : "noGatheringToPrint"))}</div>`;
}
/** After every Builder redraw: the roster sheet shows the gathering on
 *  screen, unsaved draft included, through the same Companion App JSON the
 *  Builder exports. Re-laid out only when that JSON or the language changed. */
function syncRoster() {
  const data = rosterPayload();
  const key = JSON.stringify([data, state.lang]);
  if (key !== rosterKey) {
    rosterKey = key;
    state.warband = data;
    saveWarband();
    renderWarband();
  }
  if (current) showSections();
  renderRosterParts();
  refreshHeader();
}

// Always keep the print-tab DOM populated. Some browsers freeze a layout
// snapshot when @media print fires, so just-in-time rendering on
// `beforeprint` isn't reliable — better to keep the sheets ready and pay
// a tiny re-render cost on every queue change.
const onChange = () => { renderPrint(); refreshHeader(); };
window.addEventListener("beforeprint", () => {
  // Printing from Gatherings yields roster sheets; from Cards, the card
  // sheets. `printing-warband` is what the print CSS keys off.
  document.body.classList.toggle("printing-warband", ROUTES[current]?.dest === "gatherings");
  renderPrint();
});

initImport({
  onChange,
  onImported: () => navigate("gatherings"),
  openQueue: () => navigate("cards/queue"),
  onPanel: () => renderBuilder(),
});
initLibrary({ onChange });
initWarband();
initBuilder({ onChange, navigate, onRender: syncRoster, rosterInfo, setRosterSkip });
initPrint({ onChange });
// "Only what I still need" changes how many cards print.
$("need-toggle").addEventListener("change", refreshHeader);

// Language selector (Settings). The printed material (cards, roster) and the
// Builder are localised, so changing it re-renders those views.
loadLang();
const $langSelect = $("lang-select");
$langSelect.value = state.lang;
$langSelect.addEventListener("change", () => {
  state.lang = $langSelect.value === "es" ? "es" : "en";
  saveLang();
  refreshLabels();
  if (current === "cards") renderLibrary();
  renderBuilder();
  renderPrint();
  refreshHeader();
});

// Static markup marks its icons with data-icon (Lucide, web/js/lucide.js).
document.querySelectorAll("[data-icon]").forEach(el => {
  el.innerHTML = icon(el.dataset.icon);
  el.setAttribute("aria-hidden", "true");
});

// Themed dropdowns for every select, now and as views redraw (select.js;
// touch keeps the native picker). Its strings follow the Language setting:
// read when a list first opens, and per select from data-* where set.
observeSelects(document, {
  get filterPlaceholder() { return L("filterOptions"); },
  get noMatches() { return L("noMatches"); },
});

loadQueue();
loadPrinted();
loadWarband();
refreshLabels();
current = startRoute();
history.replaceState(null, "", `#${current}`);
showSections();
refreshHeader();

// Fonts load in parallel with the data bundle; whichever finishes second
// triggers the first render of the print preview.
Promise.all([loadFonts(), loadBundle()]).then(() => {
  // Always render the print tab so the sheets DOM is ready when the user
  // hits Print from anywhere. Cost is negligible (<10ms for a typical queue).
  renderPrint();
  applyRoute(current);
  if (ROUTES[current].dest !== "gatherings") renderBuilder();   // keeps the roster ready
}).catch(e => {
  console.error(e);
  document.querySelector("main").innerHTML =
    `<div class="empty-msg">${escapeHtml(L("loadFailed"))}` +
    `<br><br><small class="muted">${escapeHtml(fill(L("loadFailedTech"), { error: e.message }))}</small></div>`;
});
