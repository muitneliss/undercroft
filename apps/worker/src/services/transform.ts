/**
 * Building one tenant's models, as that tenant.
 *
 * dbt is a subprocess, not a library: we spawn the `dbt` binary that ships in the worker
 * image and read what it wrote. We write no Python and import nothing from dbt -- it is a
 * dependency we invoke, like `pg_dump`. Why in the worker image rather than a container the
 * worker starts is ADR 0007: starting a container needs the Docker socket, and nothing in
 * this stack gets one.
 *
 * What one build does, in order, and why each step is where it is:
 *
 * 1. **Provision** the tenant's roles and schemas (idempotent).
 * 2. **Write the project** to a fresh temporary directory: the platform's sources and macros,
 *    the customer's models from `app.model` and macros from `app.macro`, and a profile that
 *    IS the tenant. A directory
 *    that exists for one build cannot drift from the table.
 * 3. **Spawn `dbt build`** with a deadline, **holding** the password of the tenant's dbt login
 *    for as long as that deadline: dbt parses for seconds before it first connects, and opens
 *    connections for the whole build, so a password changed under it by another session of the
 *    same login locks it out (ADR 0087). The password is the environment of one child process.
 *    A build that runs for half an hour is a build that has hung, and the previous tables keep
 *    serving -- stale, not wrong.
 * 4. **Read `run_results.json`** into steps for the ledger, one per model or test. A
 *    non-zero exit with results is a build that ran and found something wrong, reported step
 *    by step; a non-zero exit with no results is dbt stopping before its first model, and that
 *    raises with dbt's own statement of why (`causeOf`).
 * 5. **Record what was built**: the columns each successful model's relation now has, read
 *    as the tenant's dbt login and written back to `app.model` so the editor can offer them.
 * 6. **Remove the directory**, whatever happened.
 *
 * A tenant with no models spawns nothing and reports an empty, successful build.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ConnectorError } from "@undercroft/core";
import type { DatabaseAddress, SqlExecutor } from "@undercroft/db";
import {
  listMacros,
  listModels,
  provisionTenantRoles,
  type RunStep,
  setModelColumns,
  tenantRolesFor,
} from "@undercroft/db/repos";
import { parseRunResults, PASSWORD_VAR, renderProject } from "@undercroft/db/services";

import { columnsOf } from "../repos/relations.ts";
import { TenantNotProvisioned, type TenantSessions } from "./tenantSession.ts";

export interface SpawnOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

/**
 * What a child said, on each stream, kept apart.
 *
 * APART BECAUSE THEY ARE DIFFERENT FACTS. `stdout` is the program's answer; `stderr` is its
 * commentary on getting there. `tesseract` writes "Estimating resolution as 190" to stderr for
 * almost every image and `pdftotext` a "Syntax Error" line for every malformed object, whether
 * or not either found a word. Joined into one string they were stored as the document's text:
 * an image with no text on it read as the sentence about its resolution, a scan's PDF cleared
 * the text-layer threshold on poppler's complaints alone and was never OCR'd, and
 * `OCR_FOUND_NOTHING` could never fire. A caller that wants both -- dbt's failure tail -- joins
 * them itself, knowing it is making a log and not a value.
 */
export interface SpawnResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Spawn = (cmd: readonly string[], options: SpawnOptions) => Promise<SpawnResult>;

export interface TransformDeps {
  /** The worker's own executor: provisioning, rotation, the models, the columns written back. */
  readonly exec: SqlExecutor;
  /** Where the generated profile points dbt. */
  readonly database: DatabaseAddress;
  /** How the worker becomes the tenant: the password dbt logs in with, and reading what it built. */
  readonly sessions: TenantSessions;
  /**
   * The worker's own environment, which the child sees only the `CHILD_ENV` part of. `PATH`
   * finds `dbt`.
   */
  readonly env?: NodeJS.ProcessEnv;
  /** Injected in tests; the process uses Bun.spawn against the real binary. */
  readonly spawn?: Spawn;
  /** Where project directories are made. Defaults to the OS temp directory. */
  readonly workDir?: string;
  /** How long one build may run. */
  readonly timeoutMs?: number;
}

