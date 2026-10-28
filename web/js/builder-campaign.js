/**
 * Builder tab, Campaign view — what a gathering carries between games
 * (rulebook pp.65-76): treasury and deployment, sellswords, lair upgrades,
 * ambitions, treasures, improvements and the battle log.
 *
 * Renders HTML for builder-tab.js and handles the `data-act` events it
 * forwards. Every change goes through builder/campaign.js on the clone that
 * builder-tab's `edit` hands over, so this module holds no gathering state
 * of its own — only the treasure a reward or a roll has left to give out.
 */

import { state } from "./state.js";
import { escapeHtml } from "./util.js";
import { pickField } from "./i18n.js";
import { slug } from "./builder/catalog.js";
import { campaignStarted, treasureKind, lairMods } from "./builder/rules.js";
import { label, itemName } from "./builder/messages.js";
import {
  ensureCampaign, startCampaign, buyUpgrade, refundUpgrade, tickAmbition, completeAmbition,
  greaterOwed, rewardTargets, rollTreasure, treasureTable, giveTreasure, moveTreasure,
  freeSellsword, hireSellsword, addBattle, removeBattle,
} from "./builder/campaign.js";

const esc = escapeHtml;
const lang = () => state.lang || "en";
const L = (k) => label(k, lang());
const catalog = () => state.catalog;
const name = (key) => itemName(catalog(), key, lang());
const rows = (cat) => (catalog().bundle.categories[cat]?.rows || []).map(r => [`${cat}/${slug(r.name)}`, r]);
const modelTitle = (m) => (m.name ? `${m.name} (${name(m.profile)})` : name(m.profile));

/** A treasure waiting to be given out: {kind, choices?, greater?}. */
let pending = null;
/** Model chosen for each completed ambition's reward, by ambition key. */
const rewardPick = {};

/* ---- events ---------------------------------------------------------------- */

/** Handle a change event; returns true when it was a Campaign one. */
export function campaignChange(act, el, g) {
  const v = el.value;
  const { uid, from, i, key, stat } = el.dataset;
  ensureCampaign(g);
  switch (act) {
    case "treasury":    g.treasury = parseInt(v, 10) || 0; return true;
    case "deploy-base": g.deploymentLimit = parseInt(v, 10) || null; return true;
    case "opp-limit":   g.campaign.opponentLimit = parseInt(v, 10) || null; return true;
    case "field":       g.models.find(m => m.uid === uid).status = el.checked ? "active" : "reserve"; return true;
    case "hire":        if (v) hireSellsword(g, v, catalog()); return true;
    case "amb-add":     if (v && !g.ambitions.active.includes(v)) g.ambitions.active.push(v); return true;
    case "amb-target":  rewardPick[key] = v; return true;
    case "t-move":      if (v !== "") moveTreasure(g, from || null, Number(i), v === "stash" ? null : v); return true;
    case "t-add":       if (v) giveTreasure(g, v, null); return true;
    case "t-pick":      if (v && pending) pending = { ...pending, choices: [v] }; return true;
    case "imp": {
      const m = g.models.find(x => x.uid === uid);
      m.improvements = { ...(m.improvements || {}), [stat]: parseInt(v, 10) || 0 };
      return true;
    }
  }
  return false;
}

