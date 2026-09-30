/**
 * Build the setup wizard as one executable per platform, and the checksums a download is
 * verified against (ADR 0095).
 *
 * `bun build --compile` bundles the wizard, `@undercroft/setup` and the compose file it embeds
 * into a copy of the Bun runtime for each target, so a person runs it with nothing installed
 * but Docker. Each release attaches these files under names every release shares --
 * `undercroft-installer-linux-x64` and so on -- which is what lets
 * `releases/latest/download/<name>` resolve, the channel ADR 0046 chose for the CLI.
 * `undercroft-installer-SHA256SUMS` is in `sha256sum --check` form, and `install.sh` checks the
 * binary it downloaded against it before running anything.
 *
 * Cross-compiling fetches each target's Bun runtime from npm the first time, so the full build
 * needs the network. `--host` builds this machine's target alone, which needs none; the
 * installer check (`scripts/check.ts`) uses it.
 *
 * Runnable as `task build:installer-cli`; it writes into `apps/installer-cli/dist/`.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import process from "node:process";

export interface Target {
  /** Bun's name for the platform, as `--target` takes it. */
  readonly bun: string;
  /** The release asset's name. Shared by every release, so `latest/download` resolves it. */
  readonly asset: string;
}

export const TARGETS: readonly Target[] = [
  { bun: "bun-linux-x64", asset: "undercroft-installer-linux-x64" },
  { bun: "bun-linux-arm64", asset: "undercroft-installer-linux-arm64" },
  { bun: "bun-darwin-arm64", asset: "undercroft-installer-darwin-arm64" },
  { bun: "bun-darwin-x64", asset: "undercroft-installer-darwin-x64" },
  { bun: "bun-windows-x64", asset: "undercroft-installer-windows-x64.exe" },
];

export const CHECKSUMS = "undercroft-installer-SHA256SUMS";

const ENTRY = join(import.meta.dir, "..", "src", "main.ts");

/** This machine's target. */
export function hostTarget(): Target {
  const os = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const found = TARGETS.find((target) => target.bun === `bun-${os}-${arch}`);
  if (found === undefined) {
    throw new Error(`no installer target for ${process.platform}-${process.arch}`);
  }
  return found;
}

/** Compile one target into `outdir` and answer with the executable's path. */
export function compile(target: Target, outdir: string): string {
  const outfile = join(outdir, target.asset);
  const built = Bun.spawnSync(
    [
      process.execPath,
      "build",
      ENTRY,
      "--compile",
      "--minify",
      `--target=${target.bun}`,
      `--outfile=${outfile}`,
      // What ships is production, whatever the building shell says -- as `apps/cli` pins it.
      "--define",
      `process.env.NODE_ENV=${JSON.stringify("production")}`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (built.exitCode !== 0) {
    throw new Error(`bun build --compile ${target.bun} failed:\n${built.stderr.toString()}`);
  }
  return outfile;
}

/** `sha256sum --check` lines for `files`, named as they are published. */
export function checksums(files: readonly string[]): string {
  return files
    .map(
      (file) =>
        `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${basename(file)}\n`,
    )
    .join("");
}

if (import.meta.main) {
  const outdir = join(import.meta.dir, "..", "dist");
  mkdirSync(outdir, { recursive: true });
  const targets = process.argv.includes("--host") ? [hostTarget()] : TARGETS;
  const files = targets.map((target) => compile(target, outdir));
  writeFileSync(join(outdir, CHECKSUMS), checksums(files));
  process.stdout.write(`${[...files, join(outdir, CHECKSUMS)].join("\n")}\n`);
}
