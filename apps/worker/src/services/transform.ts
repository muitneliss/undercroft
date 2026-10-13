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
 *    the customer's models from `app.model`, macros from `app.macro` and seeds from `app.seed`
 *    (each seed loaded the way `seedLoad.ts` decides), and a profile that IS the tenant. A
 *    directory that exists for one build cannot drift from the table.
 * 3. **Spawn `dbt build`** over the selection and the seeds it reaches, with a deadline, **holding** the password of the tenant's dbt login
 *    for as long as that deadline: dbt parses for seconds before it first connects, and opens
 *    connections for the whole build, so a password changed under it by another session of the
 *    same login locks it out (ADR 0087). The password is the environment of one child process.
 *    A build that runs for half an hour is a build that has hung, and the previous tables keep
 *    serving -- stale, not wrong.
 * 4. **Read `run_results.json`** into steps for the ledger, one per model, test or seed, each
 *    test attributed to the model it tests from `manifest.json` (ADR 0129). A
 *    non-zero exit with results is a build that ran and found something wrong, reported step
 *    by step; a non-zero exit with no results is dbt stopping before its first model, and that
 *    raises with dbt's own statement of why (`causeOf`).
 * 5. **Record what was built**: the columns each successful model's relation now has in
 *    staging, read as the tenant's dbt login and written back to `app.model` so the editor can
 *    offer them.
 * 6. **Promote** (ADR 0131): dbt built and tested everything in `staging_<slug>`; only the models
 *    and seeds that built, whose own tests passed and whose parents in this build were promoted
 *    too are moved into `analytics_<slug>`, where the BI login reads (`promote.ts`). Every step
 *    says whether it was. A model that was not keeps its previous published version serving.
 * 7. **Remove the directory**, whatever happened.
 *
 * A tenant with no models and no seeds spawns nothing and reports an empty, successful build.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ConnectorError } from "@undercroft/core";
import type { DatabaseAddress, SqlExecutor } from "@undercroft/db";
import {
  listMacros,
  listModels,
  listSeeds,
  provisionTenantRoles,
  type RunStep,
  setModelColumns,
  tenantRolesFor,
} from "@undercroft/db/repos";
import {
  parseRunResults,
  PASSWORD_VAR,
  renderProject,
  testedModels,
} from "@undercroft/db/services";

import { columnsOf } from "../repos/relations.ts";
import { causeOf, errorOf, tailOf } from "./dbtOutput.ts";
import { publishBuild } from "./promote.ts";
import { projectSeeds, withSeedSelectors } from "./seedLoad.ts";
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
   * The models and seeds a view outside the build kept from being promoted, each with the
   * views' names (ADR 0131). Empty when none did.
   */
  readonly heldByViews?: ReadonlyMap<string, readonly string[]>;
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

/** One of the JSON files dbt writes under `target/`, or `null` when it wrote none readable. */
async function readTarget(dir: string, file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dir, "target", file), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Each test step with the model it tests, from the manifest this build wrote (ADR 0129). A
 * test the manifest does not attribute -- or a build that left no manifest -- keeps `null`,
 * which reads as "unknown" downstream rather than as a pass.
 */
function attributed(steps: readonly RunStep[], manifest: unknown): RunStep[] {
  const byTest = testedModels(manifest);
  return steps.map((step) =>
    step.kind === "test" ? { ...step, model: byTest.get(step.uniqueId) ?? null } : step,
  );
}

/**
 * Record the columns each successful model now has in staging, where it was built, as the
 * tenant reads them -- before promotion moves what passed.
 *
 * One session for every model of the build; the write-back is the worker's own column-level
 * grant on `app.model`. A model whose relation cannot be seen records nothing rather than an
 * empty list that would read as "no columns".
 */
async function recordColumns(
  deps: TransformDeps,
  tenantId: string,
  schema: string,
  steps: readonly RunStep[],
): Promise<void> {
  const built = steps
    .filter((s) => s.kind === "model" && s.status === "success")
    .map((s) => s.name);
  if (built.length === 0) {
    return;
  }
  const found = await deps.sessions.as({ tenantId, kind: "dbt" }, async (exec) => {
    const byModel = new Map<string, string[]>();
    for (const name of built) {
      const columns = await columnsOf(exec, schema, name);
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
  input: { tenantId: string; select?: readonly string[]; timeoutMs?: number },
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
    // Last, and one argv item per selector: dbt 1.9's `--select` takes every value up to the
    // next flag and builds their union, so several selectors are one build, not several.
    ...(input.select === undefined || input.select.length === 0
      ? []
      : ["--select", ...input.select]),
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
 * Build the tenant's models, or the ones `select` names, and report step by step.
 *
 * Raises only when dbt could not run at all -- no binary, no results -- with dbt's own
 * account of why as the cause. A build that ran and failed is an outcome, not an exception:
 * the ledger wants its steps.
 */
export async function runTransform(
  deps: TransformDeps,
  input: { tenantId: string; select?: readonly string[]; timeoutMs?: number },
): Promise<TransformOutcome> {
  await provisionTenantRoles(deps.exec, input.tenantId);
  const roles = await tenantRolesFor(deps.exec, input.tenantId);
  if (roles === null) {
    throw new TenantNotProvisioned(input.tenantId);
  }
  const [models, seeds] = await Promise.all([
    listModels(deps.exec, input.tenantId),
    listSeeds(deps.exec, input.tenantId),
  ]);
  if (models.length === 0 && seeds.length === 0) {
    return { ok: true, steps: [], testsFailed: 0, error: null, models: 0 };
  }

  const macros = await listMacros(deps.exec, input.tenantId);
  const loads = await projectSeeds(deps.sessions, {
    tenantId: input.tenantId,
    schema: roles.stagingSchema,
    seeds,
  });
  const dir = await mkdtemp(join(deps.workDir ?? tmpdir(), "undercroft-dbt-"));
  try {
    await writeProject(
      dir,
      renderProject({
        slug: roles.slug,
        database: deps.database,
        models: models.map((m) => ({ name: m.name, sql: m.sql, tests: m.tests })),
        macros: macros.map((m) => ({ name: m.name, sql: m.sql })),
        seeds: loads,
      }),
    );
    const selected = withSeedSelectors(input, seeds.length > 0);
    const { exitCode, output } = await spawnDbt(deps, selected, dir);
    const { steps: ran, testsFailed } = parseRunResults(await readTarget(dir, "run_results.json"));
    const steps = attributed(ran, await readTarget(dir, "manifest.json"));

    if (exitCode !== 0 && steps.length === 0) {
      throw new ConnectorError("dbt", "build", 0, `dbt build exited ${String(exitCode)}`, {
        cause: new Error(causeOf(output)),
      });
    }
    const error = errorOf(steps, tailOf(output));
    await recordColumns(deps, input.tenantId, roles.stagingSchema, steps);
    const published = await publishBuild(deps.sessions, {
      ...roles,
      tenantId: input.tenantId,
      steps,
      manifest: await readTarget(dir, "manifest.json"),
    });
    return {
      ok: error === null && published.error === null,
      steps: published.steps,
      testsFailed,
      error: error ?? published.error,
      heldByViews: published.heldByViews,
      models: models.length,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
