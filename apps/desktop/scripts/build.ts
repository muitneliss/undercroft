/**
 * Build the desktop app for this machine with Electrobun's pinned toolchain (ADR 0097).
 *
 *   build.ts            a release build (`--env=stable`) into `apps/desktop/artifacts/`
 *   build.ts --dev      a development build into `apps/desktop/build/`, which `--run` also opens
 *
 * Electrobun builds for the operating system it runs on -- a macOS app on macOS, a Windows
 * installer on Windows -- so a release is three runners, one per platform
 * (`.github/workflows/release.yml`). The first build downloads the pinned Hutch toolchain and
 * Electrobun's runtime for this platform, so it needs the network once.
 *
 * The npm bootstrap is run by THIS Bun rather than through `node_modules/.bin`, which on
 * Windows is a shim of a different shape; the bootstrap is plain CommonJS and Bun runs it.
 *
 * Runnable as `task build:desktop` and `task dev:desktop`.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

export const APP = join(import.meta.dir, "..");
export const ARTIFACTS = join(APP, "artifacts");
const ELECTROBUN = join(APP, "node_modules", "electrobun", "bin", "electrobun.cjs");

/** Run the pinned Electrobun CLI in the app's folder, its output on this terminal. */
export function electrobun(args: readonly string[], env: Record<string, string> = {}): void {
  const done = Bun.spawnSync([process.execPath, ELECTROBUN, ...args], {
    cwd: APP,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...env },
  });
  if (done.exitCode !== 0) {
    throw new Error(`electrobun ${args.join(" ")} exited with ${done.exitCode}`);
  }
}

if (import.meta.main) {
  const dev = process.argv.includes("--dev");
  if (dev && process.argv.includes("--run")) {
    electrobun(["dev"]);
  } else {
    electrobun(["build", dev ? "--env=dev" : "--env=stable"]);
    if (!dev) {
      process.stdout.write(
        `${readdirSync(ARTIFACTS)
          .map((file) => join(ARTIFACTS, file))
          .join("\n")}\n`,
      );
    }
  }
}
