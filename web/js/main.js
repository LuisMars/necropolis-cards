/**
 * Boot, the header and the router.
 *
 * Keeps wiring small: every page's logic lives in its own module and
 * exposes an `init*` + `render*` function.
 *
 * Two destinations, each with a local switch, addressed by the hash:
 *   #gatherings            Builder, Gathering view
 *   #gatherings/campaign   Builder, Campaign view
 *   #gatherings/roster     Builder, Roster view (the warband roster sheet)
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
import { initPrint, renderPrint, printList } from "./print.js";
import { store }              from "./gatherings.js";
import { label }              from "./builder/messages.js";
import { $, escapeHtml }      from "./util.js";

const L = (k) => label(k, state.lang || "en");

/* ---- routes ------------------------------------------------------------------ */

const ROUTES = {
  "gatherings":          { dest: "gatherings", tabs: ["builder"], view: "gathering" },
  "gatherings/campaign": { dest: "gatherings", tabs: ["builder"], view: "campaign" },
  "gatherings/roster":   { dest: "gatherings", tabs: ["builder", "warband"], view: "roster" },
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

/** Labels follow the card language, as the Builder does. */
function refreshLabels() {
  document.documentElement.lang = state.lang || "en";
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
  if (r.dest === "gatherings") {
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
  if ($settings.open && !$settings.contains(e.target)) $settings.open = false;
});

// Print. Show what will print first so it's laid out (some browsers freeze
// a snapshot of hidden tabs and print them as blank), then open the dialog
// on the next frame: the roster on Gatherings, the card sheets on Cards.
$printBtn.addEventListener("click", () => {
  const roster = ROUTES[current]?.dest === "gatherings";
  navigate(roster ? "gatherings/roster" : "cards/queue");
  if (roster) document.body.classList.add("printing-warband");
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
});

/* ---- the roster follows the Builder ---------------------------------------------- */

let rosterKey = "";
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
initBuilder({ onChange, navigate, onRender: syncRoster });
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
  document.querySelector("main").innerHTML =
    `<div class="empty-msg">Failed to load <code>data.json</code>: ${e.message}<br><br>` +
    `Run <code style="background:#2f2f37;padding:2px 6px;border-radius:3px;">python3 web/bundle.py</code> ` +
    `from the project root to generate it.</div>`;
});
