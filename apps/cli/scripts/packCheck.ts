/**
 * Run the packed CLI exactly the way the skill does, and fail if it does not answer.
 *
 * `cli.test.ts` proves the bundle; this proves the PACKAGE -- that the tarball has a `bin`
 * npm can link, that the bundle inside it runs from wherever npx unpacks it, and that it
 * needs nothing the tarball does not carry. Those are the failures a release would otherwise
 * find first, in a user's agent.
 *
 * Outside `task ci:verify` because it needs npm and writes to npm's cache; `task
 * ci:cli-pack-check` runs it, and so does its own CI step.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import process from "node:process";
import { packCli } from "./pack.ts";

interface Ran {
  readonly code: number;
  readonly output: string;
  readonly stdout: string;
}

function npx(project: string, tarball: string, args: readonly string[]): Ran {
  const ran = Bun.spawnSync(["npx", "-y", `--package=${tarball}`, "undercroft", ...args], {
    cwd: project,
    // biome-ignore lint/style/noProcessEnv: npx needs the caller's PATH and npm settings; the CLI's own home is pointed at the scratch directory.
    env: { ...process.env, UNDERCROFT_CLI_HOME: join(project, "home") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = ran.stdout.toString();
  return { code: ran.exitCode, stdout, output: `${stdout}${ran.stderr.toString()}` };
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

/** What is wrong with the packed CLI, or the one-line summary of what is right. */
async function check(dir: string): Promise<{ readonly ok: boolean; readonly report: string }> {
  const tarball = await packCli(join(dir, "pack"));
  const project = join(dir, "project");
  mkdirSync(project, { recursive: true });

  const help = npx(project, tarball, ["--help"]);
  if (help.code !== 0 || !help.stdout.includes("USAGE")) {
    return { ok: false, report: `\`undercroft --help\` did not print usage\n${help.output}` };
  }
  const described = npx(project, tarball, ["describe", "--agent"]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(described.stdout);
  } catch {
    return {
      ok: false,
      report: `\`describe --agent\` did not print one JSON envelope\n${described.output}`,
    };
  }
  if (described.code !== 0 || field(parsed, "ok") !== true) {
    return { ok: false, report: `\`describe --agent\` did not succeed\n${described.output}` };
  }
  const count = field(field(parsed, "meta"), "count");
  return { ok: true, report: `${basename(tarball)} runs through npx; ${String(count)} commands` };
}

const scratch = mkdtempSync(join(tmpdir(), "undercroft-cli-pack-check-"));
let result: { readonly ok: boolean; readonly report: string };
try {
  result = await check(scratch);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
(result.ok ? process.stdout : process.stderr).write(`cli-pack-check: ${result.report}\n`);
process.exitCode = result.ok ? 0 : 1;
