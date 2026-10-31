/**
 * The Sync section of Settings: sign up, sign in, sign out, status, last
 * synced, Sync now, and the choice when a gathering changed on two devices.
 *
 * Everything that came from the server (names, user name) is put in with
 * textContent, never as markup. Errors are inline text next to the form;
 * status goes to a polite live region.
 */

import { createSync } from "./sync.js";
import { createCouchClient, configuredUrl, normalizeName } from "./couch.js";
import { storage } from "../gatherings.js";
import { label, fill, plural } from "../builder/messages.js";

const $ = (id) => document.getElementById(id);

const ERRORS = {
  offline: "syncErrOffline", unauthorized: "syncErrUnauthorized", forbidden: "syncErrForbidden",
  notReady: "syncErrNotReady", tooLarge: "syncErrTooLarge", conflict: "syncErrOther", error: "syncErrOther", missing: "syncErrOther",
};

/**
 * @param {{ lang: () => string, onPulled: () => void, onConflicts: () => void }} hooks
 *   onPulled: sync changed local data (re-read it and redraw);
 *   onConflicts: a gathering needs a decision (open Settings).
 */
export function initSync({ lang, onPulled, onConflicts }) {
  const L = (k, vars) => fill(label(k, lang()), vars);
  const baseUrl = configuredUrl();
  const sync = createSync({
    storage,
    client: createCouchClient({ baseUrl }),
    copyName: (n) => `${n} ${label("syncCopySuffix", lang())}`.trim(),
  });
  let host = "";
  try { host = new URL(baseUrl).host; } catch {}
  let lastPulls = 0, announcedConflicts = 0, formError = "";
  let last = { ...sync.state };

  function time(ms) {
    if (!ms) return L("syncUnknownTime");
    try { return new Date(ms).toLocaleString(lang() === "es" ? "es" : "en"); } catch { return String(ms); }
  }
  const show = (el, text) => { el.textContent = text || ""; el.hidden = !text; };

  function errorText(code) { return L(ERRORS[code] || "syncErrOther"); }

  function render() {
    const s = last, signedIn = !!s.user;
    $("sync-title").textContent = L("syncTitle");
    $("sync-note").textContent = L("syncNote", { server: host || "—" });
    $("sync-note").hidden = !host;
    $("sync-email-label").textContent = L("syncEmail");
    $("sync-password-label").textContent = L("syncPassword");
    $("sync-signin").textContent = L("syncSignIn");
    $("sync-signup").textContent = L("syncSignUp");
    $("sync-now").textContent = L("syncNow");
    $("sync-signout").textContent = L("syncSignOut");
    $("sync-section").hidden = !host;               // no server configured: no Sync section
    $("sync-form").hidden = signedIn;
    $("sync-account").hidden = !signedIn;
    const email = $("sync-email"), pass = $("sync-password");
    for (const f of [email, pass]) f.setAttribute("aria-invalid", formError ? "true" : "false");
    show($("sync-error"), formError);
    if (signedIn) {
      $("sync-user").textContent = L("syncSignedInAs", { user: s.user });
      $("sync-last").textContent = s.lastSyncAt ? L("syncLast", { time: time(s.lastSyncAt) }) : L("syncNever");
      show($("sync-account-error"), s.phase === "error" && s.error ? errorText(s.error) : "");
    }
    $("sync-now").disabled = s.phase === "syncing";
    $("sync-signout").disabled = s.phase === "syncing";

    let status = "";
    if (!signedIn) status = formError ? "" : L("syncOff");
    else if (s.phase === "syncing") status = L("syncWorking");
    else if (s.phase === "conflicts") status = plural("syncConflictCount", s.conflicts.length, lang());
    else if (s.phase === "ok") status = L("syncDone") + (s.ignored ? ` ${plural("syncIgnored", s.ignored, lang())}` : "");
    else if (s.phase === "error") status = errorText(s.error);
    $("sync-status").textContent = status;
    renderConflicts(s.conflicts || []);
  }

  function describe(side) {
    return side.deleted ? L("syncDetailDeleted", { time: time(side.at) }) : L("syncDetail", { models: side.models, time: time(side.at) });
  }
  function renderConflicts(list) {
    const host_ = $("sync-conflicts");
    host_.replaceChildren();
    for (const c of list) {
      const box = document.createElement("fieldset");
      box.className = "nc-sync-conflict";
      const lg = document.createElement("legend");
      lg.textContent = L("syncConflictTitle", { name: c.local.name || c.server.name || label("untitled", lang()) });
      const intro = document.createElement("p");
      intro.textContent = L("syncConflictIntro");
      const dl = document.createElement("dl");
      for (const [k, side] of [["syncThisDevice", c.local], ["syncServer", c.server]]) {
        const dt = document.createElement("dt"), dd = document.createElement("dd");
        dt.textContent = L(k);
        dd.textContent = `${side.name ? `${side.name}: ` : ""}${describe(side)}`;
        dl.append(dt, dd);
      }
      const row = document.createElement("div");
      row.className = "nc-sync-actions";
      for (const [choice, k] of [["mine", "syncKeepThis"], ["server", "syncKeepServer"], ["both", "syncKeepBoth"]]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "secondary";
        b.textContent = L(k);
        b.dataset.choice = choice;
        b.dataset.name = c.name;
        b.addEventListener("click", () => sync.resolve(c.name, choice));
        row.append(b);
      }
      box.append(lg, intro, dl, row);
      host_.append(box);
    }
  }

  sync.subscribe((s) => {
    last = s;
    if (s.pulls !== lastPulls) { lastPulls = s.pulls; try { onPulled(); } catch {} }
    if (s.phase === "conflicts" && s.conflicts.length !== announcedConflicts) { try { onConflicts(); } catch {} }
    announcedConflicts = s.phase === "conflicts" ? s.conflicts.length : 0;
    render();
  });

  /* ---- the form --------------------------------------------------------------- */
  const email = $("sync-email"), pass = $("sync-password");
  function readForm(signingUp) {
    const name = normalizeName(email.value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) { email.focus(); return { error: L("syncErrNeedEmail") }; }
    if (!pass.value) { pass.focus(); return { error: L("syncErrNeedPassword") }; }
    if (signingUp && pass.value.length < 8) { pass.focus(); return { error: L("syncErrShortPassword") }; }
    return { name, password: pass.value };
  }
  async function submit(signingUp) {
    const f = readForm(signingUp);
    formError = f.error || "";
    if (f.error) { render(); return; }
    render();
    $("sync-signin").disabled = $("sync-signup").disabled = true;
    $("sync-status").textContent = L("syncWorking");
    const r = await (signingUp ? sync.signUp : sync.signIn)(f.name, f.password);
    pass.value = "";                                   // the password is never kept
    $("sync-signin").disabled = $("sync-signup").disabled = false;
    if (r.status !== "ok") {
      formError = r.status === "unauthorized" ? L("syncErrBadLogin")
        : r.status === "conflict" ? L("syncErrTaken")
        : errorText(r.status);
      render();
      email.focus();
    } else { formError = ""; render(); }
  }
  $("sync-form").addEventListener("submit", (e) => { e.preventDefault(); pass.autocomplete = "current-password"; submit(false); });
  $("sync-signup").addEventListener("click", () => { pass.autocomplete = "new-password"; submit(true); });
  $("sync-now").addEventListener("click", () => sync.sync());
  $("sync-signout").addEventListener("click", async () => { await sync.signOut(); formError = ""; render(); $("sync-email").focus(); });

  // Back on the page or the network: catch up (only when signed in).
  addEventListener("online", () => sync.sync());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync.sync(); });

  $("lang-select").addEventListener("change", render);   // main.js has already set the language
  render();
  sync.resume();
  return { sync, render };
}
