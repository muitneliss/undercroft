/**
 * Pack the CLI as the tarball each release attaches: `undercroft-cli-X.Y.Z.tgz`.
 *
 * Distribution is not an npm registry (ADR 0044). The control plane's image packs it with this
 * script and serves it at `/cli/undercroft-cli.tgz`, so a person installs the CLI of the very
 * server they sign in to (ADR 0135); each release also attaches it, for a person with access to
 * the repository.
 *
 * Packed by `bun pm pack`, not `npm pack`, because the image that builds it has Bun and no Node:
 * the tarball is the same npm layout (`package/...`), and `task ci:cli-pack-check` proves npm
 * installs and runs it. Bun also stamps every entry with one fixed time, so the same sources
 * pack to the same bytes wherever they are packed.
 *
 * The package is staged from nothing rather than packed from `apps/cli`, whose `package.json`
 * is a workspace manifest -- `workspace:*` dependencies, a build that needs the router. What
 * ships is the one bundled file, a `bin`, and NO dependencies, because everything is inside
 * the bundle. `engines` is Node 22, the floor `@oclif/core` 5 declares.
 *
 * Also runnable: `task build:cli-pack` writes the tarball into `apps/cli/dist/`.
 */

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { BUNDLE, buildCli } from "./build.ts";

const CLI_ROOT = join(import.meta.dir, "..");
const REPO = join(CLI_ROOT, "..", "..");

/** The version release-please keeps in `apps/cli/package.json`, in step with the root's. */
export function cliVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8"));
  if (typeof manifest !== "object" || manifest === null || !("version" in manifest)) {
    throw new Error("apps/cli/package.json has no version");
  }
  return String(manifest.version);
}

export async function packCli(outdir: string): Promise<string> {
  const staging = mkdtempSync(join(tmpdir(), "undercroft-cli-pack-"));
  try {
    await buildCli(join(staging, "dist"));
    const version = cliVersion();
    writeFileSync(
      join(staging, "package.json"),
      `${JSON.stringify(
        {
          name: "undercroft-cli",
          version,
          description:
            "Undercroft from a terminal: everything the web UI does, through the same API.",
          license: "MIT",
          type: "module",
          bin: { undercroft: `dist/${BUNDLE}` },
          files: [`dist/${BUNDLE}`],
          engines: { node: ">=22" },
          repository: { type: "git", url: "git+https://github.com/muitneliss/undercroft.git" },
        },
        null,
        2,
      )}\n`,
    );
    copyFileSync(join(REPO, "LICENSE"), join(staging, "LICENSE"));
    mkdirSync(outdir, { recursive: true });
    // Named here rather than read back from the tool's output, so the file is the release's
    // name whatever the packer's own naming rules become.
    const tarball = join(outdir, `undercroft-cli-${version}.tgz`);
    const packed = Bun.spawnSync(
      [process.execPath, "pm", "pack", "--quiet", "--ignore-scripts", "--filename", tarball],
      { cwd: staging, stdout: "pipe", stderr: "pipe" },
    );
    if (packed.exitCode !== 0) {
      throw new Error(`bun pm pack failed:\n${packed.stderr.toString()}`);
    }
    return tarball;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.stdout.write(`${await packCli(join(CLI_ROOT, "dist"))}\n`);
}
