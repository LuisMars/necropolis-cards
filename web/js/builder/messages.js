/**
 * The app's interface text in English and Spanish: the warnings rules.js
 * reports, the Builder's labels and the rest of the app's chrome (header,
 * Library, Import, print queue, roster screen, footer).
 *
 * All of it follows the Language setting. Spanish game terms follow the
 * official Spanish rulebook, as transcribed in the `_es` fields of data/*.yaml
 * (Séquito, esbirro, óbolos, Guarida, Mejora de la Guarida…). Item names come
 * from the card rows (`name_es`), so they always match the printed cards.
 *
 * A label written "one|other" is a count: read it with `plural()`.
 */

import { pickField, LABELS } from "../i18n.js";

/** One label in the given language, English when there is no Spanish. */
export function label(key, lang) {
  const e = UI[key];
  if (!e) return key;
  return (lang === "es" && e[1]) || e[0];
}

/** Put `{name}` values into a label; unknown names are left as they are. */
export const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

/** A count: the label holds "one|other" forms, and `{n}` (plus any other
 *  `{name}` in `vars`) is filled in. Both languages use the singular for 1
 *  only. */
export function plural(key, n, lang, vars = {}) {
  const [one, other = one] = label(key, lang).split("|");
  return fill(n === 1 ? one : other, { n, ...vars });
}

/** A Library category ("cat", by key) or group ("group", by English title)
 *  in the given language; `fallback` (the bundle's title) when unknown. */
export function categoryTitle(kind, id, fallback, lang) {
  return UI[`${kind}-${id}`] ? label(`${kind}-${id}`, lang) : fallback;
}

