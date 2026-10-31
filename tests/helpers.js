/**
 * Shared test setup: the built data bundle and the Companion App fixtures.
 * Run `python3 web/bundle.py` first; the tests read the web/data.json it
 * writes, so they check the same data the site ships.
 */

import { readFileSync, existsSync } from "node:fs";
import { buildCatalog } from "../web/js/builder/catalog.js";

const here = (p) => new URL(p, import.meta.url);

if (!existsSync(here("../web/data.json"))) {
  throw new Error("web/data.json is missing: run `python3 web/bundle.py` before the tests");
}

export const bundle = JSON.parse(readFileSync(here("../web/data.json"), "utf8"));
export const catalog = buildCatalog(bundle);

/** A gathering shared from the Companion App (Cairn-born, 6 models). */
export const EXAMPLE_LINK =
  "c1;pl0,a1,tc2,tb6,sn0,sn3,sn1,sb3,sb1;pm4,a1,ewm8;pm3,a1,ewm1;pm1,a1,ewm4,ea0;pm1,a1,ewm4,ea0;pm5,a1,twu0,ewm8";

/** The same gathering as the app's JSON export (2026-10-28). */
export const EXAMPLE_EXPORT = JSON.parse(readFileSync(here("./fixtures/companion-export.json"), "utf8"));

/** Every share-link ID the app's data tables define (read 2026-10-28). */
export const APP_IDS = [
  "c0", "c1", "c2", "c3", "c4", "c5",
  "pl0", "pl1", "pl2",
  ...Array.from({ length: 10 }, (_, i) => `pm${i}`),
  ...Array.from({ length: 10 }, (_, i) => `ewm${i}`),
  "ewr0", "ewr1", "ewr2",
  ...Array.from({ length: 5 }, (_, i) => `ewcm${i}`), "ewcr0",
  "ewt0", "ewt1", "ei0", "ei1", "ei2",
  "ea0", "ea1", "ea2", "ea3",
  ...Array.from({ length: 10 }, (_, i) => `tb${i}`),
  ...Array.from({ length: 10 }, (_, i) => `tc${i}`),
  ...Array.from({ length: 13 }, (_, i) => `twu${i}`),
  ...Array.from({ length: 6 }, (_, i) => `sn${i}`),
  ...Array.from({ length: 4 }, (_, i) => `sbl${i}`),
  ...Array.from({ length: 4 }, (_, i) => `sb${i}`),
  ...Array.from({ length: 5 }, (_, i) => `sp${i}`),
];
