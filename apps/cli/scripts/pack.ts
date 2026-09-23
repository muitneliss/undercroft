/**
 * Pack the CLI as the tarball each release attaches: `undercroft-cli-X.Y.Z.tgz`.
 *
 * Distribution is a GitHub release asset, not an npm registry (ADR 0044): the skill runs
 * `npx -y --package=<release URL> undercroft ...`, so installing the skill is how the CLI
 * gets installed, and there is no second place a version can be published from.
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
    const packed = Bun.spawnSync(["npm", "pack", "--json", "--pack-destination", outdir], {
      cwd: staging,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (packed.exitCode !== 0) {
      throw new Error(`npm pack failed:\n${packed.stderr.toString()}`);
    }
    const listing: unknown = JSON.parse(packed.stdout.toString());
    const [first] = Array.isArray(listing) ? listing : [];
    const filename: unknown =
      typeof first === "object" && first !== null ? Reflect.get(first, "filename") : null;
    if (typeof filename !== "string") {
      throw new Error("npm pack did not name the tarball it wrote");
    }
    return join(outdir, filename);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.stdout.write(`${await packCli(join(CLI_ROOT, "dist"))}\n`);
}
