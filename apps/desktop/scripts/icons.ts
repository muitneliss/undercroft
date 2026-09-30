/**
 * Render every icon the desktop app ships from the two SVGs it has, so no PNG in the tree is a
 * hand-drawn copy that drifts from the mark.
 *
 * - `assets/icon.svg` (the mark on the bone ground) becomes the macOS `icon.iconset` that Hutch
 *   compiles into the app's `.icns`, and `assets/icon.png`, which Hutch turns into the Windows
 *   `.ico` and uses as the Linux icon (`electrobun.config.ts`).
 * - `apps/ui/public/mark.svg` (the mark alone, one ink) becomes the macOS menu-bar icon: a
 *   template image, which macOS recolours for a light or dark menu bar from its alpha alone.
 *   Windows and Linux have no template images, so their tray shows the app icon instead.
 *
 * It uses `sips`, which ships with macOS and rasterises SVG, so it runs on a Mac. The PNGs it
 * writes are committed: a build on any runner then needs neither `sips` nor a rasteriser.
 *
 * Runnable as `task build:desktop-icons`.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const APP = join(import.meta.dir, "..");
const ICON = join(APP, "assets", "icon.svg");
const MARK = join(APP, "..", "ui", "public", "mark.svg");
const ICONSET = join(APP, "icon.iconset");
const VIEW_ASSETS = join(APP, "src", "view", "assets");

/** `icon_<n>x<n>[@2x].png`, the names `iconutil` requires, for every size macOS asks for. */
const ICONSET_SIZES = [16, 32, 128, 256, 512] as const;
/** A menu-bar icon is 18 points tall; the @2x file is what a Retina display draws. */
const TRAY_POINTS = 18;
const TRAY_PIXELS = 32;
const LARGE = 1024;

function render(source: string, size: number, target: string): void {
  const done = Bun.spawnSync(
    ["sips", "-s", "format", "png", "-z", String(size), String(size), source, "--out", target],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (done.exitCode !== 0) {
    throw new Error(`sips could not render ${source} at ${size}px:\n${done.stderr.toString()}`);
  }
}

if (process.platform !== "darwin") {
  throw new Error("task build:desktop-icons renders with sips, which only macOS has");
}

mkdirSync(ICONSET, { recursive: true });
mkdirSync(VIEW_ASSETS, { recursive: true });
for (const size of ICONSET_SIZES) {
  render(ICON, size, join(ICONSET, `icon_${size}x${size}.png`));
  render(ICON, size * 2, join(ICONSET, `icon_${size}x${size}@2x.png`));
}
render(ICON, LARGE, join(APP, "assets", "icon.png"));
render(MARK, TRAY_POINTS, join(VIEW_ASSETS, "tray-Template.png"));
render(MARK, TRAY_POINTS * 2, join(VIEW_ASSETS, "tray-Template@2x.png"));
render(ICON, TRAY_PIXELS, join(VIEW_ASSETS, "tray.png"));
process.stdout.write(`icons written under ${APP}\n`);
