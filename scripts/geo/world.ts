/**
 * The world map the Reports division draws: Natural Earth's countries at 1:110m, as the
 * `world-atlas` package ships them, copied into the SPA's static assets.
 *
 * Copied rather than imported at run time, so the boundary a chart draws is a file in
 * this repository that a reviewer can diff, and so the browser fetches it from this
 * origin and nowhere else. `world-atlas` is pinned in the root manifest; regenerating is
 * `bun run geo:build`. The provenance is in `apps/ui/public/geo/README.md`.
 */

// biome-ignore-all lint/correctness/noNodejsModules: This is a build script running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.

import { copyFileSync, mkdirSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(import.meta.resolve("world-atlas/countries-110m.json"));
const TARGET_DIR = new URL("../../apps/ui/public/geo/", import.meta.url);
const TARGET = new URL("world-110m.json", TARGET_DIR);

mkdirSync(TARGET_DIR, { recursive: true });
copyFileSync(SOURCE, TARGET);
process.stdout.write(`wrote ${fileURLToPath(TARGET)}\n`);
