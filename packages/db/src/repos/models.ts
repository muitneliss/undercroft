/**
 * `app.model`: the customer's dbt models, one row per model.
 *
 * Shared between the control plane, which saves and lists them, and the worker, which reads
 * every model of a tenant to write a build's project directory and records afterwards which
 * columns the built relation has. Neither holds a private copy of the SQL.
 *
 * `tests` and `columns` travel as JSON text in and parsed values out; the shape of `tests`
 * is the contract's (`ModelTests`) and is validated one layer up, before a row is written.
 *
 * Each read carries the SHA-256 of what is stored, computed by Postgres over the bytes it holds
 * (`CONTENT_HASHES`), so "is this the text I have" is answered without the text (ADR 0127).
 *
 * `description` is optional (ADR 0137): `null` is a model nobody described, never a flag.
 */

import type { SqlExecutor } from "../executor.ts";
import { SOURCE_OF_TRANSFORM } from "./runs.ts";

/**
 * One column test as stored: a bare kind (`"not_null"`), or an object naming its kind and its
 * arguments. The contract's `ColumnTest` says which kinds and arguments exist (ADR 0130); this
 * is the structure every reader below the contract can rely on.
 */
export type ColumnTestJson =
  | string
  | {
      readonly kind: string;
      readonly severity?: string | undefined;
      readonly values?: readonly string[] | undefined;
      readonly quote?: boolean | undefined;
      readonly to?: string | undefined;
      readonly field?: string | undefined;
    };

/** A model-level SQL test as stored: a SELECT of the rows that break a rule (ADR 0130). */
export interface SqlTestJson {
  readonly name: string;
  readonly sql: string;
  readonly severity?: string | undefined;
}

export interface ModelTestsJson {
  readonly columns: Record<string, readonly ColumnTestJson[]>;
  /** Absent on every row saved before ADR 0130, and on any model with no SQL tests. */
  readonly sql?: readonly SqlTestJson[] | undefined;
}

export interface Model {
  readonly name: string;
  readonly sql: string;
  readonly tests: ModelTestsJson;
  /** What the model is, in its author's words; `null` when nobody described it (ADR 0137). */
  readonly description: string | null;
  /** What the last successful build found the relation to have. Empty until one has. */
  readonly columns: string[];
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Hex SHA-256 of the stored SQL's UTF-8 bytes: equal to a client's hash of the same text. */
  readonly sqlSha256: string;
  /**
   * Hex SHA-256 of the stored tests as Postgres prints its `jsonb`, which normalises key order
   * and spacing: compare it with a hash this platform gave, never with one of a local file.
   */
  readonly testsSha256: string;
  /** Hex SHA-256 of the stored description's UTF-8 bytes; `null` when there is none. */
  readonly descriptionSha256: string | null;
}

interface ModelRow {
  name: string;
  sql: string;
  tests: ModelTestsJson;
  description: string | null;
  columns: string[];
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  sql_sha256: string;
  tests_sha256: string;
  description_sha256: string | null;
}

/**
 * What a save writes, hashed where it is stored. In SQL rather than in JavaScript so the hash
 * is of the bytes Postgres holds -- for `tests`, its own text of the `jsonb` -- and a match is
 * evidence rather than two programs agreeing about a serialisation. ADR 0127.
 */
const CONTENT_HASHES = `encode(sha256(convert_to(sql, 'UTF8')), 'hex') AS sql_sha256,
  encode(sha256(convert_to(tests::text, 'UTF8')), 'hex') AS tests_sha256,
  encode(sha256(convert_to(description, 'UTF8')), 'hex') AS description_sha256`;

const COLUMNS = `name, sql, tests, description, columns, updated_by, created_at, updated_at,
  ${CONTENT_HASHES}`;

