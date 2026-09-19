/**
 * The customer's dbt models: listed with their last build, read in full, saved, deleted.
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
  deleteModel,
  getModel,
  insertModel,
  type LastBuild,
  lastBuildPerModel,
  listModels,
  type Model,
  saveModel,
} from "@undercroft/db/repos";
import { MACROS, SOURCES_YML } from "@undercroft/db/services";

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

/** What the platform ships into every project, for the editor's reference panel. */
export function reference(): { sourcesYml: string; macros: { name: string; sql: string }[] } {
  return { sourcesYml: SOURCES_YML, macros: MACROS.map((m) => ({ name: m.name, sql: m.sql })) };
}

/** The rows a failed test stored, through the worker; nothing here decides who may look. */
export function dqFailures(
  worker: WorkerClient,
  input: DqFailuresRequest,
): Promise<WorkerOutcome<TableResult>> {
  return worker.dqFailures(input);
}

/** Remove the model. `false` when there was none; the handler decides that is NOT_FOUND. */
export async function remove(
  exec: SqlExecutor,
  input: { tenantId: string; name: string; actor: string },
): Promise<boolean> {
  const removed = await deleteModel(exec, input.tenantId, input.name);
  if (removed) {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "models.delete",
      detail: JSON.stringify({ name: input.name }),
    });
  }
  return removed;
}