const UI = {
  builder:        ["Builder", "Constructor"],
  gathering:      ["Gathering", "Séquito"],
  newGathering:   ["New gathering", "Nuevo Séquito"],
  workspace:      ["Builder workspace", "Espacio del constructor"],
  ruleWarnings:   ["Rule warnings", "Avisos de reglas"],
  noAffinity:     ["No keyword chosen", "Sin palabra clave"],
  // Drafts
  unsaved:        ["These changes aren't saved yet.", "Estos cambios aún no están guardados."],
  unsavedShort:   ["unsaved", "sin guardar"],
  saveChanges:    ["Save changes", "Guardar cambios"],
  discardChanges: ["Discard changes", "Descartar cambios"],
  confirmDiscardDraft: ["Discard the unsaved changes to this gathering?", "¿Descartar los cambios sin guardar de este Séquito?"],
  saved:          ["Changes saved.", "Cambios guardados."],
  // Ledger
  obolsSpent:     ["Obols spent", "Óbolos gastados"],
  rosterValue:    ["Model value", "Valor de las miniaturas"],
  deploymentLimit:["Deployment limit", "Límite de despliegue"],
  modelsLabel:    ["Models", "Miniaturas"],
  firstBuildNote: ["A new gathering has 300 obols to spend.", "Un Séquito nuevo tiene 300 óbolos para gastar."],
  hideWarnings:   ["Hide the warnings", "Ocultar los avisos"],
  showAll:        ["show them all", "verlos todos"],
  shareExport:    ["Share or export", "Compartir o exportar"],
  lairPlaceholder:["Name it, roll it or pick one", "Escríbelo, tíralo o elige uno"],
  modelType:      ["Model type", "Tipo de miniatura"],
  moveUp:         ["Move up", "Subir"],
  moveDown:       ["Move down", "Bajar"],
  removeModel:    ["Remove", "Quitar"],
  addTrait:       ["Add trait", "Añadir rasgo"],
  addSpell:       ["Add spell", "Añadir hechizo"],
  addWeapon:      ["Add weapon", "Añadir arma"],
  addArmour:      ["Add armour", "Añadir armadura"],
  addEquipment:   ["Add equipment", "Añadir equipo"],
  rosterPart:     ["Roster", "Lista"],
  rosterSheet:    ["Sheet", "Hoja"],
  rosterCards:    ["Cards", "Cartas"],
  skipOwned:      ["Skip cards I already have", "Omitir las cartas que ya tengo"],
  cardsSheets:    ["Cards: {cards} · Sheets: {sheets}", "Cartas: {cards} · Hojas: {sheets}"],
  allOwned:       ["Every card of this gathering is already printed.", "Todas las cartas de este Séquito ya están impresas."],
  noneYet:        ["None yet", "Ninguno aún"],
  filterOptions:  ["Type to filter…", "Escribe para filtrar…"],
  pick_traits:    ["Add a trait to {model}", "Añadir un rasgo a {model}"],
  pick_spells:    ["Add a spell to {model}", "Añadir un hechizo a {model}"],
  pick_weapons:   ["Add a weapon to {model}", "Añadir un arma a {model}"],
  pick_armour:    ["Add armour to {model}", "Añadir armadura a {model}"],
  pick_equipment: ["Add equipment to {model}", "Añadir equipo a {model}"],
  pickerSearch:   ["Search by name, kind or rules", "Busca por nombre, tipo o reglas"],
  pickerNone:     ["No matches", "Sin resultados"],
  filterByKind:   ["Show only", "Mostrar solo"],
  allKinds:       ["All", "Todo"],
  fromStash:      ["From the stash (free)", "Del almacén (gratis)"],
  buyAtMarkets:   ["Buy at the Markets", "Comprar en los Mercados"],
  addedItem:      ["Added {item}.", "Añadido: {item}."],
  done:           ["Done", "Hecho"],
  attacksShort:   ["Attacks", "Ataques"],
  damageShort:    ["Damage", "Daño"],
  rangeShort:     ["Range", "Alcance"],
  handsShort:     ["-handed", " mano(s)"],
  armourShort:    ["Armour", "Armadura"],
  apShort:        ["AP", "PA"],
  channelShort:   ["Channel", "Canalización"],
  removeTitle:    ["Remove {item} from {model}", "Quitar {item} a {model}"],
  removeHint:     ["Weapons and armour sell for half their price (p.72), or the gathering can keep them in its equipment stash for another model.",
                   "Las armas y armaduras se venden por la mitad de su precio (p.72), o el Séquito puede guardarlas en su almacén para otra miniatura."],
  removeHintEquipment: ["Equipment can't be sold (p.72). Keep it in the equipment stash for another model, or discard it.",
                   "El equipo no se puede vender (p.72). Guárdalo en el almacén para otra miniatura, o descártalo."],
  sellFor:        ["Sell for {n} obols", "Vender por {n} óbolos"],
  keepInStash:    ["Keep in the stash", "Guardar en el almacén"],
  gearStash:      ["Equipment stash", "Almacén de equipo"],
  gearStashHint:  ["Not a rulebook rule: the app keeps equipment here between models. Moving it in or out is free; selling follows the Markets (p.72).",
                   "No es una regla del reglamento: la app guarda aquí el equipo entre miniaturas. Meterlo o sacarlo es gratis; venderlo sigue los Mercados (p.72)."],
  gearStashEmpty: ["Nothing kept. Taking equipment off a model offers to keep it here.", "Nada guardado. Al quitar equipo a una miniatura se ofrece guardarlo aquí."],
  chooseSpell:    ["Choose a spell…", "Elige un hechizo…"],
  rollMinorTreasure:   ["Roll a minor treasure", "Tirar un tesoro menor"],
  rollGreaterTreasure: ["Roll a greater treasure", "Tirar un tesoro mayor"],
  greaterOwedNote: ["Greater treasures owed from ambitions: {n}. Claim them rather than rolling here.",
                    "Tesoros mayores pendientes por ambiciones: {n}. Reclámalos en vez de tirar aquí."],
  claimIt:        ["Claim it", "Reclamarlo"],
  channelBonus:   ["+{n} channelling", "+{n} a canalizar"],
  noMatches:      ["No matches", "Sin resultados"],
  addLeader:      ["Add a leader…", "Añadir un líder…"],
  duplicate:      ["Duplicate", "Duplicar"],
  delete:         ["Delete", "Borrar"],
  confirmDelete:  ["Delete this gathering?", "¿Borrar este Séquito?"],
  name:           ["Name", "Nombre"],
  untitled:       ["Untitled gathering", "Séquito sin nombre"],
  copySuffix:     ["(copy)", "(copia)"],
  covenant:       ["Covenant", "Pacto"],
  chooseCovenant: ["Choose a covenant…", "Elige un pacto…"],
  lair:           ["Lair", "Guarida"],
  rollLair:       ["Roll on the lair table", "Tirar en la tabla de guaridas"],
  pickLair:       ["Pick from the table…", "Elegir de la tabla…"],
  obols:          ["obols", "óbolos"],
  of:             ["of", "de"],
  deployment:     ["deployment limit", "límite de despliegue"],
  model:          ["model", "miniatura"],
  models:         ["models", "miniaturas"],
  warning:        ["warning", "aviso"],
  warnings:       ["warnings", "avisos"],
  noWarnings:     ["No rule warnings", "Sin avisos"],
  viewRoster:     ["View roster", "Ver lista"],
  addCards:       ["Add cards to queue", "Añadir cartas a la cola"],
  copyLink:       ["Copy Companion App link", "Copiar enlace de la Companion App"],
  exportJson:     ["Export JSON", "Exportar JSON"],
  backup:         ["Download backup", "Descargar copia de seguridad"],
  linkCopied:     ["Companion App link copied.", "Enlace de la Companion App copiado."],
  cardsAdded:     ["cards added to the print queue.", "cartas añadidas a la cola de impresión."],
  addModel:       ["Add a model…", "Añadir una miniatura…"],
  leaders:        ["Leaders", "Líderes"],
  minions:        ["Minions", "Esbirros"],
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
  empty:          ["No gatherings yet. Start a new one, or bring one in from the Companion App with Import.",
                   "Aún no hay Séquitos. Crea uno nuevo o trae uno de la Companion App con Importar."],
  noModels:       ["Add a leader to start.", "Añade un líder para empezar."],
  blood:          ["Blood", "Sangre"],
  bone:           ["Bone", "Hueso"],
  plasm:          ["Plasm", "Plasma"],
  // Campaign view
  viewGathering:  ["Gathering", "Séquito"],
  viewCampaign:   ["Campaign", "Campaña"],
  viewRosterTab:  ["Roster", "Lista"],
  // Header and navigation
  mainNav:        ["Main", "Principal"],
  navGatherings:  ["Gatherings", "Séquitos"],
  navCards:       ["Cards", "Cartas"],
  cardsView:      ["Cards", "Cartas"],
  library:        ["Library", "Biblioteca"],
  printQueue:     ["Print queue", "Cola de impresión"],
  queueCount1:    ["card in the print queue", "carta en la cola de impresión"],
  queueCountN:    ["cards in the print queue", "cartas en la cola de impresión"],
  openQueue:      ["Open the print queue", "Abrir la cola de impresión"],
  settings:       ["Settings", "Ajustes"],
  language:       ["Language", "Idioma"],
  languageHint:   ["Language of the app and of the printed cards and roster", "Idioma de la app y de las cartas y la lista impresas"],
  theme:          ["Theme", "Tema"],
  printVerb:      ["Print", "Imprimir"],
  printRoster:    ["roster", "lista"],
  printCard1:     ["card", "carta"],
  printCardN:     ["cards", "cartas"],
  noGatheringToPrint: ["Nothing to print: no gathering is open.", "Nada que imprimir: no hay ningún Séquito abierto."],
  noModelsToPrint:    ["Nothing to print: this gathering has no models yet.", "Nada que imprimir: este Séquito aún no tiene miniaturas."],
  queueEmpty:     ["Nothing to print: the print queue is empty.", "Nada que imprimir: la cola de impresión está vacía."],
  allPrinted:     ["Nothing to print: every queued card is already printed.", "Nada que imprimir: ya están impresas todas las cartas de la cola."],
  import:         ["Import", "Importar"],
  close:          ["Close", "Cerrar"],
  // App chrome: page title, settings, Library, Import, print queue, footer.
  appTitle:       ["Necropolis Card Printer", "Necropolis: impresión de cartas"],
  themeObsidian:  ["Obsidian", "Obsidiana"],
  themeInkBone:   ["Ink & Bone", "Tinta y hueso"],
  themeSoftAsh:   ["Soft Ash", "Ceniza suave"],
  themeSlate:     ["Slate", "Pizarra"],
  themeVellum:    ["Vellum", "Vitela"],
  loadFailed:     ["Couldn't load the card data. Reload the page; if it keeps failing, try again later.",
                   "No se han podido cargar los datos de las cartas. Recarga la página; si sigue fallando, inténtalo más tarde."],
  loadFailedTech: ["Technical detail: {error}. Running the app from a copy of the project? Build data.json with python3 web/bundle.py.",
                   "Detalle técnico: {error}. ¿Usas la app desde una copia del proyecto? Genera data.json con python3 web/bundle.py."],
  footerCredit:   ['A fan-made print companion for <strong>Necropolis: A Diorama Skirmish Game</strong> by Peter Vigors — <a href="https://linktr.ee/owlshield" target="_blank" rel="noopener">linktr.ee/owlshield</a>. Card art and rules text are taken from the WIP v0.9 rulebook for personal reference only; please support the author.',
                   'Una herramienta hecha por fans para imprimir las cartas de <strong>Necropolis: A Diorama Skirmish Game</strong>, de Peter Vigors — <a href="https://linktr.ee/owlshield" target="_blank" rel="noopener">linktr.ee/owlshield</a>. Las ilustraciones y el texto de reglas de las cartas proceden del reglamento WIP v0.9, solo como referencia personal; apoya al autor.'],
  footerNotice:   ["Not affiliated with or endorsed by Owl Shield Games. No commercial use. Card layouts and rules may change as the rulebook is finalised.",
                   "Sin relación ni respaldo de Owl Shield Games. Sin uso comercial. El diseño de las cartas y las reglas pueden cambiar hasta la versión final del reglamento."],
  // Library
  libFilter:      ["Filter by name…", "Filtrar por nombre…"],
  libAllCats:     ["All categories", "Todas las categorías"],
  libCount:       ["{n} card|{n} cards", "{n} carta|{n} cartas"],
  libInQueue:     ["{n} in the queue", "{n} en la cola"],
  libAddAll:      ["Add all in view ({n})", "Añadir todas las visibles ({n})"],
  libQueued:      ["{n} queued", "{n} en la cola"],
  libAdd:         ["+ Add", "+ Añadir"],
  libPrintedTitle:["How many you've already printed", "Cuántas has impreso ya"],
  libPrintedLess: ["One fewer printed", "Una impresa menos"],
  libPrintedMore: ["One more printed", "Una impresa más"],
  libPrinted:     ["printed", "impresas"],
  libNeed:        ["need {n}", "falta {n}|faltan {n}"],
  libAllPrinted:  ["all printed", "ya impresa|ya impresas"],
  unnamed:        ["(unnamed)", "(sin nombre)"],
  invLabel:       ["Printed inventory:", "Inventario de impresas:"],
  invExportFile:  ["Export file", "Exportar archivo"],
  invCopy:        ["Copy JSON", "Copiar JSON"],
  invImportFile:  ["Import file", "Importar archivo"],
  invPaste:       ["Paste JSON…", "Pegar JSON…"],
  invPastePh:     ["Paste an exported inventory here, then choose Apply…", "Pega aquí un inventario exportado y pulsa Aplicar…"],
  invExported:    ["Exported {n} card.|Exported {n} cards.", "{n} carta exportada.|{n} cartas exportadas."],
  invImported:    ["Imported {n} card.|Imported {n} cards.", "{n} carta importada.|{n} cartas importadas."],
  invCopied:      ["Inventory JSON copied to the clipboard.", "JSON del inventario copiado al portapapeles."],
  invClipBlocked: ["The browser blocked the clipboard. The JSON is in the box below: copy it from there.",
                   "El navegador ha bloqueado el portapapeles. El JSON está en el cuadro de abajo: cópialo desde ahí."],
  invReadFailed:  ["That file couldn't be read. Choose an exported inventory file (.json) and try again.",
                   "No se ha podido leer el archivo. Elige un archivo de inventario exportado (.json) y vuelve a intentarlo."],
  invBadJson:     ["That isn't valid JSON, so nothing was imported. Paste the whole exported text and try again.",
                   "Eso no es un JSON válido, así que no se ha importado nada. Pega el texto exportado completo y vuelve a intentarlo."],
  invBadFormat:   ["That isn't a printed-inventory export, so nothing was imported. Make one with Export file or Copy JSON.",
                   "Eso no es un inventario de impresas exportado, así que no se ha importado nada. Créalo con Exportar archivo o Copiar JSON."],
  // Import
  importIntro:    ['Paste a JSON export or a share link from the <a href="https://necropolis28.vercel.app/" target="_blank" rel="noopener">Necropolis Companion App</a>, or a Builder backup. <strong>Load gathering</strong> opens it here; <strong>Load and add cards to queue</strong> also queues every card it matched.',
                   'Pega una exportación JSON o un enlace para compartir de la <a href="https://necropolis28.vercel.app/" target="_blank" rel="noopener">Necropolis Companion App</a>, o una copia de seguridad del constructor. <strong>Cargar Séquito</strong> lo abre aquí; <strong>Cargar y añadir cartas a la cola</strong> además añade a la cola cada carta reconocida.'],
  importInput:    ["Companion App JSON or share link", "JSON o enlace de la Companion App"],
  importPh:       ['{"covenant": "…", "gathering": [...]}  or  https://necropolis28.vercel.app/gathering-creation?id=…',
                   '{"covenant": "…", "gathering": [...]}  o  https://necropolis28.vercel.app/gathering-creation?id=…'],
  loadGathering:  ["Load gathering", "Cargar Séquito"],
  loadAndQueue:   ["Load and add cards to queue", "Cargar y añadir cartas a la cola"],
  loadSample:     ["Load sample", "Cargar ejemplo"],
  cardsAddedN:    ["{n} card added to the print queue.|{n} cards added to the print queue.",
                   "{n} carta añadida a la cola de impresión.|{n} cartas añadidas a la cola de impresión."],
  linkNoModels:   ["That link has no models. Copy the full share link from the Companion App and try again.",
                   "Ese enlace no tiene miniaturas. Copia el enlace completo de la Companion App y vuelve a intentarlo."],
  badJson:        ["That isn't valid JSON or a share link ({error}). Paste the whole export, from the first { to the last }.",
                   "Eso no es un JSON válido ni un enlace ({error}). Pega la exportación completa, desde la primera { hasta la última }."],
  unknownAppId:   ["Companion App ID {id} isn't in the card library, so it was skipped.",
                   "El ID {id} de la Companion App no está en la biblioteca de cartas, así que se ha omitido."],
  backupRestored: ['Restored the Builder backup "{name}".', "Copia de seguridad «{name}» restaurada."],
  noBuilderMatch: ["Couldn't match {name} ({where}), so it wasn't added. Add it by hand in the Builder.",
                   "No se ha reconocido {name} ({where}), así que no se ha añadido. Añádelo a mano en el constructor."],
  alreadySaved:   ['Already saved as "{name}"; opened it.', "Ya estaba guardado como «{name}»; se ha abierto."],
  savedGathering: ["Saved as a gathering ({n} model).|Saved as a gathering ({n} models).",
                   "Guardado como Séquito ({n} miniatura).|Guardado como Séquito ({n} miniaturas)."],
  badgeBuilder:   ["BUILDER", "CONSTRUCTOR"],
  badgeSummary:   ["SUMMARY", "RESUMEN"],
  "src-covenant": ["COVENANT", "PACTO"],
  "src-profile":  ["PROFILE", "PERFIL"],
  "src-special":  ["SPECIAL", "ESPECIAL"],
  "src-trait":    ["TRAIT", "RASGO"],
  "src-spell":    ["SPELL", "HECHIZO"],
  "src-weapon":   ["WEAPON", "ARMA"],
  "src-armour":   ["ARMOUR", "ARMADURA"],
  "src-equipment":["EQUIPMENT", "EQUIPO"],
  matchCounts:    ["{matched} matched · {close} close · {none} not found", "{matched} reconocidas · {close} aproximadas · {none} sin encontrar"],
  showMatches:    ["Show each card's match ({n})", "Ver con qué carta se reconoció cada una ({n})"],
  notInLibrary:   ["not in the card library", "no está en la biblioteca de cartas"],
  closeMatch:     ["close match", "aproximada"],
  empty_:         ["(empty)", "(vacío)"],
  // Print queue
  gapToggle:      ["Add gap between cards", "Añadir separación entre cartas"],
  backsToggle:    ["Print card backs", "Imprimir los reversos"],
  needToggle:     ["Only what I still need", "Solo lo que me falta"],
  needToggleTitle:["Skip cards you've already printed enough of (queued minus printed)",
                   "Omite las cartas de las que ya tienes suficientes impresas (en cola menos impresas)"],
  markPrinted:    ["Mark this run as printed", "Marcar estas cartas como impresas"],
  markPrintedTitle:["Add this run's cards to your printed inventory", "Añade las cartas de esta impresión a tu inventario de impresas"],
  clearQueue:     ["Clear queue", "Vaciar la cola"],
  confirmClear:   ["Clear {n} card from the queue?|Clear all {n} cards from the queue?",
                   "¿Quitar {n} carta de la cola?|¿Quitar las {n} cartas de la cola?"],
  queueIsEmpty:   ["The queue is empty. Add cards from the Library, or with Add cards to queue on a gathering.",
                   "La cola está vacía. Añade cartas desde la Biblioteca o con «Añadir cartas a la cola» en un Séquito."],
  clickRename:    ["Click to rename", "Haz clic para renombrar"],
  editFields:     ["Edit fields", "Editar campos"],
  bannerField:    ["banner", "cabecera"],
  // The queue's field editor: one label per card-template field.
  "field-affinity":     ["Keyword", "Palabra clave"],
  "field-ap":           ["AP", "PA"],
  "field-armaments":    ["Armaments", "Armamento"],
  "field-armour_tag":   ["Armour tag", "Etiqueta de armadura"],
  "field-attacks":      ["Attacks", "Ataques"],
  "field-base":         ["Base", "Base"],
  "field-category":     ["Category", "Categoría"],
  "field-channel":      ["Channel", "Canalización"],
  "field-condition":    ["Condition", "Condición"],
  "field-cost":         ["Cost", "Coste"],
  "field-damage":       ["Damage", "Daño"],
  "field-deployment":   ["Deployment", "Despliegue"],
  "field-effect":       ["Effect", "Efecto"],
  "field-flavor":       ["Flavour text", "Texto de ambientación"],
  "field-header":       ["Header", "Cabecera"],
  "field-hp":           ["HP", "HP"],
  "field-keyword":      ["Keyword", "Palabra clave"],
  "field-m":            ["Move", "Mov"],
  "field-mana":         ["Mana", "Maná"],
  "field-name":         ["Name", "Nombre"],
  "field-objectives":   ["Objectives", "Objetivos"],
  "field-range":        ["Range", "Alcance"],
  "field-restrictions": ["Restrictions", "Restricciones"],
  "field-reward":       ["Reward", "Recompensa"],
  "field-rngd":         ["Ranged", "A Dist."],
  "field-school":       ["School", "Escuela"],
  "field-special":      ["Special", "Especial"],
  "field-special_rules":["Special rules", "Reglas especiales"],
  "field-type_keyword": ["Type and keywords", "Tipo y palabras clave"],
  "field-victory":      ["Victory", "Victoria"],
  "field-viol":         ["Violence", "Violencia"],
  bannerDefault:  ["(uses the default banner)", "(usa la cabecera por defecto)"],
  sheetsN:        ["{n} sheet|{n} sheets", "{n} hoja|{n} hojas"],
  cardsN:         ["{n} card|{n} cards", "{n} carta|{n} cartas"],
  stillNeededOf:  ["still needed (of {q} queued)", "pendiente (de {q} en la cola)|pendientes (de {q} en la cola)"],
  frontsBacks:    ["(fronts + backs)", "(anversos y reversos)"],
  previewEmpty:   ["The print preview appears here once you queue cards.", "La vista previa aparecerá aquí cuando añadas cartas a la cola."],
  nothingLeft:    ["Nothing left to print: every queued card is already in your printed inventory.",
                   "No queda nada por imprimir: todas las cartas de la cola ya están en tu inventario de impresas."],
  // Library categories, by key and by group title (data/_categories.yaml).
  "cat-covenants":               ["Covenants", "Pactos"],
  "cat-covenant-leader-traits":  ["Covenant Leader Traits", "Rasgos de líder de pacto"],
  "cat-covenant-wretched-traits":["Covenant Wretched Traits", "Rasgos de pacto"],
  "cat-leaders":                 ["Leaders", "Líderes"],
  "cat-basic-leader-traits":     ["Basic Leader Traits", "Rasgos básicos de líder"],
  "cat-wretched-undead-traits":  ["Wretched Undead Traits", "Rasgos de No Muertos Miserables"],
  "cat-spells":                  ["Spells", "Hechizos"],
  "cat-minions":                 ["Minions", "Esbirros"],
  "cat-melee-weapons":           ["Melee Weapons", "Armas cuerpo a cuerpo"],
  "cat-colossal-weapons":        ["Colossal Weapons", "Armas colosales"],
  "cat-ranged-weapons":          ["Ranged Weapons", "Armas a distancia"],
  "cat-armours":                 ["Armours", "Armaduras"],
  "cat-thrown-weapons":          ["Thrown Weapons", "Armas arrojadizas"],
  "cat-miscellaneous-equipment": ["Miscellaneous Equipment", "Equipo misceláneo"],
  "cat-sellswords":              ["Sellswords", "Mercenarios"],
  "cat-minor-treasures":         ["Minor Treasures", "Tesoros menores"],
  "cat-greater-treasures":       ["Greater Treasures", "Tesoros mayores"],
  "cat-throwing-pots":           ["Throwing Pots", "Frascos arrojadizos"],
  "cat-potions":                 ["Potions", "Pociones"],
  "cat-lair-upgrades":           ["Lair Upgrades", "Mejoras de la Guarida"],
  "cat-ambitions":               ["Minor Ambitions", "Ambiciones menores"],
  "cat-special-rules":           ["Special Rules", "Reglas especiales"],
  "cat-environments":            ["Environments", "Entornos"],
  "cat-missions":                ["Missions", "Misiones"],
  "cat-dread-omens":             ["Dread Omens", "Augurios siniestros"],
  "cat-scenario-tables":         ["Scenario Tables", "Tablas de escenario"],
  "group-Reference Guide":       ["Reference Guide", "Guía de referencia"],
  "group-Sellswords":            ["Sellswords", "Mercenarios"],
  "group-Campaign Items":        ["Campaign Items", "Objetos de campaña"],
  "group-Campaign":              ["Campaign", "Campaña"],
  "group-Reference":             ["Reference", "Referencia"],
  "group-Scenarios":             ["Scenarios", "Escenarios"],
  notStarted:     ["The campaign hasn't started. Starting it turns the obols left from the 300 into your treasury:",
                   "La campaña no ha empezado. Al empezarla, los óbolos que sobran de los 300 pasan a tu tesoro:"],
  startCampaign:  ["Start campaign", "Empezar campaña"],
  alreadyBuilt:   ["Already built? Start its campaign", "¿Ya está creado? Empieza su campaña"],
  treasury:       ["Treasury", "Tesoro"],
  deployBase:     ["Base deployment limit", "Límite de despliegue base"],
  lairBonus:      ["from the lair", "por la Guarida"],
  fielded:        ["fielded", "desplegados"],
  nextBattle:     ["Next battle", "Próxima batalla"],
  oppHigher:      ["The opponent's deployment limit is 100 or more higher", "El límite de despliegue del rival supera al tuyo en 100 o más"],
  sinceLastBattle:["Since the last battle", "Desde la última batalla"],
  campaignShop:   ["Campaign started: equipment and minions added here are bought at Bazaar prices, and weapons or armour removed are sold for half (p.72).",
                   "Campaña empezada: el equipo y los esbirros que añadas aquí se compran a precio del Bazar, y las armas o armaduras que quites se venden por la mitad (p.72)."],
  "tx-buy":       ["Bought", "Comprado"],
  "tx-sell":      ["Sold", "Vendido"],
  "tx-recruit":   ["Recruited", "Reclutado"],
  "tx-hire":      ["Hired", "Contratado"],
  "tx-hire-free": ["Hired (free)", "Contratado (gratis)"],
  "tx-upgrade":   ["Lair upgrade", "Mejora de la Guarida"],
  "tx-upgrade-undo": ["Lair upgrade refunded", "Mejora de la Guarida reembolsada"],
  "tx-soul-binder": ["Malady removed (Soul Binder)", "Dolencia eliminada (Remienda Almas)"],
  "tx-tomb-robber": ["Tomb Robber used", "Saqueador de Tumbas usado"],
  "tx-alchemy":   ["Alchemy Workshop used", "Taller de Alquimia usado"],
  "tx-discard":   ["Discarded", "Descartado"],
  "tx-stash":     ["Stashed", "Guardado"],
  "tx-take":      ["Taken from the stash", "Sacado del almacén"],
  freeSellsword:  ["You may deploy a sellsword from your roster for no cost (p.74).",
                   "Puedes desplegar un mercenario de tu lista sin coste (p.74)."],
  freeRabble:     ["Add the Desperate Rabble for free (first game against such an opponent)",
                   "Añadir la Chusma Desesperada gratis (primera partida contra un rival así)"],
  field:          ["Field", "Desplegar"],
  hire:           ["Hire a sellsword…", "Contratar un mercenario…"],
  sellsword:      ["Sellsword", "Mercenario"],
  rosterCost:     ["roster", "lista"],
  deployCost:     ["deploy", "despliegue"],
  armaments:      ["Armaments", "Armamento"],
  lairUpgrades:   ["Lair upgrades", "Mejoras de la Guarida"],
  buy:            ["Buy", "Comprar"],
  owned:          ["Owned", "Comprada"],
  ambitions:      ["Ambitions", "Ambiciones"],
  active:         ["active", "activas"],
  addAmbition:    ["Add an ambition…", "Añadir una ambición…"],
  complete:       ["Complete", "Cumplir"],
  chooseModel_:   ["Choose a model…", "Elige una miniatura…"],
  completed:      ["completed", "cumplidas"],
  greaterOwed:    ["greater treasure earned (1 per 5 ambitions)", "tesoro mayor ganado (1 por cada 5 ambiciones)"],
  treasureToTake: ["Treasure to take", "Tesoro por recibir"],
  rollMinor:      ["Roll a minor treasure", "Tirar un tesoro menor"],
  rollGreater:    ["Roll 2d10, keep one", "Tirar 2D10 y quedarse con uno"],
  pickTreasure:   ["…or pick one", "…o elige uno"],
  giveTo:         ["Give to", "Dar a"],
  stash:          ["Unassigned", "Sin asignar"],
  treasures:      ["Treasures", "Tesoros"],
  minorT:         ["minor", "menor"],
  greaterT:       ["greater", "mayor"],
  moveTo:         ["Move to…", "Mover a…"],
  addTreasure:    ["Add a treasure…", "Añadir un tesoro…"],
  improvements:   ["Model improvements", "Mejoras de las miniaturas"],
  improvementsHint: ["Every number with the changes behind it. Ambition changes are undone in the history below; malady changes with the Soul Binder. Campaign limits: AP +1, Move/Violence/Ranged +2, HP +5.",
                   "Cada valor con los cambios que lo forman. Las ambiciones se deshacen en el historial de abajo; las dolencias, con el Remienda Almas. Límites de campaña: PA +1, Mov/Violencia/A Dist. +2, HP +5."],
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
  discardSequence:["Discard sequence", "Descartar secuencia"],
  confirmDiscard: ["Discard this after-battle sequence? What it already applied stays.",
                   "¿Descartar esta secuencia? Lo que ya se aplicó se mantiene."],
  finish:         ["Finish and log the battle", "Terminar y registrar la batalla"],
  notShattered:   ["The leader wasn't Shattered: nothing to roll.", "El líder no fue Hecho añicos: no hay que tirar."],
  fullHp:         ["All models are restored to full HP.", "Todas las miniaturas recuperan todos sus HP."],
  roll:           ["Roll", "Tirar"],
  orType:         ["or type the die", "o escribe el dado"],
  die:            ["Die", "Dado"],
  cancel:         ["Cancel", "Cancelar"],
  logNew:         ["Log a battle", "Registrar una batalla"],
  apply:          ["Apply", "Aplicar"],
  applied:        ["Applied", "Aplicado"],
  opponentPicks:  ["your opponent picks", "tu rival elige"],
  youPick:        ["you pick", "eliges tú"],
  noMinorOnLeader:["Your leader carries no minor treasure.", "Tu líder no lleva ningún tesoro menor."],
  obolsAdded:     ["obols added", "óbolos añadidos"],
  treasureRolls:  ["minor treasure rolls left", "tiradas de tesoro menor pendientes"],
  rollsLost:      ["take them in step 2 before finishing, or they are lost.", "tómalas en el paso 2 antes de terminar o se perderán."],
  rollTreasure:   ["Roll a minor treasure", "Tirar un tesoro menor"],
  lairIncome:     ["Lair income", "Ingresos de la Guarida"],
  purloiner:      ["Purloiner", "Hurtador"],
  ifUnderMove:    ["if the first die is equal to or lower than its Move", "si el primer dado es igual o menor que su Movimiento"],
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
  afterBattleLead:["When a game ends, run the rulebook's seven after-battle steps here.", "Cuando acabe una partida, sigue aquí los siete pasos tras la batalla del reglamento."],
  treasuryAndBattle: ["Treasury and next battle", "Tesoro y próxima batalla"],
  ownedCount:     ["owned", "compradas"],
  changesCount:   ["changes", "cambios"],
  changesCount1:  ["change", "cambio"],
  battleCount:    ["battles", "batallas"],
  battleCount1:   ["battle", "batalla"],
  ofFourActive:   ["of 4 active", "de 4 activas"],
  noTreasures:    ["No treasures yet. Victory rewards and completed ambitions bring them; you can also add or roll one here.",
                   "Aún no hay tesoros. Llegan con las recompensas por la victoria y las ambiciones cumplidas; también puedes añadir o tirar uno aquí."],
  refundUpgrade:  ["Refund", "Reembolsar"],
  undo:           ["Undo", "Deshacer"],
  noChangesYet:   ["No campaign changes yet:", "Aún sin cambios de campaña:"],
  stat:           ["Stat", "Atributo"],
  amount:         ["Amount", "Cantidad"],
  // Improvements ledger and history
  manualEntry:    ["Manual change", "Cambio manual"],
  base:           ["Base", "Base"],
  changes:        ["Changes", "Cambios"],
  total:          ["Total", "Total"],
  reason:         ["Reason", "Motivo"],
  addChange:      ["Add change", "Añadir cambio"],
  history:        ["History", "Historial"],
  completedAmbitions: ["Completed ambitions", "Ambiciones cumplidas"],
  allModels:      ["every model", "todas las miniaturas"],
  bonusTrait:     ["+1 trait", "+1 rasgo"],
  makeActive:     ["Make active", "Activar"],
  inactiveProgress: ["Progress on inactive ambitions", "Progreso de ambiciones inactivas"],
  ap:             ["AP", "PA"],
  move:           ["Move", "Mov"],
  violence:       ["Violence", "Violencia"],
  ranged:         ["Ranged", "A Dist."],
  hp:             ["HP", "HP"],
  // Errors campaign.js throws (`err.code`), for the UI to show.
  invalidDie:     ["Enter each die as a whole number from 1 to 10.", "Introduce cada dado como un número entero del 1 al 10."],
  // Checks before an action, and why one didn't happen
  diceInvalid:    ["Enter each die as a whole number from 1 to 10.", "Escribe cada dado como un número entero del 1 al 10."],
  chooseStatFirst:["Choose Move, Violence or Ranged first.", "Elige primero Movimiento, Violencia o A Distancia."],
  chooseRewardFirst: ["Choose who gets the reward first.", "Elige primero quién recibe la recompensa."],
  actionFailed:   ["That didn't work:", "No se pudo hacer:"],
  // After-battle steps on a phone
  stepOf:         ["Step {n} of {total}: {name}", "Paso {n} de {total}: {name}"],
  afterBattleSteps: ["After-battle steps", "Pasos tras la batalla"],
  prevStep:       ["Previous step", "Paso anterior"],
  nextStep:       ["Next step", "Paso siguiente"],
  // Names for fields that show no label
  itemToBuy:      ["Item to buy", "Objeto a comprar"],
  buyFor:         ["Buy for", "Comprar para"],
  minionToRecruit:["Minion to recruit", "Esbirro a reclutar"],
  treasureFor:    ["Give {item} to", "Dar {item} a"],
  // Import
  backupReplacedDraft: ["Its unsaved changes on this device were replaced by the backup.",
                        "Sus cambios sin guardar en este dispositivo se han sustituido por la copia."],
  notAGathering:  ["That JSON isn't a gathering: expected an object with a covenant and models.",
                   "Ese JSON no es un Séquito: se esperaba un objeto con un Pacto y miniaturas."],
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
    case "unknown-item":        return es ? `${item} no está en la biblioteca de cartas. Revisa el nombre o quítalo.` : `${item} isn't in the card library. Check the spelling or remove it.`;
    case "no-covenant":         return es ? "Elige un pacto." : "Choose a covenant.";
    case "no-leader":           return es ? "El Séquito necesita un líder." : "The gathering needs a leader.";
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
    case "too-much-equipment":  return es ? `Solo ${p.max} ${p.max === 1 ? "pieza" : "piezas"} de equipo misceláneo.` : `Only ${p.max} ${p.max === 1 ? "piece" : "pieces"} of miscellaneous equipment.`;
    case "too-many-traits":     return es ? `${p.count} rasgos; el máximo es ${p.max}.` : `${p.count} traits; the most is ${p.max}.`;
    case "basic-trait-count":   return es ? "El líder elige exactamente 1 rasgo básico de líder." : "The leader takes exactly 1 basic leader trait.";
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
    case "unique-model":        return es ? `Solo puede haber 1 ${item} por Séquito.` : `Only 1 ${item} per gathering.`;
    case "unique-trait":        return es ? `Solo una miniatura puede tener ${item}.` : `Only one model may take ${item}.`;
    case "covenant-traits":     return es ? `${p.count} rasgos de pacto o de No Muertos Miserables; se permiten ${p.allowed}.`
                                          : `${p.count} covenant or Wretched Undead traits; ${p.allowed} allowed.`;
    case "over-budget":         return es ? `${p.total} óbolos gastados de los ${p.budget} de la primera creación. Si el Séquito ya está creado, empieza su campaña.`
                                          : `${p.total} obols spent of the ${p.budget} for the first build. If the gathering is already built, start its campaign.`;
    case "over-deployment":     return es ? `${p.total} óbolos desplegados; el límite es ${p.limit}.` : `${p.total} obols fielded; the deployment limit is ${p.limit}.`;
    case "too-many-treasures":  return es ? `${p.count} tesoros ${p.kind === "greater" ? "mayores" : "menores"}; puede llevar ${p.max}.`
                                          : `${p.count} ${p.kind} treasures; it can carry ${p.max}.`;
    case "duplicate-greater":   return es ? "Los tesoros mayores que lleve un líder deben ser distintos." : "A leader's greater treasures must be different.";
    case "deployment-cap":      return es ? `Límite de despliegue ${p.limit}; el máximo es ${p.max}.` : `Deployment limit ${p.limit}; the most it can reach is ${p.max}.`;
    case "too-many-sellswords": return es ? `${p.count} mercenarios desplegados; solo se permite 1 por escenario.` : `${p.count} sellswords fielded; only 1 per scenario.`;
    case "treasury-negative":   return es ? `El tesoro está en ${p.treasury} óbolos. Vende algo o deshaz una compra para volver a 0 o más.`
                                          : `The treasury is at ${p.treasury} obols. Sell something or undo a purchase to get back to 0 or more.`;
    case "duplicate-upgrade":   return es ? `${item} solo puede comprarse una vez.` : `${item} can only be bought once.`;
    case "channel-spell-missing": return es ? `El líder ya no conoce ${item}, el hechizo con +1 a canalizar.`
                                          : `The leader no longer knows ${item}, the spell with +1 to channel.`;
    case "too-many-ambitions":  return es ? `${p.count} ambiciones activas; el máximo es 4.` : `${p.count} active ambitions; the most is 4.`;
    case "too-many-weapons":    return es ? `${p.count} armas; puede llevar ${p.max}.` : `${p.count} weapons; it can have ${p.max}.`;
    case "apprentice-spell":    return es ? `${item}: un Aprendiz solo conoce un hechizo que también conozca el líder.`
                                          : `${item}: an Apprentice only knows a spell the leader also knows.`;
    case "foreign-covenant-trait": return es ? `${item} no pertenece al Pacto de este Séquito.` : `${item} isn't this gathering's covenant trait.`;
    default:
      // A code with no sentence yet: say something useful, keep the code for debugging.
      console.warn(`No message for warning "${w.code}"`);
      return es ? "Algo de esta miniatura no cumple las reglas." : "Something about this model breaks the rules.";
  }
}