function toModel(r: ModelRow): Model {
  return {
    name: r.name,
    sql: r.sql,
    tests: r.tests,
    description: r.description,
    columns: r.columns,
    updatedBy: r.updated_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    sqlSha256: r.sql_sha256,
    testsSha256: r.tests_sha256,
    descriptionSha256: r.description_sha256,
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

/** What a create or a save writes. */
export interface ModelWrite {
  readonly name: string;
  readonly sql: string;
  readonly tests: ModelTestsJson;
  readonly updatedBy: string;
  /**
   * Three answers, not two (ADR 0137). A string sets it and `null` clears it. Absent writes
   * none on a create and KEEPS the stored one on a save: the CLI, MCP and every caller written
   * before descriptions existed save SQL and tests without one, and a save that read "not sent"
   * as "clear" would erase a description each time somebody fixed a typo in the SQL.
   */
  readonly description?: string | null | undefined;
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
  model: ModelWrite,
): Promise<boolean> {
  const { rows } = await exec.query<{ name: string }>(
    `INSERT INTO app.model (tenant_id, name, sql, tests, description, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (tenant_id, name) DO NOTHING
     RETURNING name`,
    [
      tenantId,
      model.name,
      model.sql,
      JSON.stringify(model.tests),
      model.description ?? null,
      model.updatedBy,
    ],
  );
  return rows.length === 1;
}

/** Whether a save changed the row, or found exactly what it would have written already there. */
export type SaveResult = "written" | "unchanged";

/**
 * Write the model's SQL, tests and -- when the caller said one -- its description, creating it
 * if absent. Executes nothing.
 *
 * A save of what is already stored is `unchanged` and touches nothing -- not `updated_at`, not
 * `updated_by` -- because nothing took effect, and an identical re-save that looked like an edit
 * would tell everyone watching that the model changed (ADR 0127). Decided by the upsert's own
 * `WHERE`, so two saves racing cannot both read "different" and both write. `tests` compares as
 * `jsonb`, by value. A save that said no description (`$7` false) keeps the stored one and is
 * compared on the SQL and tests alone, so it cannot read as a change to a description it never
 * mentioned.
 */
export async function saveModel(
  exec: SqlExecutor,
  tenantId: string,
  model: ModelWrite,
): Promise<SaveResult> {
  const { rows } = await exec.query<{ name: string }>(
    `INSERT INTO app.model AS stored (tenant_id, name, sql, tests, description, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, $6::text, $5)
     ON CONFLICT (tenant_id, name) DO UPDATE SET
       sql = EXCLUDED.sql,
       tests = EXCLUDED.tests,
       description = CASE WHEN $7::boolean THEN EXCLUDED.description ELSE stored.description END,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     WHERE stored.sql IS DISTINCT FROM EXCLUDED.sql
        OR stored.tests IS DISTINCT FROM EXCLUDED.tests
        OR ($7::boolean AND stored.description IS DISTINCT FROM EXCLUDED.description)
     RETURNING name`,
    [
      tenantId,
      model.name,
      model.sql,
      JSON.stringify(model.tests),
      model.updatedBy,
      model.description ?? null,
      model.description !== undefined,
    ],
  );
  return rows.length === 1 ? "written" : "unchanged";
}

/** One model's name and the hashes of what a save writes, for a revision (ADR 0127). */
export interface ModelHashes {
  readonly name: string;
  readonly sqlSha256: string;
  readonly testsSha256: string;
  /** `null` for a model with no description (ADR 0137). */
  readonly descriptionSha256: string | null;
}

/** Every model's hashes, by name, without reading a byte of SQL out of Postgres. */
export async function listModelHashes(exec: SqlExecutor, tenantId: string): Promise<ModelHashes[]> {
  const { rows } = await exec.query<{
    name: string;
    sql_sha256: string;
    tests_sha256: string;
    description_sha256: string | null;
  }>(`SELECT name, ${CONTENT_HASHES} FROM app.model WHERE tenant_id = $1 ORDER BY name`, [
    tenantId,
  ]);
  return rows.map((r) => ({
    name: r.name,
    sqlSha256: r.sql_sha256,
    testsSha256: r.tests_sha256,
    descriptionSha256: r.description_sha256,
  }));
}

export type DeleteOutcome = "deleted" | "absent" | "building";

/**
 * Remove the model, unless a build of the tenant is running: then nothing is removed.
 *
 * One statement, because the guard is only worth anything atomic with the delete. A build
 * reads every model of the tenant when it starts, so a row deleted under a running build
 * leaves that build to re-create the relation the caller has just dropped -- a table nobody
 * can find, which is the defect ADR 0077 closes. Checked in application code, a build could
 * open between the check and the delete. `absent` is a model that was not there to remove;
 * while a build runs the answer is `building` whether or not it was.
 */
export async function deleteModelUnlessBuilding(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
): Promise<DeleteOutcome> {
  const { rows } = await exec.query<{ deleted: boolean; building: boolean }>(
    `WITH building AS (
       SELECT 1 FROM ops.run
       WHERE tenant_id = $1 AND source = $3 AND verb = 'transform' AND status = 'running'
     ), gone AS (
       DELETE FROM app.model
       WHERE tenant_id = $1 AND name = $2 AND NOT EXISTS (SELECT 1 FROM building)
       RETURNING name
     )
     SELECT EXISTS (SELECT 1 FROM gone) AS deleted, EXISTS (SELECT 1 FROM building) AS building`,
    [tenantId, name, SOURCE_OF_TRANSFORM],
  );
  const [row] = rows;
  if (row?.building === true) {
    return "building";
  }
  return row?.deleted === true ? "deleted" : "absent";
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
