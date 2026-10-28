/**
 * Builder text in English and Spanish: the warnings rules.js reports, and
 * the Builder tab's labels.
 *
 * Unlike the rest of the app's chrome, the builder follows the card-language
 * selector, as the Warband roster does: it is where players read rules.
 * Item names come from the card rows (`name_es`), so they always match the
 * printed cards.
 */

import { pickField, LABELS } from "../i18n.js";

/** One label in the given language, English when there is no Spanish. */
export function label(key, lang) {
  const e = UI[key];
  if (!e) return key;
  return (lang === "es" && e[1]) || e[0];
}

const UI = {
  builder:        ["Builder", "Constructor"],
  gathering:      ["Gathering", "Séquito"],
  newGathering:   ["New gathering", "Nuevo séquito"],
  duplicate:      ["Duplicate", "Duplicar"],
  delete:         ["Delete", "Borrar"],
  confirmDelete:  ["Delete this gathering?", "¿Borrar este séquito?"],
  name:           ["Name", "Nombre"],
  untitled:       ["Untitled gathering", "Séquito sin nombre"],
  copySuffix:     ["(copy)", "(copia)"],
  covenant:       ["Covenant", "Pacto"],
  chooseCovenant: ["Choose a covenant…", "Elige un pacto…"],
  lair:           ["Lair", "Guarida"],
  rollLair:       ["Roll", "Tirar"],
  pickLair:       ["Pick from the table…", "Elegir de la tabla…"],
  obols:          ["obols", "óbolos"],
  spent:          ["spent", "gastados"],
  of:             ["of", "de"],
  deployment:     ["deployment limit", "límite de despliegue"],
  model:          ["model", "miniatura"],
  models:         ["models", "miniaturas"],
  warning:        ["warning", "aviso"],
  warnings:       ["warnings", "avisos"],
  noWarnings:     ["No rule warnings", "Sin avisos"],
  viewRoster:     ["View roster", "Ver lista"],
  addCards:       ["Add cards to queue", "Añadir cartas a la cola"],
  copyLink:       ["Copy Companion link", "Copiar enlace del Companion"],
  exportJson:     ["Export JSON", "Exportar JSON"],
  backup:         ["Backup", "Copia de seguridad"],
  linkCopied:     ["Companion App link copied.", "Enlace del Companion copiado."],
  cardsAdded:     ["cards added to the print queue.", "cartas añadidas a la cola de impresión."],
  addModel:       ["Add model", "Añadir miniatura"],
  chooseModel:    ["Choose a model…", "Elige una miniatura…"],
  leaders:        ["Leaders", "Líderes"],
  minions:        ["Minions", "Secuaces"],
  remove:         ["Remove", "Quitar"],
  modelName:      ["Model name", "Nombre de la miniatura"],
  affinity:       ["Keyword", "Palabra clave"],
  chooseAffinity: ["Choose…", "Elige…"],
  traits:         ["Traits", "Rasgos"],
  spells:         ["Spells", "Hechizos"],
  weapons:        ["Weapons", "Armas"],
  armour:         ["Armour", "Armadura"],
  equipment:      ["Equipment", "Equipo"],
  mana:           ["Mana", "Maná"],
  add:            ["Add…", "Añadir…"],
  free:           ["free", "gratis"],
  empty:          ["No gatherings yet. Start a new one, or import one from the Companion App in the Import tab.",
                   "Aún no hay séquitos. Crea uno nuevo o importa uno del Companion App en la pestaña Import."],
  noModels:       ["Add a leader to start.", "Añade un líder para empezar."],
  blood:          ["Blood", "Sangre"],
  bone:           ["Bone", "Hueso"],
  plasm:          ["Plasm", "Plasma"],
  ap:             ["AP", "PA"],
  move:           ["Move", "Mov"],
  violence:       ["Violence", "Violencia"],
  ranged:         ["Ranged", "A Dist."],
  hp:             ["HP", "HP"],
};

/** A row key's card name in the given language. */
export function itemName(catalog, key, lang) {
  const row = catalog.row(key);
  if (!row) return key || "?";
  return pickField(row, "name", lang) || row.name || key;
}

/** A keyword ("Blood", "Beast") in the given language. */
function keyword(k, lang) {
  if (lang !== "es") return k;
  const aff = String(k).toLowerCase();
  if (UI[aff]) return UI[aff][1];
  return LABELS[k] || { Beast: "Bestia", Husk: "Cáscara", Remnant: "Remanente", Fly: "Volar",
                        Colossal: "Colosal", Familiar: "Familiar" }[k] || k;
}

const list = (xs, lang) => xs.join(lang === "es" ? " o " : " or ");

/**
 * A warning from rules.js as one sentence.
 * @param {{code, item?, params?}} w
 */
