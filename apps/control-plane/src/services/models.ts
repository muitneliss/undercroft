/**
 * The customer's dbt models: listed with their last build and what its tests found (ADR 0129),
 * read in full, saved, deleted together with what they built.
 *
 * Save stores and executes nothing. That is the whole of this module's promise: a model
 * saved with a syntax error is a row in `app.model`, not a broken table in `analytics_x`,
 * and Build -- a worker verb, chosen separately -- is where SQL first runs. An author who
 * has saved and not built has changed nothing a dashboard can see.
 *
 * Two ways to write: `create` refuses a name already in use, because a person creating
 * "stg_deals" over a colleague's has to be told; `save` overwrites, because that is what
 * pressing Save on an open editor means. The handler words the refusal.
 *
 * The audit row names the model and who saved it, never the SQL: the trail is for "who
 * changed what", and the SQL is in the table beside it.
 */

import {
  canonicalTests,
  type DqFailuresRequest,
  ModelTests,
  type TableResult,
} from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import {
  deleteModelUnlessBuilding,
  getModel,
  insertModel,
  type LastBuild,
  lastBuildPerModel,
  listMacros,
  listModels,
  type Model,
  saveModel,
} from "@undercroft/db/repos";
import {
  checkModel,
  checkTests,
  type Finding,
  type Lineage,
  type LineageTarget,
  lineageAround,
  type ModelCheck,
  modelLineage,
} from "@undercroft/db/services";

import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import { type ListRequest, mapNarrowed, type Narrowed, narrowByName } from "./listFilter.ts";
import {
  readTestStates,
  summaryOf as testSummaryOf,
  type TestDetail,
  type TestSummary,
} from "./testState.ts";
import type { WorkerClient, WorkerOutcome } from "./workerClient.ts";

export type { LastBuild, Model } from "@undercroft/db/repos";

/** A model's last build as a list shows it: how many columns it found, not which. */
export interface BuildSummary extends LastBuild {
  /**
   * How many columns the last SUCCESSFUL build found, or `null` while none has. Never `0`: a
   * SELECT yields at least one column, so an empty record means "not known yet", and a model
   * whose only build failed must not read as a table with no columns.
   */
  readonly columnCount: number | null;
  /** The columns themselves, on `get` always and on the list only when asked (`include`). */
  readonly columns?: readonly string[];
}

/** A build with its columns, as `get` always answers it. Empty until a build has succeeded. */
export interface BuildWithColumns extends BuildSummary {
  readonly columns: readonly string[];
}

interface ModelFacts {
  readonly name: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  /**
   * Hex SHA-256 of the stored SQL's UTF-8 bytes, so a client can tell whether its file is the
   * server's copy without fetching it: the same text hashes the same anywhere (ADR 0127).
   */
  readonly sqlSha256: string;
  /**
   * Hex SHA-256 of the stored tests as Postgres prints them. Compare it with one this platform
   * gave before, never with a hash of a local file: `jsonb` normalises key order and spacing.
   */
  readonly testsSha256: string;
}

/** One model on the list: what a reader chooses one by, and no SQL. */
export interface ModelItem extends ModelFacts {
  readonly lastBuild: BuildSummary | null;
  /**
   * What the tests of the build serving this model's rows found: `passing`, `failing` with how
   * many, or `unknown` -- never passing for a model with no test record (ADR 0129). Not
   * `lastBuild.status`: a build whose tests fail still succeeds, and its rows are served.
   */
  readonly lastTests: TestSummary;
}

/** One model in full: its SQL, its tests and the columns its last build found. */
export interface ModelDetail extends ModelFacts {
  readonly lastBuild: BuildWithColumns | null;
  /** As on the list, with the tests that failed and the ones that warned, by name. */
  readonly lastTests: TestDetail;
  readonly sql: string;
  readonly tests: ModelTests;
}

/** What `list` adds to each model beyond its summary. */
export type ModelInclude = "columns";

function facts(model: Model): ModelFacts {
  return {
    name: model.name,
    updatedAt: model.updatedAt,
    updatedBy: model.updatedBy,
    sqlSha256: model.sqlSha256,
    testsSha256: model.testsSha256,
  };
}

function buildOf(model: Model, built: LastBuild): BuildWithColumns {
  return {
    ...built,
    columnCount: model.columns.length === 0 ? null : model.columns.length,
    columns: model.columns,
  };
}

