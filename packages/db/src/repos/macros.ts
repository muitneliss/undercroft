/**
 * `app.macro`: the customer's own dbt macros, one row per macro. ADR 0086.
 *
 * Shared between the control plane, which saves, lists and deletes them, and the worker, which
 * reads every macro of a tenant to write a build's project directory. Whether a definition may
 * be stored at all is decided one layer up (`macroDefinition.ts`); this only reads and writes.
 */

import type { SqlExecutor } from "../executor.ts";

export interface Macro {
  readonly name: string;
  readonly description: string;
  readonly sql: string;
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface MacroRow {
  name: string;
  description: string;
  sql: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface MacroWrite {
  readonly name: string;
  readonly description: string;
  readonly sql: string;
  readonly updatedBy: string;
}

const COLUMNS = "name, description, sql, updated_by, created_at, updated_at";

function toMacro(r: MacroRow): Macro {
  return {
    name: r.name,
    description: r.description,
    sql: r.sql,
    updatedBy: r.updated_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** Every macro of the tenant, by name. The worker renders them all; an agent lists them. */
export async function listMacros(exec: SqlExecutor, tenantId: string): Promise<Macro[]> {
  const { rows } = await exec.query<MacroRow>(
    `SELECT ${COLUMNS} FROM app.macro WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  return rows.map(toMacro);
}

export async function getMacro(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
): Promise<Macro | null> {
  const { rows } = await exec.query<MacroRow>(
    `SELECT ${COLUMNS} FROM app.macro WHERE tenant_id = $1 AND name = $2`,
    [tenantId, name],
  );
  const [row] = rows;
  return row === undefined ? null : toMacro(row);
}

/**
 * Create a macro, or report that the name is taken with `false`. Not an upsert, for the reason
 * `insertModel` is not one: a person creating a macro over a colleague's has to be told.
 */
export async function insertMacro(
  exec: SqlExecutor,
  tenantId: string,
  macro: MacroWrite,
): Promise<boolean> {
  const { rows } = await exec.query<{ name: string }>(
    `INSERT INTO app.macro (tenant_id, name, description, sql, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, name) DO NOTHING
     RETURNING name`,
    [tenantId, macro.name, macro.description, macro.sql, macro.updatedBy],
  );
  return rows.length === 1;
}

/** Write the macro, creating it if absent. `saveModel`'s deliberate overwrite. */
export async function saveMacro(
  exec: SqlExecutor,
  tenantId: string,
  macro: MacroWrite,
): Promise<void> {
  await exec.query(
    `INSERT INTO app.macro (tenant_id, name, description, sql, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, name) DO UPDATE SET
       description = EXCLUDED.description,
       sql = EXCLUDED.sql,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [tenantId, macro.name, macro.description, macro.sql, macro.updatedBy],
  );
}

/** Remove the macro; `false` when there was none to remove. */
export async function deleteMacro(
  exec: SqlExecutor,
  tenantId: string,
  name: string,
): Promise<boolean> {
  const { rows } = await exec.query<{ name: string }>(
    "DELETE FROM app.macro WHERE tenant_id = $1 AND name = $2 RETURNING name",
    [tenantId, name],
  );
  return rows.length === 1;
}
