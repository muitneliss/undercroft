/**
 * How Electrobun's toolchain (Hutch) builds the desktop app (ADR 0098).
 *
 * - **The main process is Bun, not Cottontail** (Electrobun 2's default). It imports
 *   `@undercroft/setup` as it is -- `node:child_process`, `node:crypto`, the compose file embedded
 *   with `import ... with { type: "text" }` -- the same code the terminal installer compiles, on
 *   the runtime that code is tested on.
 * - **The fonts are the control plane's files**, copied from `apps/ui/public/fonts`, so the
 *   wizard sets type in the same faces without a second copy in the tree.
 * - **Updates come from the GitHub release.** `release.baseUrl` is `releases/latest/download`,
 *   which serves the newest release's assets by name; the updater reads
 *   `stable-<os>-<arch>-update.json` there. Patches are off: with only the latest release
 *   reachable at that URL a patch could only ever bridge one release, and the full archive is
 *   what every other client downloads anyway.
 * - **Nothing is signed.** The artifacts are built from public source in public CI and published
 *   with their SHA-256 checksums; ADR 0098 records why, and what a person sees because of it.
 */

import type { ElectrobunConfig } from "electrobun";
import pkg from "./package.json" with { type: "json" };

const FONTS = [
  "archivo-latin.woff2",
  "archivo-vietnamese.woff2",
  "garamond-latin.woff2",
  "garamond-vietnamese.woff2",
  "mono-latin.woff2",
];

export default {
  app: {
    name: "Undercroft",
    identifier: "link.lowbit.undercroft",
    version: pkg.version,
    description: "Installs and runs Undercroft on this machine with Docker.",
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/main.ts" },
    views: { wizard: { entrypoint: "src/view/main.tsx" } },
    copy: {
      "src/view/index.html": "views/wizard/index.html",
      "src/view/index.css": "views/wizard/index.css",
      "src/view/assets/tray-Template.png": "views/assets/tray-Template.png",
      "src/view/assets/tray-Template@2x.png": "views/assets/tray-Template@2x.png",
      "src/view/assets/tray.png": "views/assets/tray.png",
      ...Object.fromEntries(
        FONTS.map((font) => [`../ui/public/fonts/${font}`, `views/wizard/fonts/${font}`]),
      ),
    },
    mac: { icons: "icon.iconset" },
    win: { icon: "assets/icon-windows.png" },
    linux: { icon: "assets/icon.png" },
  },
  runtime: {
    // The tray keeps an install operable with the wizard's window closed.
    exitOnLastWindowClosed: false,
  },
  release: {
    baseUrl: "https://github.com/muitneliss/undercroft/releases/latest/download",
    generatePatch: false,
  },
} satisfies ElectrobunConfig;
