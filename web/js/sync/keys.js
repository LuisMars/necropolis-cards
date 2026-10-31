/**
 * Every localStorage key the app owns, and whether device sync carries it.
 *
 * tests/sync-keys.test.js scans the sources for "necropolis-...-v<N>" key
 * literals and fails when one is missing here, so a new key has to be
 * classified: synced (name the sync item) or excluded (say why).
 */
export const KEYS = {
  "necropolis-builder-gatherings-v1":   { sync: "gatherings", note: "one doc per gathering; order and current stay per device" },
  "necropolis-builder-drafts-v1":       { sync: "gatherings", note: "the draft rides in its gathering's doc" },
  "necropolis-card-printer-printed-v1": { sync: "printed" },
  "necropolis-card-printer-queue-v1":   { sync: "queue" },
  "necropolis-card-printer-warband-v1": { sync: "warband" },
  "necropolis-card-printer-lang-v1":    { sync: "prefs" },
  "necropolis-ui-palette-v56":          { sync: "prefs" },
  "necropolis-ui-roster-skip-v1":       { sync: "prefs" },
  "necropolis-ui-route-v1":             { sync: false, note: "which tab this device last showed" },
  "necropolis-sync-v1":                 { sync: false, note: "sync's own bookkeeping (user name, revisions)" },
  "necropolis-sync-backups-v1":         { sync: false, note: "local copies of data a sync replaced" },
};

export const LS = {
  gatherings: "necropolis-builder-gatherings-v1",
  drafts: "necropolis-builder-drafts-v1",
  printed: "necropolis-card-printer-printed-v1",
  queue: "necropolis-card-printer-queue-v1",
  warband: "necropolis-card-printer-warband-v1",
  lang: "necropolis-card-printer-lang-v1",
  palette: "necropolis-ui-palette-v56",
  rosterSkip: "necropolis-ui-roster-skip-v1",
  meta: "necropolis-sync-v1",
  backups: "necropolis-sync-backups-v1",
};
