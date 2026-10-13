/**
 * What an unsaved model returns: compile it inside the tenant's own project, and run what dbt
 * compiled in the read-only frame, as the tenant's dbt login (ADR 0132).
 *
 * An author wants to see a model's rows -- or `select count(*), count(distinct k)` over them --
 * before `models.save`. `models.check` reads text and cannot say what the SQL returns, and a build
 * needs a save, opens a run and replaces a table. Rendering the Jinja anywhere but dbt is a copy
 * of dbt that drifts, which is the workaround this replaces. So dbt does the compiling, over the
 * very project a build would write (`tenantProjectFiles`), with the draft in place of the saved
 * model of its name or beside the saved ones. Nothing is stored, built, or entered in the ledger.
 *
 * In order, and why each is where it is:
 *
 * 1. **The tenant must be provisioned** (`tenantRolesFor`), or there is no login to answer as. A
 *    preview provisions nothing: it is a look, and a look creates no roles.
 * 2. **The project**, rendered exactly as a build renders it, the draft with no tests: a test is
 *    the build's to run. The seeds go through `projectSeeds` like a build's. It READS the columns
 *    standing in staging, as the dbt login, to decide each seed's full refresh -- a flag in
 *    `dbt_project.yml` that only a seed load acts on and `compile` never does. It writes nothing.
 * 3. **`dbt compile` of that one model, holding NO credential.** The child's environment is the
 *    `CHILD_ENV` allowlist (ADR 0086) with the password set to `""`, and the lease a build takes
 *    on the dbt login (`withPassword`) is not taken. With `--no-introspect` and
 *    `--no-populate-cache` a compile never connects -- measured against dbt-core 1.9.1: it
 *    succeeds with a wrong or an empty password -- and a model that calls `run_query` is refused
 *    ("connection never acquired") rather than executed, so a draft cannot run a statement
 *    through Jinja. With nothing to log in with, compiling cannot touch the database even if a
 *    later dbt changed its mind about connecting. `--indirect-selection empty` keeps the saved
 *    models' tests out, and an ephemeral parent is inlined as dbt inlines it in a build.
 * 4. **The compiled SQL** is the manifest's `compiled_code` for the model, which carries those
 *    inlined parents. A compile that failed, or wrote no code, is `ModelCompileFailed` with dbt's
 *    own account of why (`causeOf`) -- including a broken SIBLING, which fails a build the same way.
 * 5. **Run it as `runRawQuery` runs SQL**: the read-only frame (one statement, the extended
 *    protocol, our LIMIT, a statement timeout) as the dbt login, the login a build reads with and
 *    the one `lake.query` admits an admin to. The frame is the boundary, as it is there: the
 *    login may create in its own schemas, and a read-only transaction is what takes that away.
 *    The search path is `raw`, as there. Every name dbt compiled is fully qualified, and an
 *    outer query names the model by its own CTE, so the path decides nothing but where an
 *    unqualified name in an outer query looks -- the same place the console beside it looks.
 * 6. **An outer query** sees the model as a CTE of its name. The newline before the `)` is
 *    load-bearing: compiled code may end in a `--` comment, which would otherwise swallow it.
 *
 * The whole preview takes a `preview` turn (`slots.ts`): a `dbt compile` is a Python process of a
 * few hundred megabytes. No turn within `TURN_WAIT_MS` is `TenantBusy`, as for an export.
 */

import type { ModelPreview, PreviewModelRequest } from "@undercroft/contracts";
import { listMacros, listModels, listSeeds, tenantRolesFor } from "@undercroft/db/repos";

import { causeOf } from "./dbtOutput.ts";
import { AuthorTextRefused } from "./authorTextRefused.ts";
import { QUERY_TIMEOUT_MS, runRawQuery } from "./queryRunner.ts";
import { NotStarted, type RunTurns, turnsFor } from "./slots.ts";
import { TenantBusy } from "./tenantBusy.ts";
import {
  inProjectDir,
  type ProjectParts,
  readTarget,
  tenantProjectFiles,
} from "./tenantProject.ts";
import { TenantNotProvisioned } from "./tenantSession.ts";
import { childEnv, realSpawn, type TransformDeps } from "./transform.ts";

/** How long one `dbt compile` may take. Seconds for an honest project; a hung one is cut. */
export const COMPILE_TIMEOUT_MS = 60_000;
/** How long a preview waits for a turn before it is told the worker is busy. */
const TURN_WAIT_MS = 10_000;
/** What surrounds the three: reading the project, rendering it, opening the session. */
const AROUND_MS = 5000;
/**
 * The longest one preview takes: its turn, its compile, its query, and what surrounds them. Its
 * route holds the request open this long, and the control plane waits a little longer.
 */
export const PREVIEW_DEADLINE_MS = TURN_WAIT_MS + COMPILE_TIMEOUT_MS + QUERY_TIMEOUT_MS + AROUND_MS;

