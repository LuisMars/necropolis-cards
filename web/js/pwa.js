/**
 * Offline use and update checking. Registers the service worker (sw.js, made
 * by web/bundle.py), looks for a new version on load, when the tab comes
 * back, and every hour, and tells the player when one is waiting.
 *
 * It never reloads on its own: a new version waits until the player presses
 * Update (notice, or Settings), so nobody loses work mid-edit. Without service
 * worker support, or without sw.js (dev before bundling), the app just runs.
 */

import { label, fill } from "./builder/messages.js";

const HOUR = 60 * 60 * 1000;
const $ = (id) => document.getElementById(id);

/* Install. beforeinstallprompt can fire before initPwa runs, so the listener
 * is registered when this module loads and keeps the event for later. */
let deferredPrompt = null;
const installListeners = new Set();
const tellInstall = () => installListeners.forEach((f) => f());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; tellInstall(); });
  window.addEventListener("appinstalled", () => { deferredPrompt = null; tellInstall(); });
}
const isStandalone = () => {
  try { return !!(window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone); } catch { return false; }
};
/** iOS Safari (and iPadOS, which says Macintosh) has no prompt: only a hint. */
const isIosSafari = () => {
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
};

export function initPwa({ lang = () => "en" } = {}) {
  const L = (k, vars) => fill(label(k, lang()), vars);
  const supported = typeof navigator !== "undefined" && "serviceWorker" in navigator;
  let reg = null;
  let result = "";            // "", checking, uptodate, available, offline, unsupported
  let version = "";
  let controlled = supported && !!navigator.serviceWorker.controller;   // false on the very first install

  const waitingWorker = () => (controlled || navigator.serviceWorker.controller) ? reg?.waiting || null : null;

  async function readVersion() {
    const w = reg?.active || navigator.serviceWorker.controller;
    if (!w) return "";
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(""), 2000);
      ch.port1.onmessage = (e) => { clearTimeout(t); resolve(String(e.data || "")); };
      try { w.postMessage({ type: "GET_VERSION" }, [ch.port2]); } catch { clearTimeout(t); resolve(""); }
    });
  }

  function render() {
    const note = $("nc-update");
    const sheetOpen = !!$("settings-sheet")?.open;
    const waiting = !!waitingWorker();
    // The modal Settings sheet covers the floating notice, so while it is open
    // the same action lives in its App section instead: one notice at a time.
    if ($("pwa-ready")) {
      $("pwa-ready").hidden = !(waiting && sheetOpen);
      $("pwa-ready-text").textContent = L("pwaNewVersion");
      $("pwa-update-btn").textContent = L("pwaUpdate");
    }
    if (note) {
      note.hidden = !waiting || sheetOpen;
      $("nc-update-text").textContent = L("pwaNewVersion");
      $("nc-update-btn").textContent = L("pwaUpdate");
    }
    if (!$("pwa-section")) return;
    const inst = $("pwa-install");
    if (inst) {
      const prompt = !isStandalone() && !!deferredPrompt;
      const hint = !isStandalone() && !prompt && isIosSafari();
      inst.hidden = !(prompt || hint);
      $("pwa-install-btn").hidden = !prompt;
      $("pwa-install-btn").textContent = L("pwaInstall");
      $("pwa-ios-hint").hidden = !hint;
      $("pwa-ios-hint").textContent = L("pwaIosHint");
    }
    $("pwa-section").hidden = !!($("pwa-updates")?.hidden && inst?.hidden);
    $("pwa-title").textContent = L("pwaTitle");
    $("pwa-version").textContent = version ? L("pwaVersion", { v: version }) : L("pwaNoVersion");
    $("pwa-check").textContent = L("pwaCheck");
    $("pwa-check").disabled = result === "checking";
    $("pwa-status").textContent = {
      checking: L("pwaChecking"), uptodate: L("pwaUpToDate"), available: L("pwaAvailable"),
      offline: L("pwaOffline"), unsupported: L("pwaUnsupported"),
    }[result] || "";
  }

  function applyUpdate() {
    const w = reg?.waiting;
    if (w) w.postMessage({ type: "SKIP_WAITING" });
  }

  function watch(worker) {
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") render();
    });
  }

  /** Ask the server for a newer sw.js; resolves to the result key. */
  async function check() {
    if (!supported || !reg) { result = "unsupported"; render(); return result; }
    if (navigator.onLine === false) { result = "offline"; render(); return result; }
    result = "checking"; render();
    try {
      await reg.update();
      // A new worker may still be installing (downloading the precache): wait for it.
      const installing = reg.installing;
      if (installing && installing.state !== "installed") {
        await new Promise((resolve) => {
          const done = () => { if (["installed", "activated", "redundant"].includes(installing.state)) { clearTimeout(t); resolve(); } };
          const t = setTimeout(resolve, 120000);
          installing.addEventListener("statechange", done);
        });
      }
      result = waitingWorker() ? "available" : "uptodate";
    } catch {
      result = "offline";
    }
    render();
    return result;
  }

  /** Background check: quiet, never throws. */
  async function quietCheck() {
    if (!reg || navigator.onLine === false) return;
    try { await reg.update(); } catch {}
  }

  async function start() {
    try {
      reg = await navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" });
    } catch { reg = null; return; }                    // no sw.js, blocked, insecure: run without it
    if (!reg) return;                                  // some browsers resolve with nothing when blocked
    if (reg.waiting) render();
    if (reg.installing) watch(reg.installing);
    reg.addEventListener("updatefound", () => { if (reg.installing) watch(reg.installing); });
    version = await readVersion();
    if (!version) {   // first install: the worker is still starting; ask again once it is active
      navigator.serviceWorker.ready.then(async () => { version = await readVersion(); render(); }, () => {});
    }
    render();
    quietCheck();
  }

  if (!supported) { result = ""; }
  else {
    // The worker taking over reloads the page once: after the player pressed
    // Update here, or in another tab. The first takeover of an uncontrolled
    // page is the first install, so it only marks the page as controlled; an
    // update later in that same tab still reloads. Never twice.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!controlled) { controlled = true; return; }
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
    const go = () => start();
    if (document.readyState === "complete") go(); else addEventListener("load", go, { once: true });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") quietCheck(); });
    setInterval(quietCheck, HOUR);
  }

  $("nc-update-btn")?.addEventListener("click", applyUpdate);
  $("pwa-update-btn")?.addEventListener("click", applyUpdate);
  const sheet = $("settings-sheet");
  if (sheet && typeof MutationObserver !== "undefined") {
    new MutationObserver(() => render()).observe(sheet, { attributes: true, attributeFilter: ["open"] });
  }
  $("pwa-check")?.addEventListener("click", check);
  installListeners.add(render);
  $("pwa-install-btn")?.addEventListener("click", async () => {
    const ev = deferredPrompt;
    if (!ev) return;
    deferredPrompt = null;            // a prompt can be used once
    render();
    try { await ev.prompt(); await ev.userChoice; } catch {}
    render();
  });
  const updates = $("pwa-updates");
  if (updates) updates.hidden = !supported;
  render();
  return { check, render };
}
