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
 * 1. **Provision** the tenant's roles and schemas (idempotent) and **mint** a password for
 *    its dbt login. The password is a local here and the environment of one child process.
 * 2. **Write the project** to a fresh temporary directory: the platform's sources and macros,
 *    the customer's models from `app.model`, and a profile that IS the tenant. A directory
 *    that exists for one build cannot drift from the table.
 * 3. **Spawn `dbt build`** with a deadline. A build that runs for half an hour is a build
 *    that has hung, and the previous tables keep serving -- stale, not wrong.
 * 4. **Read `run_results.json`** into steps for the ledger, one per model or test. A
 *    non-zero exit with results is a build that ran and found something wrong, reported step
 *    by step; a non-zero exit with no results is dbt failing to start, and that raises with
 *    its last lines.
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
  listModels,
  provisionTenantRoles,
  rotateTenantPassword,
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

export type Spawn = (
  cmd: readonly string[],
  options: SpawnOptions,
) => Promise<{ exitCode: number; output: string }>;

export interface TransformDeps {
  /** The worker's own executor: provisioning, rotation, the models, the columns written back. */
  readonly exec: SqlExecutor;
  /** Where the generated profile points dbt. */
  readonly database: DatabaseAddress;
  /** How the worker becomes the tenant, to read what it built. */
  readonly sessions: TenantSessions;
  /** The child's environment, less the password this module adds. `PATH` finds `dbt`. */
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

async function realSpawn(
  cmd: readonly string[],
  options: SpawnOptions,
): Promise<{ exitCode: number; output: string }> {
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
    return { exitCode, output: `${stdout}\n${stderr}` };
  } finally {
    clearTimeout(deadline);
  }
}

function tailOf(output: string): string {
  return output.trim().split("\n").slice(-TAIL_LINES).join("\n");
}

/** The child's environment: the parent's defined values, plus the one password. */
function childEnv(parent: NodeJS.ProcessEnv | undefined, password: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent ?? {})) {
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
 * Build the tenant's models, or the one `select` names, and report step by step.
 *
 * Raises only when dbt could not run at all -- no binary, no results -- with its last lines
 * as the cause. A build that ran and failed is an outcome, not an exception: the ledger
 * wants its steps.
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

  const password = await rotateTenantPassword(deps.exec, input.tenantId, "dbt");
  const dir = await mkdtemp(join(deps.workDir ?? tmpdir(), "undercroft-dbt-"));
  try {
    await writeProject(
      dir,
      renderProject({
        slug: roles.slug,
        database: deps.database,
        models: models.map((m) => ({ name: m.name, sql: m.sql, tests: m.tests })),
      }),
    );
    const spawn = deps.spawn ?? realSpawn;
    const cmd = [
      "dbt",
      "build",
      "--profiles-dir",
      dir,
      "--project-dir",
      dir,
      ...(input.select === undefined ? [] : ["--select", input.select]),
    ];
    const { exitCode, output } = await spawn(cmd, {
      cwd: dir,
      env: childEnv(deps.env, password),
      timeoutMs: input.timeoutMs ?? deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const tail = tailOf(output);
    const { steps, testsFailed } = parseRunResults(await readRunResults(dir));

    if (exitCode !== 0 && steps.length === 0) {
      throw new ConnectorError("dbt", "build", 0, `dbt build exited ${String(exitCode)}`, {
        cause: new Error(tail),
      });
    }
    const error = errorOf(steps, tail);
    const built = steps
      .filter((s) => s.kind === "model" && s.status === "success")
      .map((s) => s.name);
    await recordColumns(deps, input.tenantId, roles.analyticsSchema, built);
    return { ok: error === null, steps, testsFailed, error, models: models.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