/**
 * dbt would not compile the project with the draft in it. Carries dbt's own account of why, which
 * quotes the tenant's model text and nothing else: compiling reads no row.
 */
export class ModelCompileFailed extends AuthorTextRefused {
  readonly code = "compile_failed";
}

export interface PreviewDeps extends Omit<TransformDeps, "timeoutMs"> {
  /** How many previews at once: `turns.preview`, or no limit when the process set none. */
  readonly turns?: RunTurns;
  /** Aborted when the worker is stopping; a preview still waiting for its turn leaves. */
  readonly stop?: AbortSignal;
}

/** The saved models, with the draft in place of the saved model of its name, or beside them. */
function withDraft(
  saved: ProjectParts["models"],
  draft: { name: string; sql: string },
): ProjectParts["models"] {
  const others = saved.filter((model) => model.name !== draft.name);
  return [...others, { name: draft.name, sql: draft.sql, tests: { columns: {}, sql: [] } }];
}

/** The model's `compiled_code` in the manifest dbt wrote, or `null` when it holds none. */
function compiledCodeOf(manifest: unknown, name: string): string | null {
  const nodes: unknown =
    typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, "nodes") : null;
  const node: unknown =
    typeof nodes === "object" && nodes !== null
      ? Reflect.get(nodes, `model.undercroft.${name}`)
      : null;
  const code: unknown =
    typeof node === "object" && node !== null ? Reflect.get(node, "compiled_code") : null;
  return typeof code === "string" ? code : null;
}

/** `dbt compile` of the one model in `dir`, with no credential; its compiled SQL, or a refusal. */
async function compile(deps: PreviewDeps, dir: string, name: string): Promise<string> {
  const spawn = deps.spawn ?? realSpawn;
  const cmd = [
    "dbt",
    "compile",
    "--no-use-colors",
    "--no-introspect",
    "--no-populate-cache",
    "--indirect-selection",
    "empty",
    "--profiles-dir",
    dir,
    "--project-dir",
    dir,
    "--select",
    name,
  ];
  const { exitCode, stdout, stderr } = await spawn(cmd, {
    cwd: dir,
    // No password at all: see the module docstring, step 3.
    env: childEnv(deps.env, ""),
    timeoutMs: COMPILE_TIMEOUT_MS,
  });
  const code = exitCode === 0 ? compiledCodeOf(await readTarget(dir, "manifest.json"), name) : null;
  if (code === null) {
    const output = `${stdout}\n${stderr}`.trim();
    throw new ModelCompileFailed(
      output === ""
        ? `dbt compile exited ${String(exitCode)} with no compiled SQL`
        : causeOf(output),
    );
  }
  return code;
}

/** The SQL the frame runs: the model itself, or the outer query over it as a CTE of its name. */
function previewSql(compiled: string, input: { name: string; query?: string | undefined }): string {
  // `name` is a `ModelName`, a validated identifier, so quoting it cannot be escaped from.
  return input.query === undefined
    ? compiled
    : `WITH "${input.name}" AS (\n${compiled}\n)\n${input.query}`;
}

async function preview(deps: PreviewDeps, input: PreviewModelRequest): Promise<ModelPreview> {
  const roles = await tenantRolesFor(deps.exec, input.tenantId);
  if (roles === null) {
    throw new TenantNotProvisioned(input.tenantId);
  }
  const [models, macros, seeds] = await Promise.all([
    listModels(deps.exec, input.tenantId),
    listMacros(deps.exec, input.tenantId),
    listSeeds(deps.exec, input.tenantId),
  ]);
  const files = await tenantProjectFiles(deps, {
    tenantId: input.tenantId,
    roles,
    models: withDraft(models, input),
    macros,
    seeds,
  });
  const compiled = await inProjectDir(deps.workDir, files, (dir) => compile(deps, dir, input.name));
  const answer = await runRawQuery(deps, {
    tenantId: input.tenantId,
    sql: previewSql(compiled, input),
    limit: input.limit,
  });
  return { ...answer, compiled };
}

/**
 * See the module docstring. Raises `ModelCompileFailed` with dbt's cause, `QueryFailed` with
 * Postgres's sentence, `TenantBusy` when no turn or connection was free in time, and
 * `TenantNotProvisioned` for a tenant with no logins.
 */
export async function previewModel(
  deps: PreviewDeps,
  input: PreviewModelRequest,
): Promise<ModelPreview> {
  const options = {
    waitMs: TURN_WAIT_MS,
    ...(deps.stop === undefined ? {} : { stop: deps.stop }),
  };
  try {
    return await turnsFor(deps.turns, "preview").run(() => preview(deps, input), options);
  } catch (error) {
    // No turn in time, or a stop while waiting: nothing ran, and asked again it will.
    throw error instanceof NotStarted ? new TenantBusy({ cause: error }) : error;
  }
}