function summaryOf(
  model: Model,
  built: LastBuild | undefined,
  tests: TestDetail,
  columns: boolean,
): ModelItem {
  const lastTests = testSummaryOf(tests);
  if (built === undefined) {
    return { ...facts(model), lastBuild: null, lastTests };
  }
  const { columns: listed, ...summary } = buildOf(model, built);
  return {
    ...facts(model),
    lastBuild: columns ? { ...summary, columns: listed } : summary,
    lastTests,
  };
}

/**
 * The tenant's models with their last build, narrowed by `filter` (`listFilter.ts`). Each says
 * how many columns its build found; which ones only when `include` names `columns`, because 176
 * models' column lists were most of a list that overflowed its client (issue 444).
 */
export async function list(
  exec: SqlExecutor,
  tenantId: string,
  request: ListRequest<ModelInclude> = {},
): Promise<Narrowed<ModelItem>> {
  const [models, builds, tests] = await Promise.all([
    listModels(exec, tenantId),
    lastBuildPerModel(exec, tenantId),
    readTestStates(exec, tenantId),
  ]);
  const columns = request.include?.includes("columns") ?? false;
  return mapNarrowed(
    narrowByName(models, (m) => m.name, request),
    (m) => summaryOf(m, builds.get(m.name), tests(m.name), columns),
  );
}

export async function get(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
): Promise<ModelDetail | null> {
  const model = await getModel(exec, tenantId, name);
  if (model === null) {
    return null;
  }
  const [builds, tests] = await Promise.all([
    lastBuildPerModel(exec, tenantId),
    readTestStates(exec, tenantId, [name]),
  ]);
  const built = builds.get(name);
  return {
    ...facts(model),
    lastBuild: built === undefined ? null : buildOf(model, built),
    lastTests: tests(name),
    sql: model.sql,
    // Re-validated on the way out rather than asserted: the row's shape is the contract's
    // by construction, and a parse says so where an assertion would only claim it.
    tests: ModelTests.parse(model.tests),
  };
}

export type SaveOutcome =
  | { readonly ok: true; readonly unchanged: boolean }
  | { readonly ok: false; readonly reason: "name-taken" }
  | { readonly ok: false; readonly reason: "test-refused"; readonly finding: Finding };

/**
 * Store the model. With `create`, a name already in use is refused and nothing is written.
 *
 * The tests are stored in their one canonical spelling (`canonicalTests`), so the same tests
 * hash and compare the same however a caller wrote them. A test `checkTests` finds an error in
 * -- a SQL test that is not one safe SELECT of its own model, a `relationships` to a model the
 * tenant lacks -- refuses the save with that finding and writes nothing (ADR 0130). The model's
 * own SQL is still never refused here: a saved mistake in it is a row, not a broken table.
 *
 * Saving exactly the SQL and tests already stored is `unchanged`: the row keeps its
 * `updatedAt` and `updatedBy`, and no audit row is written, because nothing took effect
 * (ADR 0113, ADR 0127). The repo decides it in the upsert itself, not by a read first.
 */
export async function save(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    name: string;
    sql: string;
    tests: ModelTests;
    create: boolean;
    actor: Actor;
    actorId: string;
  },
): Promise<SaveOutcome> {
  const tests = canonicalTests(input.tests);
  const refused = await refusedTest(exec, input.tenantId, input.name, tests);
  if (refused !== null) {
    return { ok: false, reason: "test-refused", finding: refused };
  }
  const model = { name: input.name, sql: input.sql, tests, updatedBy: input.actorId };
  const result = input.create
    ? (await insertModel(exec, input.tenantId, model))
      ? "written"
      : "name-taken"
    : await saveModel(exec, input.tenantId, model);
  if (result === "name-taken") {
    return { ok: false, reason: "name-taken" };
  }
  if (result === "written") {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "models.save",
      detail: JSON.stringify({ name: input.name, created: input.create }),
    });
  }
  return { ok: true, unchanged: result === "unchanged" };
}