export interface TransformOutcome {
  readonly ok: boolean;
  readonly steps: RunStep[];
  readonly testsFailed: number;
  /** Why a build is not ok: the first erroring model's message, else dbt's last lines. */
  readonly error: string | null;
  /**
   * How many models the tenant HAS, which is not how many were built.
   *
   * Zero is the reason a green build can have no steps at all: dbt was never spawned,
   * because there was nothing to spawn it for. Reported rather than inferred from an empty
   * `steps`, because "this customer has no models" and "the `--select` matched nothing" look
   * identical from outside and want different sentences on the screen.
   */
  readonly models: number;
}

/** A scheduled build of every model. Longer than any honest project needs. */
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
/** How many trailing lines of dbt's output are kept. Enough to name the fault; never a row. */
const TAIL_LINES = 20;

/**
 * How this repo runs a child process. Exported so the extract verb's composition root wires
 * the SAME one rather than a second implementation -- a second spawn is a second place for a
 * timeout to be forgotten.
 */
export async function realSpawn(
  cmd: readonly string[],
  options: SpawnOptions,
): Promise<SpawnResult> {
  const proc = Bun.spawn([...cmd], {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const deadline = setTimeout(() => proc.kill(), options.timeoutMs);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(deadline);
  }
}

/** The line dbt opens its own account of an error it stopped on with. */
const ENCOUNTERED = "Encountered an error";
/** The `HH:MM:SS  ` dbt writes in front of each line it logs. */
const LOG_TIME = /^\d{2}:\d{2}:\d{2}\s+/u;

function tailOf(output: string): string {
  return output.trim().split("\n").slice(-TAIL_LINES).join("\n");
}

/**
 * Why dbt stopped before its first model, in its own words: its "Encountered an error:" line
 * and everything after it, else its last lines.
 *
 * NOT THE TAIL (issue #336). A run keeps the first 500 characters of its error, and when dbt
 * stops early its last lines are mostly its startup banner -- which took all 500 and cut the
 * cause off at the "E" of "Encountered". Starting at that line puts the cause first, so the
 * bound, when it bites, keeps the cause's opening words and drops the banner instead. The
 * time dbt stamps on each line is dropped for the same reason: it is not the cause.
 */
function causeOf(output: string): string {
  const lines = output.trim().split("\n");
  const at = lines.findIndex((line) => line.replace(LOG_TIME, "").startsWith(ENCOUNTERED));
  if (at === -1) {
    return tailOf(output);
  }
  return lines
    .slice(at)
    .map((line) => line.replace(LOG_TIME, "").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * What dbt may see of the worker's environment: where programs and certificates are, and the
 * locale and zone it formats in. Nothing else.
 *
 * WHY AN ALLOWLIST. A model or a macro is text a tenant wrote, and dbt's `env_var()` reads the
 * process environment into it: `{{ env_var('UNDERCROFT_SECRET_KEY') }}` in a model would copy
 * the master key into a table the tenant can read, and so would the worker's DSN or an OAuth
 * client secret. The worker's environment holds all of them, and handing it over whole was
 * exactly that hole (ADR 0086). Copying the few names dbt needs cannot leak a secret added
 * tomorrow; removing the known secrets from the whole would.
 */
const CHILD_ENV: readonly string[] = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

/** The child's environment: `CHILD_ENV` of the parent's, plus the tenant's one password. */
function childEnv(parent: NodeJS.ProcessEnv | undefined, password: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV) {
    const value = parent?.[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env[PASSWORD_VAR] = password;
  return env;
}

async function writeProject(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text, "utf8");
  }
}

async function readRunResults(dir: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dir, "target", "run_results.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Why the build is not ok, in dbt's own words for the model that broke. */
function errorOf(steps: readonly RunStep[], tail: string): string | null {
  const broken = steps.find((s) => s.kind === "model" && s.status === "error");
  if (broken === undefined) {
    return null;
  }
  return broken.message ?? tail;
}

/**
 * Record the columns each successful model now has, as the tenant reads them.
 *
 * One session for every model of the build; the write-back is the worker's own column-level
 * grant on `app.model`. A model whose relation cannot be seen records nothing rather than an
 * empty list that would read as "no columns".
 */
async function recordColumns(
  deps: TransformDeps,
  tenantId: string,
  analyticsSchema: string,
  built: readonly string[],
): Promise<void> {
  if (built.length === 0) {
    return;
  }
  const found = await deps.sessions.as({ tenantId, kind: "dbt" }, async (exec) => {
    const byModel = new Map<string, string[]>();
    for (const name of built) {
      const columns = await columnsOf(exec, analyticsSchema, name);
      if (columns.length > 0) {
        byModel.set(
          name,
          columns.map((c) => c.name),
        );
      }
    }
    return byModel;
  });
  for (const [name, columns] of found) {
    await setModelColumns(deps.exec, tenantId, name, columns);
  }
}

/**
 * `dbt build` over the project in `dir`, logged in as the tenant's dbt login for the whole
 * deadline. Both streams, joined: dbt names a failed model on stdout and a crashed adapter on
 * stderr, and the caller reads them as a log, not a value.
 */
async function spawnDbt(
  deps: TransformDeps,
  input: { tenantId: string; select?: string; timeoutMs?: number },
  dir: string,
): Promise<{ exitCode: number; output: string }> {
  const spawn = deps.spawn ?? realSpawn;
  const cmd = [
    "dbt",
    "build",
    // Colour codes are bytes of the stored error that say nothing about the fault.
    "--no-use-colors",
    "--profiles-dir",
    dir,
    "--project-dir",
    dir,
    ...(input.select === undefined ? [] : ["--select", input.select]),
  ];
  const timeoutMs = input.timeoutMs ?? deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { exitCode, stdout, stderr } = await deps.sessions.withPassword(
    { tenantId: input.tenantId, kind: "dbt" },
    timeoutMs,
    (password) => spawn(cmd, { cwd: dir, env: childEnv(deps.env, password), timeoutMs }),
  );
  return { exitCode, output: `${stdout}\n${stderr}` };
}

/**
 * Build the tenant's models, or the one `select` names, and report step by step.
 *
 * Raises only when dbt could not run at all -- no binary, no results -- with dbt's own
 * account of why as the cause. A build that ran and failed is an outcome, not an exception:
 * the ledger wants its steps.
 */
export async function runTransform(
  deps: TransformDeps,
  input: { tenantId: string; select?: string; timeoutMs?: number },
): Promise<TransformOutcome> {
  await provisionTenantRoles(deps.exec, input.tenantId);
  const roles = await tenantRolesFor(deps.exec, input.tenantId);
  if (roles === null) {
    throw new TenantNotProvisioned(input.tenantId);
  }
  const models = await listModels(deps.exec, input.tenantId);
  if (models.length === 0) {
    return { ok: true, steps: [], testsFailed: 0, error: null, models: 0 };
  }

  const macros = await listMacros(deps.exec, input.tenantId);
  const dir = await mkdtemp(join(deps.workDir ?? tmpdir(), "undercroft-dbt-"));
  try {
    await writeProject(
      dir,
      renderProject({
        slug: roles.slug,
        database: deps.database,
        models: models.map((m) => ({ name: m.name, sql: m.sql, tests: m.tests })),
        macros: macros.map((m) => ({ name: m.name, sql: m.sql })),
      }),
    );
    const { exitCode, output } = await spawnDbt(deps, input, dir);
    const { steps, testsFailed } = parseRunResults(await readRunResults(dir));

    if (exitCode !== 0 && steps.length === 0) {
      throw new ConnectorError("dbt", "build", 0, `dbt build exited ${String(exitCode)}`, {
        cause: new Error(causeOf(output)),
      });
    }
    const error = errorOf(steps, tailOf(output));
    const built = steps
      .filter((s) => s.kind === "model" && s.status === "success")
      .map((s) => s.name);
    await recordColumns(deps, input.tenantId, roles.analyticsSchema, built);
    return { ok: error === null, steps, testsFailed, error, models: models.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