/** Handle a click; returns true when it was a Campaign one. */
export function campaignClick(act, el, g) {
  const { uid, key, i, step, from } = el.dataset;
  ensureCampaign(g);
  switch (act) {
    case "start":          startCampaign(g, catalog()); return true;
    case "upgrade-buy":    buyUpgrade(g, key, catalog()); return true;
    case "upgrade-refund": refundUpgrade(g, key, catalog()); return true;
    case "free-rabble":    hireSellsword(g, "sellswords/desperate-rabble", catalog(), { free: true }); return true;
    case "amb-tick":       tickAmbition(g, key, catalog(), Number(step)); return true;
    case "amb-drop":       g.ambitions.active = g.ambitions.active.filter(k => k !== key); return true;
    case "amb-complete": {
      const r = completeAmbition(g, key, catalog(), rewardPick[key] || null);
      if (r.treasure) pending = { kind: r.treasure };
      return true;
    }
    case "t-roll":         pending = { kind: el.dataset.kind, greater: el.dataset.kind === "greater",
                                       choices: rollTreasure(catalog(), el.dataset.kind) }; return true;
    case "t-claim-greater": pending = { kind: "greater", greater: true }; return true;
    case "t-take": {
      const to = document.getElementById(`t-to-${el.dataset.take}`)?.value || null;
      giveTreasure(g, key, to, { greaterClaim: !!pending?.greater });
      pending = null;
      return true;
    }
    case "t-cancel":       pending = null; return true;
    case "t-del": {
      const list = from ? g.models.find(m => m.uid === from).treasures : g.stash;
      list.splice(Number(i), 1);
      return true;
    }
    case "battle-add": {
      const val = (id) => document.getElementById(id)?.value || "";
      addBattle(g, {
        date: val("bl-date"), environment: val("bl-env"), mission: val("bl-mission"), omen: val("bl-omen"),
        result: val("bl-result"), obols: val("bl-obols"), notes: val("bl-notes").trim(),
      }, catalog());
      return true;
    }
    case "battle-del":     removeBattle(g, Number(i)); return true;
  }
  return false;
}

/* ---- rendering ------------------------------------------------------------- */

export function campaignHtml(g, ev) {
  ensureCampaign(g);
  if (!campaignStarted(g)) {
    const left = (ev.budget ?? 0) - ev.total;
    return `
      <div class="bd-panel">
        <p>${esc(L("notStarted"))} <b>${left} ${esc(L("obols"))}</b>.</p>
        <button type="button" class="primary" data-act="start">${esc(L("startCampaign"))}</button>
      </div>`;
  }
  return [deploymentHtml(g, ev), pendingHtml(g), ambitionsHtml(g), treasuresHtml(g),
          upgradesHtml(g), improvementsHtml(g, ev), battleLogHtml(g)].join("");
}

function deploymentHtml(g, ev) {
  const lm = lairMods(g, catalog());
  const base = g.deploymentLimit ?? catalog().rules.gathering?.deployment_limit ?? 350;
  const over = ev.fielded > ev.deploymentLimit;
  const fieldRows = g.models.map((m, i) => {
    const e = ev.models[i];
    const sw = e.isSellsword ? ` <span class="bd-tag">${esc(L("sellsword"))}</span>` : "";
    const cost = e.isSellsword
      ? `${e.cost} ${esc(L("rosterCost"))} · ${Number(catalog().row(m.profile)?.deploy_obols) || 0} ${esc(L("deployCost"))}`
      : e.cost;
    return `<label class="bd-field-row">
      <input type="checkbox" data-act="field" data-uid="${esc(m.uid)}" data-fid="${esc(m.uid)}-field"${(m.status || "active") === "active" ? " checked" : ""}>
      <span>${esc(modelTitle(m))}${sw}</span><small>${cost}</small></label>`;
  }).join("");
  const hires = rows("sellswords").filter(([, r]) => r.obols != null).map(([k, r]) =>
    `<option value="${esc(k)}">${esc(pickField(r, "name", lang()))} · ${r.obols} / ${r.deploy_obols}</option>`).join("");
  const free = freeSellsword(g, catalog());
  const rabble = free && !g.campaign.freeRabbleUsed
    ? `<button type="button" class="secondary" data-act="free-rabble">${esc(L("freeRabble"))}</button>` : "";
  return `
    <div class="bd-panel bd-grid2">
      <div>
        <h3>${esc(L("treasury"))}</h3>
        <label class="bd-num"><input type="number" data-act="treasury" data-fid="c-treasury" value="${Number(g.treasury) || 0}"> ${esc(L("obols"))}</label>
        <label class="bd-num">${esc(L("deployBase"))} <input type="number" step="50" data-act="deploy-base" data-fid="c-deploy" value="${base}"></label>
        ${lm.deployment ? `<small>+${lm.deployment} ${esc(L("lairBonus"))}</small>` : ""}
        <p><span class="wb-chip ${over ? "over" : "good"}"><b>${ev.fielded}</b> / ${ev.deploymentLimit} ${esc(L("fielded"))}</span></p>
      </div>
      <div>
        <h3>${esc(L("nextBattle"))}</h3>
        <label class="bd-num">${esc(L("oppLimit"))} <input type="number" step="50" data-act="opp-limit" data-fid="c-opp" value="${g.campaign.opponentLimit ?? ""}"></label>
        ${free ? `<p class="bd-good">${esc(L("freeSellsword"))}</p>${rabble}` : ""}
        <div class="bd-fields">${fieldRows}</div>
        <select data-act="hire" data-fid="c-hire"><option value="">${esc(L("hire"))}</option>${hires}</select>
      </div>
    </div>`;
}

