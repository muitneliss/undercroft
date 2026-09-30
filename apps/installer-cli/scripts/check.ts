/**
 * Smoke-test the compiled installer: build this machine's binary, then run it the way a person
 * and a script would, with no Docker.
 *
 * What it proves is what `bun test` cannot: that the COMPILED binary starts -- the compose file
 * is embedded, the catalogues load, the package metadata resolves -- and that the unattended
 * path answers without a terminal. `--dry-run` stops before Docker and writes nothing, so the
 * check needs no daemon, no network and no credentials.
 *
 * Runnable as `task ci:installer-check`.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { compile, hostTarget } from "./build.ts";

const PACKAGE = join(import.meta.dir, "..", "package.json");

function version(): string {
  const manifest: unknown = JSON.parse(readFileSync(PACKAGE, "utf8"));
  const value: unknown =
    typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, "version") : null;
  if (typeof value !== "string") {
    throw new Error("apps/installer-cli/package.json has no version");
  }
  return value;
}

interface Run {
  readonly code: number;
  readonly output: string;
}

function run(binary: string, args: readonly string[]): Run {
  const result = Bun.spawnSync([binary, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

function expect(condition: boolean, what: string, seen: Run): void {
  if (!condition) {
    throw new Error(`installer check failed: ${what}\n--- exit ${seen.code} ---\n${seen.output}`);
  }
}

const staging = mkdtempSync(join(tmpdir(), "undercroft-installer-check-"));
try {
  const binary = compile(hostTarget(), staging);
  const installDir = join(staging, "install");

  const help = run(binary, ["--help", "--lang", "en"]);
  expect(help.code === 0 && help.output.includes("undercroft-installer"), "--help answers", help);

  const shown = run(binary, ["--version"]);
  expect(
    shown.code === 0 && shown.output.trim() === `v${version()}`,
    "--version is the package's",
    shown,
  );

  const dry = run(binary, ["up", "--yes", "--dry-run", "--lang", "en", "--dir", installDir]);
  expect(dry.code === 0 && dry.output.includes("http://localhost:13000"), "a desktop dry run", dry);
  expect(!existsSync(installDir), "a dry run writes nothing", dry);

  const server = run(binary, ["--yes", "--dry-run", "--mode", "server", "--dir", installDir]);
  expect(server.code === 1, "a server install with no sign-in method is refused", server);

  const unknown = run(binary, ["--mode", "cloud"]);
  expect(unknown.code === 1, "an unknown mode is refused", unknown);

  process.stdout.write(`installer check passed: ${binary}\n`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
