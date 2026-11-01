/**
 * Themed replacements for the browser's confirm() and alert(), on one shared
 * native <dialog>. showModal gives the focus trap and Esc; Esc or a click on
 * the backdrop cancels; focus returns to the opener. A destructive confirm
 * starts on Cancel.
 *
 *   if (await confirmDialog(msg, { okLabel: "Delete", danger: true })) …
 *   await alertDialog(msg);
 */
import { state } from "./state.js";
import { label } from "./builder/messages.js";

let box, msgEl, okBtn, cancelBtn, pending = null;

function build() {
  box = document.createElement("dialog");
  box.className = "nc-dialog";
  box.setAttribute("aria-labelledby", "nc-dialog-msg");
  box.innerHTML = `<p id="nc-dialog-msg"></p><div class="nc-dialog-actions">
    <button type="button" class="secondary" data-nd="cancel"></button>
    <button type="button" class="primary" data-nd="ok"></button></div>`;
  msgEl = box.querySelector("p");
  cancelBtn = box.querySelector('[data-nd="cancel"]');
  okBtn = box.querySelector('[data-nd="ok"]');
  okBtn.addEventListener("click", () => box.close("ok"));
  cancelBtn.addEventListener("click", () => box.close("cancel"));
  box.addEventListener("click", (e) => { if (e.target === box) box.close("cancel"); });
  box.addEventListener("close", () => {
    const done = pending;
    pending = null;
    done?.(box.returnValue === "ok");
  });
  document.body.append(box);
}

function ask(message, { okLabel, danger = false, alertOnly = false } = {}) {
  if (!box) build();
  pending?.(false);                          // a second ask cancels the first
  if (box.open) box.close("cancel");
  const lang = state.lang || "en";
  msgEl.textContent = message;
  okBtn.textContent = okLabel || label("ok", lang);
  cancelBtn.textContent = label("cancel", lang);
  cancelBtn.hidden = alertOnly;
  okBtn.classList.toggle("danger", danger);
  const opener = document.activeElement;
  return new Promise((resolve) => {
    pending = (v) => { resolve(v); if (opener?.isConnected) opener.focus?.(); };
    box.returnValue = "cancel";
    box.showModal();
    (danger && !alertOnly ? cancelBtn : okBtn).focus();
  });
}

/** @returns {Promise<boolean>} true when the player chose the ok button */
export const confirmDialog = (message, opts = {}) => ask(message, opts);
/** @returns {Promise<void>} */
export const alertDialog = (message) => ask(message, { alertOnly: true }).then(() => {});