/** Modal-ish strip for a treasure waiting to be handed out. */
function pendingHtml(g) {
  const owed = greaterOwed(g);
  const owedHtml = owed > 0 && !pending
    ? `<div class="bd-panel bd-callout"><b>${owed}</b> ${esc(L("greaterOwed"))}
         <button type="button" class="primary" data-act="t-claim-greater">${esc(L("treasureToTake"))}</button></div>` : "";
  if (!pending) return owedHtml;
  const kind = pending.kind;
  const recipients = [`<option value="">${esc(L("stash"))}</option>`,
    ...g.models.map(m => `<option value="${esc(m.uid)}">${esc(modelTitle(m))}</option>`)].join("");
  const choices = (pending.choices || []).map((k, n) => `
      <span class="bd-choice">${esc(name(k))}
        <select id="t-to-${n}">${recipients}</select>
        <button type="button" class="primary" data-act="t-take" data-key="${esc(k)}" data-take="${n}">${esc(L("add").replace("…", ""))}</button>
      </span>`).join("");
  const table = treasureTable(catalog(), kind).map((k, n) =>
    `<option value="${esc(k)}">${["I","II","III","IV","V","VI","VII","VIII","IX","X"][n] || n + 1} · ${esc(name(k))}</option>`).join("");
  return `
    <div class="bd-panel bd-callout">
      <h3>${esc(L("treasureToTake"))} (${esc(L(kind === "greater" ? "greaterT" : "minorT"))})</h3>
      <div class="bd-inline">
        <button type="button" class="secondary" data-act="t-roll" data-kind="${kind}">🎲 ${esc(L(kind === "greater" ? "rollGreater" : "rollMinor"))}</button>
        <select data-act="t-pick" data-fid="c-tpick"><option value="">${esc(L("pickTreasure"))}</option>${table}</select>
        <button type="button" class="secondary" data-act="t-cancel">✕</button>
      </div>
      ${choices ? `<div class="bd-choices">${choices}</div>` : ""}
    </div>`;
}

