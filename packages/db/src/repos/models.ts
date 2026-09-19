/**
 * `app.model`: the customer's dbt models, one row per model.
 *
 * Shared between the control plane, which saves and lists them, and the worker, which reads
 * every model of a tenant to write a build's project directory and records afterwards which
 * columns the built relation has. Neither holds a private copy of the SQL.
 *
 * `tests` and `columns` travel as JSON text in and parsed values out; the shape of `tests`
 * is the contract's (`ModelTests`) and is validated one layer up, before a row is written.
 */

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

import type { SqlExecutor } from "../executor.ts";

export interface ModelTestsJson {
  readonly columns: Record<string, readonly string[]>;
}

export interface Model {
  readonly name: string;
  readonly sql: string;
  readonly tests: ModelTestsJson;
  /** What the last successful build found the relation to have. Empty until one has. */
  readonly columns: string[];
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ModelRow {
  name: string;
  sql: string;
  tests: ModelTestsJson;
  columns: string[];
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLUMNS = "name, sql, tests, columns, updated_by, created_at, updated_at";

function toModel(r: ModelRow): Model {
  return {
    name: r.name,
    sql: r.sql,
    tests: r.tests,
    columns: r.columns,
    updatedBy: r.updated_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** Every model of the tenant, by name. The worker writes them all; the editor lists them. */
export async function listModels(exec: SqlExecutor, tenantId: string): Promise<Model[]> {
  const { rows } = await exec.query<ModelRow>(
    `SELECT ${COLUMNS} FROM app.model WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  return rows.map(toModel);
}

export async function getModel(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
): Promise<Model | null> {
  const { rows } = await exec.query<ModelRow>(
    `SELECT ${COLUMNS} FROM app.model WHERE tenant_id = $1 AND name = $2`,
    [tenantId, name],
  );
  const [row] = rows;
  return row === undefined ? null : toModel(row);
}

/**
 * Create a model, or report that the name is taken.
 *
 * `false` for an existing name rather than an upsert: a person creating "stg_deals" over a
 * colleague's "stg_deals" has to be TOLD, or they believe they wrote a model they in fact
 * replaced. `saveModel` is the deliberate overwrite.
 */
export async function insertModel(
  exec: SqlExecutor,
  tenantId: string,
  model: { name: string; sql: string; tests: ModelTestsJson; updatedBy: string },
): Promise<boolean> {
  const { rows } = await exec.query<{ name: string }>(
    `INSERT INTO app.model (tenant_id, name, sql, tests, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (tenant_id, name) DO NOTHING
     RETURNING name`,
    [tenantId, model.name, model.sql, JSON.stringify(model.tests), model.updatedBy],
  );
  return rows.length === 1;
}

/** Write the model's SQL and tests, creating it if absent. Executes nothing. */
export async function saveModel(
  exec: SqlExecutor,
  tenantId: string,
  model: { name: string; sql: string; tests: ModelTestsJson; updatedBy: string },
): Promise<void> {
  await exec.query(
    `INSERT INTO app.model (tenant_id, name, sql, tests, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (tenant_id, name) DO UPDATE SET
       sql = EXCLUDED.sql,
       tests = EXCLUDED.tests,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [tenantId, model.name, model.sql, JSON.stringify(model.tests), model.updatedBy],
  );
}

/** Remove the model. `false` when there was none to remove. */
export async function deleteModel(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
): Promise<boolean> {
  const { rows } = await exec.query<{ name: string }>(
    "DELETE FROM app.model WHERE tenant_id = $1 AND name = $2 RETURNING name",
    [tenantId, name],
  );
  return rows.length === 1;
}

/** Record what a build found the model's relation to have. The one column the worker writes. */
export async function setModelColumns(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
  columns: readonly string[],
): Promise<void> {
  await exec.query("UPDATE app.model SET columns = $3::jsonb WHERE tenant_id = $1 AND name = $2", [
    tenantId,
    name,
    JSON.stringify(columns),
  ]);
}

export interface LastBuild {
  readonly runId: string;
  readonly status: string;
  readonly endedAt: string | null;
}

/**
 * The newest transform step per model name, for a tenant, in one statement.
 *
 * A step is dbt's own record of one node; its `name` is the model name. The newest by the
 * run's start is the one the editor shows beside the model, whatever the run's trigger.
 */
export async function lastBuildPerModel(
  exec: SqlExecutor,
  tenantId: string,
): Promise<Map<string, LastBuild>> {
  const { rows } = await exec.query<{
    name: string;
    run_id: string;
    status: string;
    ended_at: Date | string | null;
  }>(
    `SELECT DISTINCT ON (s.name) s.name, s.run_id, s.status, r.ended_at
     FROM ops.run_step s JOIN ops.run r ON r.id = s.run_id
     WHERE r.tenant_id = $1 AND r.verb = 'transform' AND s.kind = 'model'
     ORDER BY s.name, r.started_at DESC, r.id DESC`,
    [tenantId],
  );
  const byName = new Map<string, LastBuild>();
  for (const r of rows) {
    byName.set(r.name, {
      runId: r.run_id,
      status: r.status,
      endedAt: r.ended_at === null ? null : new Date(r.ended_at).toISOString(),
    });
  }
  return byName;
}