/** The first error `checkTests` finds in `tests`, or `null`; reads the tenant only when needed. */
async function refusedTest(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
  tests: ModelTests,
): Promise<Finding | null> {
  const relates = Object.values(tests.columns).some((declaredTests) =>
    declaredTests.some(
      (declared) => typeof declared !== "string" && declared.kind === "relationships",
    ),
  );
  if (!relates && (tests.sql ?? []).length === 0) {
    return null;
  }
  const [existing, macros] = await Promise.all([
    listModels(exec, tenantId),
    listMacros(exec, tenantId),
  ]);
  const findings = checkTests({
    name,
    tests,
    existingModels: existing.map((model) => model.name),
    existingMacros: macros.map((macro) => macro.name),
  });
  return findings.find((found) => found.severity === "error") ?? null;
}

/**
 * What can be said about a model's SQL before it is saved or built, against the tenant's own
 * model and macro names. Reads, stores nothing, and is not the security boundary: the tenant's
 * dbt login's grants are (`modelCheck.ts`).
 */
export async function check(
  exec: SqlExecutor,
  input: { tenantId: string; name: string; sql: string; tests: ModelTests },
): Promise<ModelCheck> {
  const [existing, macros] = await Promise.all([
    listModels(exec, input.tenantId),
    listMacros(exec, input.tenantId),
  ]);
  return checkModel({
    name: input.name,
    sql: input.sql,
    tests: input.tests,
    existingModels: existing.map((model) => model.name),
    existingMacros: macros.map((macro) => macro.name),
  });
}

/**
 * Which of the tenant's models read which, and which raw lake tables, read from the saved
 * models' and macros' own declarations and from nothing else (`modelLineage.ts`, ADR 0092).
 * Computed on every call rather than stored: a stored graph would be one more thing a save
 * could leave stale, and the text it is read from is already here.
 *
 * With a `target`, only the part around the node it names (`lineageAround`), or `null` when
 * the tenant's graph has no such node. The whole graph is read either way: which models reach
 * a node is only known once every model's declarations are.
 */
export async function lineage(
  exec: SqlExecutor,
  tenantId: string,
  target: LineageTarget | null = null,
): Promise<Lineage | null> {
  const [models, macros] = await Promise.all([
    listModels(exec, tenantId),
    listMacros(exec, tenantId),
  ]);
  const graph = modelLineage({ models, macros });
  return target === null ? graph : lineageAround(graph, target);
}

/** The rows a failed test stored, through the worker; nothing here decides who may look. */
export function dqFailures(
  worker: WorkerClient,
  input: DqFailuresRequest,
): Promise<WorkerOutcome<TableResult>> {
  return worker.dqFailures(input);
}

export type RemoveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not-found" | "in-progress" | "not-dropped" }
  | { readonly ok: false; readonly reason: "depended-on"; readonly dependents: readonly string[] };

/**
 * Remove the model AND what it built, or neither. ADR 0077.
 *
 * The data goes first, through the worker, as the tenant's dbt login -- the only one that may
 * drop what it built. The row goes only after the worker has said the relations are gone, so
 * a worker that is down, refuses, or fails part-way leaves the model exactly as it was, and
 * the person is told it was NOT deleted and can try again. The other order was the defect: a
 * row deleted first said "deleted" while every table it built stayed readable, and left
 * nothing on screen to try again with.
 *
 * The row's delete is conditional on no build running, in the same statement, because a
 * build that opened after the drop re-creates what was dropped; then nothing is deleted and
 * the person is asked to wait. The audit row names what was dropped, never what it held.
 */
export async function remove(
  exec: SqlExecutor,
  worker: WorkerClient,
  input: { tenantId: string; name: string; actor: Actor },
): Promise<RemoveOutcome> {
  if ((await getModel(exec, input.tenantId, input.name)) === null) {
    return { ok: false, reason: "not-found" };
  }
  const drop = await worker.dropModel({ tenantId: input.tenantId, model: input.name });
  if (!drop.ok) {
    if (drop.reason === "depended-on") {
      return drop;
    }
    return { ok: false, reason: drop.reason === "in-progress" ? "in-progress" : "not-dropped" };
  }
  const deleted = await deleteModelUnlessBuilding(exec, input.tenantId, input.name);
  if (deleted !== "deleted") {
    return { ok: false, reason: deleted === "building" ? "in-progress" : "not-found" };
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "models.delete",
    detail: JSON.stringify({
      name: input.name,
      dropped: drop.value.dropped.map((r) => `${r.schema}.${r.name}`),
    }),
  });
  return { ok: true };
}