function ambitionsHtml(g) {
  const a = g.ambitions;
  const active = a.active.map(key => {
    const r = catalog().row(key) || {};
    const goal = Number(r.goal) || 1;
    const prog = a.progress[key] || 0;
    const eff = r.reward_effect || {};
    const done = prog >= goal;
    const targets = eff.target === "choose" ? rewardTargets(g, catalog(), key) : [];
    const pick = targets.length ? `<select data-act="amb-target" data-key="${esc(key)}" data-fid="c-amb-${esc(key)}">
        <option value="">${esc(L("chooseModel_"))}</option>
        ${targets.map(m => `<option value="${esc(m.uid)}"${rewardPick[key] === m.uid ? " selected" : ""}>${esc(modelTitle(m))}</option>`).join("")}
      </select>` : "";
    const canComplete = done && (eff.target !== "choose" || rewardPick[key]);
    return `
      <div class="bd-amb${done ? " done" : ""}">
        <div class="bd-amb-head">
          <b>${esc(name(key))}</b> <small>${esc(pickField(r, "restrictions", lang()) || "")}</small>
          <span class="spacer"></span>
          <button type="button" class="secondary" data-act="amb-tick" data-key="${esc(key)}" data-step="-1">−</button>
          <span class="bd-prog">${prog} / ${goal}</span>
          <button type="button" class="secondary" data-act="amb-tick" data-key="${esc(key)}" data-step="1">+</button>
          <button type="button" class="secondary" data-act="amb-drop" data-key="${esc(key)}" title="${esc(L("remove"))}">✕</button>
        </div>
        <div class="bd-amb-text">${esc(pickField(r, "condition", lang()) || "")} → ${esc(pickField(r, "reward", lang()) || "")}</div>
        ${done ? `<div class="bd-inline">${pick}<button type="button" class="primary" data-act="amb-complete" data-key="${esc(key)}"${canComplete ? "" : " disabled"}>${esc(L("complete"))}</button></div>` : ""}
      </div>`;
  }).join("");
  const groups = new Map();
  for (const [k, r] of rows("ambitions")) {
    if (a.active.includes(k)) continue;
    const path = pickField(r, "restrictions", lang()) || "";
    if (!groups.has(path)) groups.set(path, []);
    groups.get(path).push(`<option value="${esc(k)}">${esc(pickField(r, "name", lang()))} (${r.goal})</option>`);
  }
  const add = [...groups].map(([p, os]) => `<optgroup label="${esc(p)}">${os.join("")}</optgroup>`).join("");
  return `
    <div class="bd-panel">
      <h3>${esc(L("ambitions"))} <small>${a.active.length} / 4 ${esc(L("active"))} · ${a.completed} ${esc(L("completed"))}</small></h3>
      ${active}
      <select data-act="amb-add" data-fid="c-amb-add"><option value="">${esc(L("addAmbition"))}</option>${add}</select>
    </div>`;
}

function treasuresHtml(g) {
  const dests = (from) => [`<option value="">${esc(L("moveTo"))}</option>`,
    ...(from ? [`<option value="stash">${esc(L("stash"))}</option>`] : []),
    ...g.models.filter(m => m.uid !== from).map(m => `<option value="${esc(m.uid)}">${esc(modelTitle(m))}</option>`)].join("");
  const chip = (key, idx, from) => {
    const kind = treasureKind(catalog(), key);
    return `<span class="bd-item">${esc(name(key))} <small>${esc(L(kind === "greater" ? "greaterT" : "minorT"))}</small>
      <select data-act="t-move" data-from="${esc(from || "")}" data-i="${idx}">${dests(from)}</select>
      <button type="button" data-act="t-del" data-from="${esc(from || "")}" data-i="${idx}" title="${esc(L("remove"))}">✕</button></span>`;
  };
  const holders = [
    [L("stash"), null, g.stash],
    ...g.models.map(m => [modelTitle(m), m.uid, m.treasures || []]),
  ].filter(([, uid, list]) => list.length || uid === null);
  const all = ["minor-treasures", "greater-treasures", "potions", "throwing-pots"].map(cat =>
    `<optgroup label="${esc(catalog().bundle.categories[cat]?.title || cat)}">` +
    rows(cat).map(([k, r]) => `<option value="${esc(k)}">${esc(pickField(r, "name", lang()))}</option>`).join("") + `</optgroup>`).join("");
  return `
    <div class="bd-panel">
      <h3>${esc(L("treasures"))}</h3>
      ${holders.map(([title, uid, list]) => `
        <div class="bd-list"><h4>${esc(title)}</h4>
          <div class="bd-items">${list.map((k, n) => chip(k, n, uid)).join("") || "<small>—</small>"}</div></div>`).join("")}
      <div class="bd-inline">
        <select data-act="t-add" data-fid="c-tadd"><option value="">${esc(L("addTreasure"))}</option>${all}</select>
        <button type="button" class="secondary" data-act="t-roll" data-kind="minor">🎲 ${esc(L("rollMinor"))}</button>
      </div>
    </div>`;
}

function upgradesHtml(g) {
  const owned = new Set(g.lair.upgrades);
  const items = rows("lair-upgrades").map(([k, r]) => `
    <div class="bd-upgrade${owned.has(k) ? " owned" : ""}">
      <div><b>${esc(pickField(r, "name", lang()))}</b> <small>${r.obols}</small></div>
      <div class="bd-amb-text">${esc(String(pickField(r, "effect", lang()) || "").trim())}</div>
      ${owned.has(k)
        ? `<span class="bd-good">✓ ${esc(L("owned"))}</span> <button type="button" class="secondary" data-act="upgrade-refund" data-key="${esc(k)}">${esc(L("refund"))}</button>`
        : `<button type="button" class="secondary" data-act="upgrade-buy" data-key="${esc(k)}">${esc(L("buy"))} · ${r.obols}</button>`}
    </div>`).join("");
  return `<div class="bd-panel"><h3>${esc(L("lairUpgrades"))}</h3><div class="bd-upgrades">${items}</div></div>`;
}

