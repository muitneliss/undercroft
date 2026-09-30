/**
 * Checksum the desktop app's release artifacts and attach them to a GitHub release (ADR 0098).
 *
 *   release.ts <dir>               write <dir>/undercroft-desktop-SHA256SUMS
 *   release.ts <dir> --upload TAG  ...and attach it and the artifacts to release TAG
 *
 * Each platform is built on its own runner; the release job gathers their `artifacts/` folders
 * into one `<dir>` and runs this once, so there is one checksum file for the whole app, in the
 * `sha256sum --check` form `undercroft-installer-SHA256SUMS` already uses.
 *
 * Only files Electrobun names are published -- `<os>-<arch>-...` installers and
 * `stable-<os>-<arch>-...` update files -- listed by that pattern rather than globbed, so a stray
 * file in `<dir>` is never attached. They keep Electrobun's names: the updater builds its URLs
 * from them (`release.baseUrl` in `electrobun.config.ts`), and every release shares them, so
 * `releases/latest/download/<name>` always resolves to the newest.
 *
 * Nothing here is signed; the checksums are how a download is verified (`docs/runbook/install.md`).
 *
 * Runnable as `task cd:desktop-release DIR=... TAG=...`; uploading needs `GH_TOKEN`.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

export const DESKTOP_CHECKSUMS = "undercroft-desktop-SHA256SUMS";

/** Electrobun's release names: an installer, or a `stable-` update file, for one platform. */
const ELECTROBUN_NAME = /^(?:stable-)?(?:macos|win|linux)-(?:arm64|x64)-/u;

/** Add the artifacts under `at` (any depth) to `found`, by file name; a repeated name throws. */
function collect(at: string, found: Map<string, string>): Map<string, string> {
  for (const name of readdirSync(at)) {
    const path = join(at, name);
    if (statSync(path).isDirectory()) {
      collect(path, found);
    } else if (ELECTROBUN_NAME.test(name)) {
      if (found.has(name)) {
        throw new Error(`two artifacts are named ${name}`);
      }
      found.set(name, path);
    }
  }
  return found;
}

const [dir, flag, tag] = process.argv.slice(2);
if (dir === undefined) {
  throw new Error("usage: release.ts <dir> [--upload TAG]");
}
const files = collect(dir, new Map());
if (files.size === 0) {
  throw new Error(`no Electrobun artifacts under ${dir}`);
}
const sums = [...files]
  .toSorted(([a], [b]) => a.localeCompare(b))
  .map(
    ([name, path]) => `${createHash("sha256").update(readFileSync(path)).digest("hex")}  ${name}\n`,
  )
  .join("");
const sumsPath = join(dir, DESKTOP_CHECKSUMS);
writeFileSync(sumsPath, sums);
process.stdout.write(sums);

if (flag === "--upload") {
  if (tag === undefined) {
    throw new Error("--upload needs the release tag");
  }
  const upload = Bun.spawnSync(
    ["gh", "release", "upload", tag, "--clobber", ...files.values(), sumsPath],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (upload.exitCode !== 0) {
    throw new Error(`gh release upload exited with ${upload.exitCode}`);
  }
}
