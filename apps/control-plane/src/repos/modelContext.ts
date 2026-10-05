/**
 * `app.model_context`: each model's approved business context, one row per model. ADR 0104.
 *
 * `body` and `reviewed` travel as JSON in and as untyped values out: their shapes are the
 * contract's `ModelContext` and the service's fingerprint, validated one layer up as a row is
 * read, so a row an older shape wrote is refused there rather than half-drawn. No state is
 * stored here, by design (`460_model_context.sql`).
 */

import type { SqlExecutor } from "@undercroft/db";

export interface ModelContextRow {
  readonly modelName: string;
  readonly body: unknown;
  readonly reviewed: unknown;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
}

interface Row {
  model_name: string;
  body: unknown;
  reviewed: unknown;
  reviewed_by: string;
  reviewed_at: Date | string;
}

/** Every approved context of the tenant, by model name. */
export async function listModelContexts(
  exec: SqlExecutor,
  tenantId: string,
): Promise<ModelContextRow[]> {
  const { rows } = await exec.query<Row>(
    `SELECT model_name, body, reviewed, reviewed_by, reviewed_at
     FROM app.model_context WHERE tenant_id = $1 ORDER BY model_name`,
    [tenantId],
  );
  return rows.map((r) => ({
    modelName: r.model_name,
    body: r.body,
    reviewed: r.reviewed,
    reviewedBy: r.reviewed_by,
    reviewedAt: new Date(r.reviewed_at).toISOString(),
  }));
}

/**
 * Store the model's context and what it was approved against, replacing any before it.
 *
 * `false` when the model is not there: the row is selected FROM `app.model`, so "does the
 * model exist" and the write are one statement, and a model deleted a moment earlier gets no
 * orphan description (which the foreign key would refuse with an error instead of an answer).
 */
export async function upsertModelContext(
  exec: SqlExecutor,
  tenantId: string,
  row: { modelName: string; body: unknown; reviewed: unknown; reviewedBy: string },
): Promise<boolean> {
  const { rows } = await exec.query<{ model_name: string }>(
    `INSERT INTO app.model_context (tenant_id, model_name, body, reviewed, reviewed_by)
     SELECT m.tenant_id, m.name, $3::jsonb, $4::jsonb, $5
     FROM app.model m WHERE m.tenant_id = $1 AND m.name = $2
     ON CONFLICT (tenant_id, model_name) DO UPDATE SET
       body = EXCLUDED.body,
       reviewed = EXCLUDED.reviewed,
       reviewed_by = EXCLUDED.reviewed_by,
       reviewed_at = now()
     RETURNING model_name`,
    [
      tenantId,
      row.modelName,
      JSON.stringify(row.body),
      JSON.stringify(row.reviewed),
      row.reviewedBy,
    ],
  );
  return rows.length === 1;
}