function improvementsHtml(g, ev) {
  const stats = ["ap", "move", "violence", "ranged", "hp"];
  const head = `<tr><th></th>${stats.map(s => `<th>${esc(L(s))}</th>`).join("")}<th>${esc(L("mana"))}</th><th>${esc(L("spells"))}</th></tr>`;
  const body = g.models.map((m, i) => {
    if (ev.models[i].isSellsword) return "";
    const leader = ev.models[i].isLeader;
    const cell = (s) => `<td><input type="number" data-act="imp" data-uid="${esc(m.uid)}" data-stat="${s}" data-fid="${esc(m.uid)}-imp-${s}" value="${Number(m.improvements?.[s]) || 0}"></td>`;
    return `<tr><td>${esc(modelTitle(m))}</td>${stats.map(cell).join("")}${leader ? cell("mana") + cell("spells") : "<td></td><td></td>"}</tr>`;
  }).join("");
  return `
    <div class="bd-panel">
      <h3>${esc(L("improvements"))}</h3>
      <p class="bd-hint">${esc(L("improvementsHint"))}</p>
      <div class="bd-table-wrap"><table class="bd-table">${head}${body}</table></div>
    </div>`;
}

function battleLogHtml(g) {
  const opt = (cat, none) => `${none ? `<option value="">${esc(L("none"))}</option>` : ""}` +
    rows(cat).map(([k, r]) => `<option value="${esc(k)}">${esc(pickField(r, "name", lang()))}</option>`).join("");
  const res = (r) => (r ? L(r) : "—");
  const entries = g.history.map((e, n) => [e, n]).reverse().map(([e, n]) => `
    <tr><td>${esc(e.date || "")}</td><td>${esc(e.environment ? name(e.environment) : "—")}</td>
      <td>${esc(e.mission ? name(e.mission) : "—")}</td><td>${esc(e.omen ? name(e.omen) : "—")}</td>
      <td>${esc(res(e.result))}</td><td>${e.obols || 0}</td><td>${esc(e.notes || "")}</td>
      <td><button type="button" class="secondary" data-act="battle-del" data-i="${n}" title="${esc(L("remove"))}">✕</button></td></tr>`).join("");
  return `
    <div class="bd-panel">
      <h3>${esc(L("battleLog"))}</h3>
      <div class="bd-table-wrap"><table class="bd-table bd-log">
        <tr><th>${esc(L("date"))}</th><th>${esc(L("environment"))}</th><th>${esc(L("mission"))}</th><th>${esc(L("omen"))}</th>
            <th>${esc(L("result"))}</th><th>${esc(L("obolsGained"))}</th><th>${esc(L("notes"))}</th><th></th></tr>
        ${entries || `<tr><td colspan="8"><small>${esc(L("noBattles"))}</small></td></tr>`}
        <tr class="bd-log-form">
          <td><input type="date" id="bl-date" value="${new Date().toISOString().slice(0, 10)}"></td>
          <td><select id="bl-env">${opt("environments", true)}</select></td>
          <td><select id="bl-mission">${opt("missions", true)}</select></td>
          <td><select id="bl-omen">${opt("dread-omens", true)}</select></td>
          <td><select id="bl-result"><option value="win">${esc(L("win"))}</option><option value="loss">${esc(L("loss"))}</option><option value="draw">${esc(L("draw"))}</option></select></td>
          <td><input type="number" id="bl-obols" value="0"></td>
          <td><input type="text" id="bl-notes"></td>
          <td><button type="button" class="primary" data-act="battle-add">${esc(L("logBattle"))}</button></td>
        </tr>
      </table></div>
    </div>`;
}
