/**
 * `app.bi_dashboard`: the customer's dashboards, one row each -- a grid of questions and
 * the shared filters bound into them. Shapes are the contract's, validated one layer up.
 */

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

import type { SqlExecutor } from "@undercroft/db";

export interface DashboardRow {
  readonly id: string;
  readonly name: string;
  readonly layout: unknown;
  readonly filters: unknown;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Row {
  id: string;
  name: string;
  layout: unknown;
  filters: unknown;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLUMNS = "id, name, layout, filters, created_by, updated_by, created_at, updated_at";

function toRow(r: Row): DashboardRow {
  return {
    id: r.id,
    name: r.name,
    layout: r.layout,
    filters: r.filters,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function listDashboards(exec: SqlExecutor, tenantId: string): Promise<DashboardRow[]> {
  const { rows } = await exec.query<Row>(
    `SELECT ${COLUMNS} FROM app.bi_dashboard WHERE tenant_id = $1 ORDER BY name, id`,
    [tenantId],
  );
  return rows.map(toRow);
}

export async function getDashboard(
  exec: SqlExecutor,
  tenantId: string,
  id: string,
): Promise<DashboardRow | null> {
  const { rows } = await exec.query<Row>(
    `SELECT ${COLUMNS} FROM app.bi_dashboard WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const [row] = rows;
  return row === undefined ? null : toRow(row);
}

export async function insertDashboard(
  exec: SqlExecutor,
  tenantId: string,
  dashboard: { name: string; layout: unknown; filters: unknown; actorId: string },
): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO app.bi_dashboard (tenant_id, name, layout, filters, created_by, updated_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $5)
     RETURNING id`,
    [
      tenantId,
      dashboard.name,
      JSON.stringify(dashboard.layout),
      JSON.stringify(dashboard.filters),
      dashboard.actorId,
    ],
  );
  return rows[0]?.id ?? "";
}

export async function updateDashboard(
  exec: SqlExecutor,
  tenantId: string,
  dashboard: { id: string; name: string; layout: unknown; filters: unknown; actorId: string },
): Promise<boolean> {
  const { rows } = await exec.query<{ id: string }>(
    `UPDATE app.bi_dashboard
     SET name = $3, layout = $4::jsonb, filters = $5::jsonb, updated_by = $6, updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING id`,
    [
      tenantId,
      dashboard.id,
      dashboard.name,
      JSON.stringify(dashboard.layout),
      JSON.stringify(dashboard.filters),
      dashboard.actorId,
    ],
  );
  return rows.length === 1;
}

export async function deleteDashboard(
  exec: SqlExecutor,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const { rows } = await exec.query<{ id: string }>(
    "DELETE FROM app.bi_dashboard WHERE tenant_id = $1 AND id = $2 RETURNING id",
    [tenantId, id],
  );
  return rows.length === 1;
}
