/**
 * `app.bi_export`: the exports people asked for and have not downloaded yet (ADR 0111).
 *
 * A row is found only by the person who asked for it, in the tenant it was asked in, before it
 * expires -- all three in the WHERE, so no caller can forget one of them. Expired rows are swept
 * by the next insert rather than by a job: the table only ever holds a few minutes of asking.
 */

import type { SqlExecutor } from "@undercroft/db";

export type ExportKind = "question" | "definition" | "model";

export interface ExportRow {
  readonly id: string;
  readonly kind: ExportKind;
  readonly sql: string;
  readonly fileName: string;
  readonly expiresAt: string;
  /** The models its asker reached when they asked; `null` for every model (ADR 0142). */
  readonly scopeModels: readonly string[] | null;
}

interface Row {
  id: string;
  kind: ExportKind;
  sql: string;
  file_name: string;
  expires_at: Date | string;
  scope_models: string[] | null;
}

function toRow(r: Row): ExportRow {
  return {
    id: r.id,
    kind: r.kind,
    sql: r.sql,
    fileName: r.file_name,
    expiresAt: new Date(r.expires_at).toISOString(),
    scopeModels: r.scope_models,
  };
}

/** Store an export, good for `minutes` by the database's clock, after sweeping the expired. */
export async function insertExport(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    userId: string;
    kind: ExportKind;
    scopeModels: readonly string[] | null;
    sql: string;
    fileName: string;
    minutes: number;
  },
): Promise<ExportRow> {
  await exec.query("DELETE FROM app.bi_export WHERE expires_at <= now()");
  const { rows } = await exec.query<Row>(
    `INSERT INTO app.bi_export (tenant_id, user_id, kind, sql, file_name, expires_at, scope_models)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6::int), $7::text[])
     RETURNING id, kind, sql, file_name, expires_at, scope_models`,
    [
      input.tenantId,
      input.userId,
      input.kind,
      input.sql,
      input.fileName,
      input.minutes,
      input.scopeModels === null ? null : [...input.scopeModels],
    ],
  );
  const [row] = rows;
  if (row === undefined) {
    throw new Error("INSERT ... RETURNING answered no row");
  }
  return toRow(row);
}

/** The export `userId` asked for in `tenantId`, while it lives; `null` for any other. */
export async function findLiveExport(
  exec: SqlExecutor,
  input: { tenantId: string; id: string; userId: string },
): Promise<ExportRow | null> {
  const { rows } = await exec.query<Row>(
    `SELECT id, kind, sql, file_name, expires_at, scope_models FROM app.bi_export
     WHERE tenant_id = $1 AND id = $2 AND user_id = $3 AND expires_at > now()`,
    [input.tenantId, input.id, input.userId],
  );
  const [row] = rows;
  return row === undefined ? null : toRow(row);
}
