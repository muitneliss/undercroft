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
 * pressing Save on an open editor means. Either refuses a name one of the tenant's seeds has
 * (ADR 0128): both are what `ref('name')` reads, and dbt refuses a project holding the two. The
 * handler words the refusal.
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
import { hiddenColumns, type Reach, reachesModel } from "@undercroft/contracts/access";
import type { SqlExecutor } from "@undercroft/db";
import {
  deleteModelUnlessBuilding,
  getModel,
  insertModel,
  type LastBuild,
  lastBuildPerModel,
  listModels,
  type Model,
  type ModelWrite,
  saveModel,
  seedExists,
} from "@undercroft/db/repos";
import type { DependsOn, Finding } from "@undercroft/db/services";

import { shownColumns, shownTests } from "./columnsShown.ts";
import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import { dependsOnOf } from "./lineage.ts";
import {
  type Listing,
  listed,
  mapNarrowed,
  narrowByName,
  type PagedListRequest,
} from "./listFilter.ts";
import { refusedTest } from "./modelChecks.ts";
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
  /**
   * What the model is, in its author's words, or `null` when nobody described it (ADR 0137).
   * Optional and unchecked: `null` is no flag, and a description is a claim, not a test.
   */
  readonly description: string | null;
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
  /**
   * What the saved SQL declares it reads, only when `include` names `dependsOn` (ADR 0137): the
   * model's edges of `models.lineage`. Empty `reads` beside non-empty `undeclared` is a model
   * whose upstream cannot be read, never one that reads nothing.
   */
  readonly dependsOn?: DependsOn;
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
export type ModelInclude = "columns" | "dependsOn";

function facts(model: Model): ModelFacts {
  return {
    name: model.name,
    updatedAt: model.updatedAt,
    updatedBy: model.updatedBy,
    sqlSha256: model.sqlSha256,
    testsSha256: model.testsSha256,
    description: model.description,
  };
}

/** A build with the columns the reader is shown (`columnsShown.ts`), and their count. */
function buildOf(model: Model, built: LastBuild, hidden: readonly string[]): BuildWithColumns {
  const columns = shownColumns(model.columns, hidden);
  return {
    ...built,
    columnCount: model.columns.length === 0 ? null : columns.length,
    columns,
  };
}

function summaryOf(
  model: Model,
  built: LastBuild | undefined,
  tests: TestDetail,
  shown: { readonly columns: boolean; readonly hidden: readonly string[] },
): ModelItem {
  const lastTests = testSummaryOf(tests);
  if (built === undefined) {
    return { ...facts(model), lastBuild: null, lastTests };
  }
  const { columns: found, ...summary } = buildOf(model, built, shown.hidden);
  return {
    ...facts(model),
    lastBuild: shown.columns ? { ...summary, columns: found } : summary,
    lastTests,
  };
}

/**
 * The tenant's models with their last build, narrowed by `filter` and paged by name when asked
 * (`listFilter.ts`). Each says how many columns its build found; which ones only when `include`
 * names `columns`, because 176 models' column lists were most of a list that overflowed its
 * client (issue 444).
 *
 * What each declares it reads only when `include` names `dependsOn`: it is the tenant's whole
 * lineage, read from every model and macro however few models the page holds, so a list that
 * did not ask does not pay for it (ADR 0137).
 */
export async function list(
  exec: SqlExecutor,
  tenantId: string,
  reach: Reach,
  request: PagedListRequest<ModelInclude> = {},
): Promise<Listing<ModelItem>> {
  const [every, builds, tests] = await Promise.all([
    listModels(exec, tenantId),
    lastBuildPerModel(exec, tenantId),
    readTestStates(exec, tenantId),
  ]);
  // Only the models the reader reaches (ADR 0142), narrowed before the name filter, so a name
  // they do not reach is as unknown to `names` as one nobody has.
  const models = every.filter((model) => reachesModel(reach, model.name));
  const columns = request.include?.includes("columns") ?? false;
  const reads =
    request.include?.includes("dependsOn") === true
      ? await dependsOnOf(exec, tenantId, every)
      : null;
  // `listModels` reads them `ORDER BY name`, and a model's name is unique: the page's key.
  return listed(
    mapNarrowed(
      narrowByName(models, (m) => m.name, request),
      (m) => {
        const item = summaryOf(m, builds.get(m.name), tests(m.name), {
          columns,
          hidden: hiddenColumns(reach, m.name),
        });
        const dependsOn = reads?.get(m.name);
        return dependsOn === undefined ? item : { ...item, dependsOn };
      },
    ),
    (item) => item.name,
    request,
  );
}

/** One model in full, or `null` -- for one the reader does not reach as for one nobody saved. */
export async function get(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
  reach: Reach,
): Promise<ModelDetail | null> {
  const model = reachesModel(reach, name) ? await getModel(exec, tenantId, name) : null;
  if (model === null) {
    return null;
  }
  const [builds, tests] = await Promise.all([
    lastBuildPerModel(exec, tenantId),
    readTestStates(exec, tenantId, [name]),
  ]);
  const built = builds.get(name);
  const hidden = hiddenColumns(reach, name);
  return {
    ...facts(model),
    lastBuild: built === undefined ? null : buildOf(model, built, hidden),
    lastTests: tests(name),
    sql: model.sql,
    // Re-validated on the way out rather than asserted: the row's shape is the contract's
    // by construction, and a parse says so where an assertion would only claim it.
    tests: shownTests(ModelTests.parse(model.tests), hidden),
  };
}

export type SaveOutcome =
  | { readonly ok: true; readonly unchanged: boolean }
  | { readonly ok: false; readonly reason: "name-taken" | "seed-named" }
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
 * The description has three answers (ADR 0137): a string sets it, `null` clears it, and
 * leaving it out keeps the one stored -- which is what every caller that never sent one meant.
 *
 * Saving exactly what is already stored is `unchanged`: the row keeps its `updatedAt` and
 * `updatedBy`, and no audit row is written, because nothing took effect (ADR 0113, ADR 0127).
 * The repo decides it in the upsert itself, not by a read first.
 */
export async function save(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    name: string;
    sql: string;
    tests: ModelTests;
    description?: string | null | undefined;
    create: boolean;
    actor: Actor;
    actorId: string;
  },
): Promise<SaveOutcome> {
  if (await seedExists(exec, input.tenantId, input.name)) {
    return { ok: false, reason: "seed-named" };
  }
  const tests = canonicalTests(input.tests);
  const refused = await refusedTest(exec, input.tenantId, input.name, tests);
  if (refused !== null) {
    return { ok: false, reason: "test-refused", finding: refused };
  }
  const model: ModelWrite = {
    name: input.name,
    sql: input.sql,
    tests,
    description: input.description,
    updatedBy: input.actorId,
  };
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
