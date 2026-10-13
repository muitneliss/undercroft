/**
 * `app.seed`: the customer's reference tables, one row per seed. ADR 0128.
 *
 * Shared between the control plane, which saves, lists and deletes them, and the worker, which
 * reads every seed of a tenant to write a build's project directory. Whether a table may be
 * stored at all -- its bounds, and every cell against its column's type -- is decided one layer
 * up (`@undercroft/contracts`, `seeds.ts`); this only reads and writes.
 *
 * A seed's content is its declared columns and its rows, together, so it carries ONE hash: the
 * SHA-256 of `[columns, rows]` as Postgres prints that `jsonb`, computed over what it holds
 * (`CONTENT_HASH`), as `app.model`'s reads do (`models.ts`, ADR 0127). Like a model's tests, it
 * is to be compared with a hash this platform gave before, never with a hash of a local file:
 * `jsonb` prints with its own spacing.
 */

import type { SqlExecutor } from "../executor.ts";
import type { SaveResult } from "./models.ts";
import { SOURCE_OF_TRANSFORM } from "./runs.ts";

export interface SeedColumnJson {
  readonly name: string;
  readonly type: string;
}

/** A seed as a list shows it: what it is, how big, and the hash of what it holds. No cells. */
export interface SeedSummary {
  readonly name: string;
  readonly columnCount: number;
  readonly rowCount: number;
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Hex SHA-256 of the stored `[columns, rows]` as Postgres prints it. */
  readonly sha256: string;
}

/** A seed whole: its summary, its declared columns and every row. */
export interface Seed extends SeedSummary {
  readonly columns: readonly SeedColumnJson[];
  readonly rows: readonly (readonly (string | null)[])[];
}

export interface SeedWrite {
  readonly name: string;
  readonly columns: readonly SeedColumnJson[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly updatedBy: string;
}

interface SummaryRow {
  name: string;
  column_count: number;
  row_count: number;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  sha256: string;
}

interface SeedRow extends SummaryRow {
  columns: SeedColumnJson[];
  rows: (string | null)[][];
}

/** What a save writes, hashed where it is stored: one array, so neither half runs into the other. */
const CONTENT_HASH = `encode(sha256(convert_to(jsonb_build_array(columns, rows)::text, 'UTF8')), 'hex')
  AS sha256`;

const SUMMARY = `name, jsonb_array_length(columns) AS column_count, jsonb_array_length(rows) AS row_count,
  updated_by, created_at, updated_at, ${CONTENT_HASH}`;

function toSummary(r: SummaryRow): SeedSummary {
  return {
    name: r.name,
    columnCount: r.column_count,
    rowCount: r.row_count,
    updatedBy: r.updated_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    sha256: r.sha256,
  };
}

function toSeed(r: SeedRow): Seed {
  return { ...toSummary(r), columns: r.columns, rows: r.rows };
}

/**
 * Every seed of the tenant by name, without a cell: what a list, a revision, a check and the
 * lineage need. The counts and the hash are Postgres's, so no row leaves it to compute them.
 */
export async function listSeedSummaries(
  exec: SqlExecutor,
  tenantId: string,
): Promise<SeedSummary[]> {
  const { rows } = await exec.query<SummaryRow>(
    `SELECT ${SUMMARY} FROM app.seed WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  return rows.map(toSummary);
}

/** Every seed of the tenant whole, by name. The worker renders them all into a build. */
export async function listSeeds(exec: SqlExecutor, tenantId: string): Promise<Seed[]> {
  const { rows } = await exec.query<SeedRow>(
    `SELECT ${SUMMARY}, columns, rows FROM app.seed WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  return rows.map(toSeed);
}

export async function getSeed(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
): Promise<Seed | null> {
  const { rows } = await exec.query<SeedRow>(
    `SELECT ${SUMMARY}, columns, rows FROM app.seed WHERE tenant_id = $1 AND name = $2`,
    [tenantId, name],
  );
  const [row] = rows;
  return row === undefined ? null : toSeed(row);
}

/** Whether the tenant has a seed of this name, reading none of its cells. */
export async function seedExists(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
): Promise<boolean> {
  const { rows } = await exec.query<{ name: string }>(
    "SELECT name FROM app.seed WHERE tenant_id = $1 AND name = $2",
    [tenantId, name],
  );
  return rows.length === 1;
}

/**
 * Create a seed, or report that the name is taken with `false`. Not an upsert, for the reason
 * `insertModel` is not one: a person creating a table over a colleague's has to be told.
 */
export async function insertSeed(
  exec: SqlExecutor,
  tenantId: string,
  seed: SeedWrite,
): Promise<boolean> {
  const { rows } = await exec.query<{ name: string }>(
    `INSERT INTO app.seed (tenant_id, name, columns, rows, updated_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (tenant_id, name) DO NOTHING
     RETURNING name`,
    [tenantId, seed.name, JSON.stringify(seed.columns), JSON.stringify(seed.rows), seed.updatedBy],
  );
  return rows.length === 1;
}

/**
 * Write the seed, creating it if absent: `saveModel`'s deliberate overwrite, and like it
 * `unchanged`, touching nothing, when the columns and rows stored are the ones given -- decided
 * by the upsert's own `WHERE`, comparing `jsonb` by value.
 */
export async function saveSeed(
  exec: SqlExecutor,
  tenantId: string,
  seed: SeedWrite,
): Promise<SaveResult> {
  const { rows } = await exec.query<{ name: string }>(
    `INSERT INTO app.seed AS stored (tenant_id, name, columns, rows, updated_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (tenant_id, name) DO UPDATE SET
       columns = EXCLUDED.columns,
       rows = EXCLUDED.rows,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     WHERE stored.columns IS DISTINCT FROM EXCLUDED.columns
        OR stored.rows IS DISTINCT FROM EXCLUDED.rows
     RETURNING name`,
    [tenantId, seed.name, JSON.stringify(seed.columns), JSON.stringify(seed.rows), seed.updatedBy],
  );
  return rows.length === 1 ? "written" : "unchanged";
}

export type SeedDeleteOutcome = "deleted" | "absent" | "building";

/**
 * Remove the seed, unless a build of the tenant is running: then nothing is removed. One
 * statement for the reason `deleteModelUnlessBuilding` gives: a build that started before the
 * delete loads the seed again after its table was dropped, leaving a table nobody can find.
 */
export async function deleteSeedUnlessBuilding(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
): Promise<SeedDeleteOutcome> {
  const { rows } = await exec.query<{ deleted: boolean; building: boolean }>(
    `WITH building AS (
       SELECT 1 FROM ops.run
       WHERE tenant_id = $1 AND source = $3 AND verb = 'transform' AND status = 'running'
     ), gone AS (
       DELETE FROM app.seed
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