export function describe(w, catalog, lang = "en") {
  const es = lang === "es";
  const p = w.params || {};
  const item = w.item ? itemName(catalog, w.item, lang) : "";
  const stat = p.stat ? label(p.stat, lang) : "";
  switch (w.code) {
    case "unknown-item":        return es ? `Elemento desconocido: ${item}.` : `Unknown item: ${item}.`;
    case "no-covenant":         return es ? "Elige un pacto." : "Choose a covenant.";
    case "no-leader":           return es ? "El séquito necesita un líder." : "The gathering needs a leader.";
    case "multiple-leaders":    return es ? `Solo puede haber un líder (hay ${p.count}).` : `Only one leader allowed (there are ${p.count}).`;
    case "affinity-missing":    return es ? "Elige Sangre, Hueso o Plasma." : "Choose Blood, Bone or Plasm.";
    case "affinity-not-allowed":return es ? `Esta miniatura no puede elegir ${label(p.affinity, lang)}.` : `This model can't choose ${label(p.affinity, lang)}.`;
    case "duplicate-trait":     return es ? `${item} está repetido.` : `${item} is taken twice.`;
    case "trait-requirement":   return es ? `Esta miniatura no cumple los requisitos de ${item}.` : `This model doesn't meet the requirements of ${item}.`;
    case "improvement-cap":     return es ? `${stat} supera su límite de mejora (+${p.max}).` : `${stat} is improved past its limit (+${p.max}).`;
    case "forbidden-item":      return es ? `Esta miniatura no puede llevar ${item}.` : `This model can't take ${item}.`;
    case "weapon-not-allowed":  return es ? `Esta miniatura no puede usar ${item}.` : `This model can't use ${item}.`;
    case "too-many-hands":      return es ? `Necesita ${p.hands} manos; una miniatura tiene 2.` : `Needs ${p.hands} hands; a model has 2.`;
    case "multiple-armour":     return es ? "Solo puede llevar una armadura." : "Only one suit of armour.";
    case "multiple-shields":    return es ? "Solo puede llevar un escudo." : "Only one shield.";
    case "too-much-equipment":  return es ? `Solo ${p.max} pieza de equipo misceláneo.` : `Only ${p.max} piece of miscellaneous equipment.`;
    case "too-many-traits":     return es ? `${p.count} rasgos; el máximo es ${p.max}.` : `${p.count} traits; the most is ${p.max}.`;
    case "basic-trait-count":   return es ? "El líder elige exactamente 1 Rasgo Básico de Líder." : "The leader takes exactly 1 Basic Leader Trait.";
    case "spell-count":         return es ? `${p.count} hechizos; le corresponden ${p.allowed}.` : `${p.count} spells; it should have ${p.allowed}.`;
    case "summon-missing":      return es ? "Todo líder conoce Invocación." : "Every leader knows Summon.";
    case "mana-split":          return es ? `Puntos de maná repartidos: ${p.count} de ${p.allowed}.` : `Mana points split: ${p.count} of ${p.allowed}.`;
    case "spells-on-minion":    return es ? "Solo los líderes conocen hechizos." : "Only leaders know spells.";
    case "covenant-keyword":    return es ? `Este pacto solo admite miniaturas con ${list((p.needs || []).map(k => keyword(k, lang)), lang)}.`
                                          : `This covenant only allows models with ${list(p.needs || [], lang)}.`;
    case "covenant-leader-type":return es ? `El líder de este pacto debe ser ${list((p.types || []).map(k => itemName(catalog, k, lang)), lang)}.`
                                          : `This covenant's leader must be a ${list((p.types || []).map(k => itemName(catalog, k, lang)), lang)}.`;
    case "covenant-spell-school": return es ? `${item}: este pacto empieza solo con hechizos de Nigromancia.` : `${item}: this covenant starts with Necromancy spells only.`;
    case "covenant-leader-trait-missing": return es ? `Al líder le falta el rasgo del pacto, ${item}.` : `The leader is missing the covenant's trait, ${item}.`;
    case "unique-model":        return es ? `Solo puede haber 1 ${item} por séquito.` : `Only 1 ${item} per gathering.`;
    case "unique-trait":        return es ? `Solo una miniatura puede tener ${item}.` : `Only one model may take ${item}.`;
    case "covenant-traits":     return es ? `${p.count} rasgos de pacto o de No Muertos Miserables; se permiten ${p.allowed}.`
                                          : `${p.count} covenant or Wretched Undead traits; ${p.allowed} allowed.`;
    case "over-budget":         return es ? `${p.total} óbolos gastados de ${p.budget}.` : `${p.total} obols spent of ${p.budget}.`;
    case "over-deployment":     return es ? `${p.total} óbolos desplegados; el límite es ${p.limit}.` : `${p.total} obols fielded; the deployment limit is ${p.limit}.`;
    default:                    return w.code;
  }
}
