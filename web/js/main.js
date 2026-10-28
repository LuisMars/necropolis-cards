/**
 * Boot + tab switching.
 *
 * Keeps wiring small: every tab's logic lives in its own module and
 * exposes an `init*` + `render*` function.
 */

import { state, loadQueue, loadPrinted, loadLang, saveLang, loadWarband } from "./state.js";
import { loadBundle }         from "./data.js";
import { loadFonts }          from "./fonts.js";
import { initImport }         from "./import.js";
import { initLibrary, renderLibrary } from "./library.js";
import { initWarband, renderWarband }  from "./warband.js";
import { initPrint, renderPrint }     from "./print.js";
import { $ }                  from "./util.js";

const $queueCount = $("queue-count");

function refreshHeader() {
  $queueCount.textContent = state.queue.length;
}

const currentTab = () =>
  (document.querySelector("nav.tabs button.active") || {}).dataset?.tab || "import";

function switchTo(tab) {
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("section.tab").forEach(s => s.classList.toggle("active", s.dataset.tab === tab));
  if (tab === "library") renderLibrary();
  if (tab === "warband") renderWarband();
  if (tab === "print")   renderPrint();
}

document.querySelectorAll("nav.tabs button").forEach(b => {
  b.addEventListener("click", () => switchTo(b.dataset.tab));
});

// Global print button. Switch to the print tab first so its sheets are
// actually laid out (some browsers freeze a snapshot of hidden tabs and
// print them as blank), then open the dialog on the next frame.
document.getElementById("global-print-btn").addEventListener("click", () => {
  switchTo("print");
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
});

// Always keep the print-tab DOM populated. Some browsers freeze a layout
// snapshot when @media print fires, so just-in-time rendering on
// `beforeprint` isn't reliable — better to keep the sheets ready and pay
// a tiny re-render cost on every queue change.
const onChange = () => { refreshHeader(); renderPrint(); };
window.addEventListener("beforeprint", () => {
  // Printing from the Warband tab yields roster sheets; from anywhere else,
  // the card sheets. `printing-warband` is what the print CSS keys off.
  document.body.classList.toggle("printing-warband", currentTab() === "warband");
  renderPrint();
});

initImport({
  onChange,
  switchToPrint: () => switchTo("print"),
  switchToWarband: () => switchTo("warband"),
  onWarband: () => renderWarband(),
});
initLibrary({ onChange });
initWarband({ onChange });
initPrint({ onChange });

// Card-language selector. Only the printed material is localised (cards and
// the warband roster), so changing it just re-renders those views.
loadLang();
const $langSelect = document.getElementById("lang-select");
$langSelect.value = state.lang;
$langSelect.addEventListener("change", () => {
  state.lang = $langSelect.value === "es" ? "es" : "en";
  saveLang();
  if (currentTab() === "library") renderLibrary();
  renderWarband();
  renderPrint();
});

loadQueue();
loadPrinted();
loadWarband();
refreshHeader();

// Fonts load in parallel with the data bundle; whichever finishes second
// triggers the first render of the print preview.
Promise.all([loadFonts(), loadBundle()]).then(() => {
  refreshHeader();
  if (currentTab() === "library") renderLibrary();
  renderWarband();
  // Always render the print tab so the sheets DOM is ready when the user
  // hits ⎙ from any tab. Cost is negligible (<10ms for a typical queue).
  renderPrint();
}).catch(e => {
  document.querySelector("main").innerHTML =
    `<div class="empty-msg">Failed to load <code>data.json</code>: ${e.message}<br><br>` +
    `Run <code style="background:#2f2f37;padding:2px 6px;border-radius:3px;">python3 web/bundle.py</code> ` +
    `from the project root to generate it.</div>`;
});
