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
  // Campaign view
  viewGathering:  ["Gathering", "Séquito"],
  viewCampaign:   ["Campaign", "Campaña"],
  notStarted:     ["The campaign hasn't started. Starting it turns the obols left from the 300 into your treasury:",
                   "La campaña no ha empezado. Al empezarla, los óbolos que sobran de los 300 pasan a tu tesoro:"],
  startCampaign:  ["Start campaign", "Empezar campaña"],
  firstBuild:     ["first build", "primera creación"],
  alreadyBuilt:   ["Band already built? Start campaign", "¿Banda ya creada? Empezar campaña"],
  treasury:       ["Treasury", "Tesoro"],
  deployBase:     ["Base deployment limit", "Límite de despliegue base"],
  lairBonus:      ["from the lair", "por la guarida"],
  fielded:        ["fielded", "desplegados"],
  nextBattle:     ["Next battle", "Próxima batalla"],
  oppLimit:       ["Opponent's deployment limit", "Límite de despliegue del rival"],
  freeSellsword:  ["Your opponent's limit is 100+ higher: you may deploy a sellsword for free.",
                   "El límite del rival es 100+ mayor: puedes desplegar un mercenario gratis."],
  freeRabble:     ["Add the Desperate Rabble for free (first game against such an opponent)",
                   "Añadir la Chusma Desesperada gratis (primera partida contra un rival así)"],
  field:          ["Field", "Desplegar"],
  hire:           ["Hire a sellsword…", "Contratar un mercenario…"],
  sellsword:      ["Sellsword", "Mercenario"],
  rosterCost:     ["roster", "lista"],
  deployCost:     ["deploy", "despliegue"],
  armaments:      ["Armaments", "Armamento"],
  lairUpgrades:   ["Lair upgrades", "Mejoras de la guarida"],
  buy:            ["Buy", "Comprar"],
  owned:          ["Owned", "Comprada"],
  refund:         ["Undo", "Deshacer"],
  ambitions:      ["Ambitions", "Ambiciones"],
  active:         ["active", "activas"],
  addAmbition:    ["Add an ambition…", "Añadir una ambición…"],
  complete:       ["Complete", "Cumplir"],
  chooseModel_:   ["Choose a model…", "Elige una miniatura…"],
  completed:      ["completed", "cumplidas"],
  greaterOwed:    ["greater treasure earned (1 per 5 ambitions)", "tesoro mayor ganado (1 por cada 5 ambiciones)"],
  treasureToTake: ["Treasure to take", "Tesoro por recibir"],
  rollMinor:      ["Roll a minor treasure", "Tirar un tesoro menor"],
  rollGreater:    ["Roll 2d10, keep one", "Tirar 2D10 y quedarse uno"],
  pickTreasure:   ["…or pick one", "…o elige uno"],
  giveTo:         ["Give to", "Dar a"],
  stash:          ["Unassigned", "Sin asignar"],
  treasures:      ["Treasures", "Tesoros"],
  minorT:         ["minor", "menor"],
  greaterT:       ["greater", "mayor"],
  moveTo:         ["Move to…", "Mover a…"],
  addTreasure:    ["Add a treasure…", "Añadir un tesoro…"],
  improvements:   ["Model improvements", "Mejoras de las miniaturas"],
  improvementsHint: ["Changes from ambitions, maladies and other campaign events. Limits: AP +1, Move/Violence/Ranged +2, HP +5.",
                   "Cambios por ambiciones, dolencias y otros sucesos de campaña. Límites: PA +1, Mov/Violencia/A Dist. +2, HP +5."],
  battleLog:      ["Battle log", "Registro de batallas"],
  date:           ["Date", "Fecha"],
  environment:    ["Environment", "Entorno"],
  mission:        ["Mission", "Misión"],
  omen:           ["Omen", "Augurio"],
  result:         ["Result", "Resultado"],
  win:            ["Win", "Victoria"],
  loss:           ["Loss", "Derrota"],
  draw:           ["Draw", "Empate"],
  obolsGained:    ["Obols gained", "Óbolos ganados"],
  notes:          ["Notes", "Notas"],
  logBattle:      ["Log battle", "Registrar batalla"],
  none:           ["—", "—"],
  noBattles:      ["No battles yet.", "Aún no hay batallas."],
  // After-battle sequence
  afterBattle:    ["After the battle…", "Tras la batalla…"],
  afterBattleT:   ["After-battle sequence", "Secuencia tras la batalla"],
  battle:         ["Battle", "Batalla"],
  leaderShattered:["The leader was Shattered", "El líder fue Hecho añicos"],
  begin:          ["Begin", "Empezar"],
  back:           ["Back", "Atrás"],
  next:           ["Next", "Siguiente"],
  discard:        ["Discard", "Descartar"],
  confirmDiscard: ["Discard this after-battle sequence? What it already applied stays.",
                   "¿Descartar esta secuencia? Lo que ya se aplicó se mantiene."],
  finish:         ["Finish and log the battle", "Terminar y registrar la batalla"],
  notShattered:   ["The leader wasn't Shattered: nothing to roll.", "El líder no fue Hecho añicos: no hay que tirar."],
  fullHp:         ["All models are restored to full HP.", "Todas las miniaturas del Séquito son restauradas a sus HP completos."],
  roll:           ["Roll", "Tirar"],
  orType:         ["or type the die", "o escribe el dado"],
  apply:          ["Apply", "Aplicar"],
  applied:        ["Applied", "Aplicado"],
  opponentPicks:  ["your opponent picks", "elige tu oponente"],
  youPick:        ["you pick", "eliges tú"],
  noMinorOnLeader:["Your leader carries no minor treasure.", "Tu líder no lleva ningún tesoro menor."],
  treasureLost:   ["Treasure lost", "Tesoro perdido"],
  obolsAdded:     ["obols added", "óbolos añadidos"],
  treasureRolls:  ["minor treasure rolls left", "tiradas de tesoro menor pendientes"],
  rollTreasure:   ["Roll a minor treasure", "Tirar un tesoro menor"],
  lairIncome:     ["Lair income", "Ingresos de la guarida"],
  purloiner:      ["Purloiner", "Ladrón"],
  ifUnderMove:    ["if the first die is at most its Move", "si el primer dado es como mucho su Movimiento"],
  stepMinor:      ["Tick each ambition this battle met.", "Marca cada ambición que se cumplió en esta batalla."],
  stepAmbitions:  ["Complete the ambitions that reached their goal, and apply their rewards.",
                   "Cumple las ambiciones que alcanzaron su objetivo y aplica sus recompensas."],
  stepTotal:      ["Every 5 completed ambitions earn a greater treasure.", "Cada 5 ambiciones cumplidas dan un tesoro mayor."],
  noneOwed:       ["No greater treasure owed.", "No se debe ningún tesoro mayor."],
  markets:        ["Markets", "Mercados"],
  buyGear:        ["Buy", "Comprar"],
  forModel:       ["for", "para"],
  recruit:        ["Recruit", "Reclutar"],
  sell:           ["Sell", "Vender"],
  soulBinder:     ["Soul Binder", "Remienda Almas"],
  noMaladies:     ["No maladies to remove.", "No hay dolencias que eliminar."],
  tombRobber:     ["Tomb Robber", "Saqueador de Tumbas"],
  tombUsed:       ["Already used by this gathering.", "Este Séquito ya lo ha usado."],
  payTake:        ["Pay and take", "Pagar y quedárselo"],
  decline:        ["Decline", "Rechazar"],
  alchemy:        ["Alchemy Workshop", "Taller de Alquimia"],
  alchemyDone:    ["Bought this time.", "Ya comprado esta vez."],
  maladies:       ["Maladies", "Dolencias"],
  bothAgree:      ["Both players agree to a dread omen", "Ambos jugadores acuerdan un augurio siniestro"],
  rerollOmen:     ["Reroll (Read the Omens)", "Repetir (Leer los Augurios)"],
  nextScenario:   ["Next scenario", "Próximo escenario"],
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
    case "over-budget":         return es ? `${p.total} óbolos gastados de los ${p.budget} de la primera creación. Si la banda ya está creada, empieza su campaña.`
                                          : `${p.total} obols spent of the ${p.budget} for the first build. If the band is already built, start its campaign.`;
    case "over-deployment":     return es ? `${p.total} óbolos desplegados; el límite es ${p.limit}.` : `${p.total} obols fielded; the deployment limit is ${p.limit}.`;
    case "too-many-treasures":  return es ? `${p.count} tesoros ${p.kind === "greater" ? "mayores" : "menores"}; puede llevar ${p.max}.`
                                          : `${p.count} ${p.kind} treasures; it can carry ${p.max}.`;
    case "duplicate-greater":   return es ? "Los tesoros mayores que lleve un líder deben ser distintos." : "A leader's greater treasures must be different.";
    case "deployment-cap":      return es ? `Límite de despliegue ${p.limit}; el máximo es ${p.max}.` : `Deployment limit ${p.limit}; the most it can reach is ${p.max}.`;
    case "too-many-sellswords": return es ? `${p.count} mercenarios desplegados; solo se permite 1 por escenario.` : `${p.count} sellswords fielded; only 1 per scenario.`;
    case "treasury-negative":   return es ? `El tesoro está en ${p.treasury} óbolos.` : `The treasury is at ${p.treasury} obols.`;
    case "duplicate-upgrade":   return es ? `${item} solo puede comprarse una vez.` : `${item} can only be bought once.`;
    case "too-many-ambitions":  return es ? `${p.count} ambiciones activas; el máximo es 4.` : `${p.count} active ambitions; the most is 4.`;
    default:                    return w.code;
  }
}
