/**
 * The customer's dbt models: listed with their last build, read in full, saved, deleted
 * together with what they built.
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
  type BuildModelResponse,
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
  type Lineage,
  MACROS,
  type ModelCheck,
  modelLineage,
  SOURCES_YML,
} from "@undercroft/db/services";

import { record as recordAudit } from "../repos/auditLog.ts";
import type { WorkerClient, WorkerOutcome } from "./workerClient.ts";

export type { LastBuild, Model } from "@undercroft/db/repos";

export interface ModelItem {
  readonly name: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly lastBuild: (LastBuild & { columns: string[] }) | null;
}

export type ModelDetail = ModelItem & { readonly sql: string; readonly tests: ModelTests };

function item(model: Model, built: LastBuild | undefined): ModelItem {
  return {
    name: model.name,
    updatedAt: model.updatedAt,
    updatedBy: model.updatedBy,
    lastBuild: built === undefined ? null : { ...built, columns: model.columns },
  };
}

export async function list(exec: SqlExecutor, tenantId: string): Promise<ModelItem[]> {
  const [models, builds] = await Promise.all([
    listModels(exec, tenantId),
    lastBuildPerModel(exec, tenantId),
  ]);
  return models.map((m) => item(m, builds.get(m.name)));
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
  const builds = await lastBuildPerModel(exec, tenantId);
  return {
    ...item(model, builds.get(name)),
    sql: model.sql,
    // Re-validated on the way out rather than asserted: the row's shape is the contract's
    // by construction, and a parse says so where an assertion would only claim it.
    tests: ModelTests.parse(model.tests),
  };
}

export type SaveOutcome = { ok: true } | { ok: false; reason: "name-taken" };

/**
 * Store the model. With `create`, a name already in use is refused and nothing is written.
 */
export async function save(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    name: string;
    sql: string;
    tests: ModelTests;
    create: boolean;
    actor: string;
    actorId: string;
  },
): Promise<SaveOutcome> {
  const model = { name: input.name, sql: input.sql, tests: input.tests, updatedBy: input.actorId };
  if (input.create) {
    const created = await insertModel(exec, input.tenantId, model);
    if (!created) {
      return { ok: false, reason: "name-taken" };
    }
  } else {
    await saveModel(exec, input.tenantId, model);
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "models.save",
    detail: JSON.stringify({ name: input.name, created: input.create }),
  });
  return { ok: true };
}

/**
 * Build one model through the worker and wait: the editor is looking. The audit row names
 * the model and the run; the run itself is in the ledger, where the journal reads it.
 */
export async function build(
  exec: SqlExecutor,
  worker: WorkerClient,
  input: { tenantId: string; name: string; actor: string; actorId: string },
): Promise<WorkerOutcome<BuildModelResponse>> {
  const outcome = await worker.buildModel({
    tenantId: input.tenantId,
    model: input.name,
    triggeredBy: input.actorId,
  });
  if (outcome.ok) {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "models.build",
      detail: JSON.stringify({
        name: input.name,
        runId: outcome.value.runId,
        ok: outcome.value.ok,
      }),
    });
  }
  return outcome;
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
 */
export async function lineage(exec: SqlExecutor, tenantId: string): Promise<Lineage> {
  const [models, macros] = await Promise.all([
    listModels(exec, tenantId),
    listMacros(exec, tenantId),
  ]);
  return modelLineage({ models, macros });
}

export interface Reference {
  readonly sourcesYml: string;
  /** What the platform ships into every project. */
  readonly macros: { name: string; sql: string }[];
  /** The tenant's own macros, which any of its models may call too (ADR 0086). */
  readonly tenantMacros: { name: string; description: string; sql: string }[];
}

/** What a model of this tenant can read and call, for the editor's reference panel. */
export async function reference(exec: SqlExecutor, tenantId: string): Promise<Reference> {
  const tenantMacros = await listMacros(exec, tenantId);
  return {
    sourcesYml: SOURCES_YML,
    macros: MACROS.map((m) => ({ name: m.name, sql: m.sql })),
    tenantMacros: tenantMacros.map((m) => ({
      name: m.name,
      description: m.description,
      sql: m.sql,
    })),
  };
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
  input: { tenantId: string; name: string; actor: string },
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
