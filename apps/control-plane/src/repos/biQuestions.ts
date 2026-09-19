/**
 * `app.bi_question`: the customer's saved questions, one row each.
 *
 * `definition` and `chart` travel as JSON in and parsed values out; their shapes are the
 * contract's and are validated one layer up, before a row is written and again as a row
 * is read, so a row written by an older contract is refused rather than half-drawn.
 */

import type { SqlExecutor } from "@undercroft/db";

export interface QuestionRow {
  readonly id: string;
  readonly name: string;
  readonly definition: unknown;
  readonly chart: unknown;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Row {
  id: string;
  name: string;
  definition: unknown;
  chart: unknown;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLUMNS = "id, name, definition, chart, created_by, updated_by, created_at, updated_at";

function toRow(r: Row): QuestionRow {
  return {
    id: r.id,
    name: r.name,
    definition: r.definition,
    chart: r.chart,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function listQuestions(exec: SqlExecutor, tenantId: string): Promise<QuestionRow[]> {
  const { rows } = await exec.query<Row>(
    `SELECT ${COLUMNS} FROM app.bi_question WHERE tenant_id = $1 ORDER BY name, id`,
    [tenantId],
  );
  return rows.map(toRow);
}

export async function getQuestion(
  exec: SqlExecutor,
  tenantId: string,
  id: string,
): Promise<QuestionRow | null> {
  const { rows } = await exec.query<Row>(
    `SELECT ${COLUMNS} FROM app.bi_question WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const [row] = rows;
  return row === undefined ? null : toRow(row);
}

export async function insertQuestion(
  exec: SqlExecutor,
  tenantId: string,
  question: { name: string; definition: unknown; chart: unknown; actorId: string },
): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO app.bi_question (tenant_id, name, definition, chart, created_by, updated_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $5)
     RETURNING id`,
    [
      tenantId,
      question.name,
      JSON.stringify(question.definition),
      JSON.stringify(question.chart),
      question.actorId,
    ],
  );
  return rows[0]?.id ?? "";
}

/** `false` when there is no such question of this tenant's to update. */
export async function updateQuestion(
  exec: SqlExecutor,
  tenantId: string,
  question: { id: string; name: string; definition: unknown; chart: unknown; actorId: string },
): Promise<boolean> {
  const { rows } = await exec.query<{ id: string }>(
    `UPDATE app.bi_question
     SET name = $3, definition = $4::jsonb, chart = $5::jsonb, updated_by = $6, updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING id`,
    [
      tenantId,
      question.id,
      question.name,
      JSON.stringify(question.definition),
      JSON.stringify(question.chart),
      question.actorId,
    ],
  );
  return rows.length === 1;
}

export async function deleteQuestion(
  exec: SqlExecutor,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const { rows } = await exec.query<{ id: string }>(
    "DELETE FROM app.bi_question WHERE tenant_id = $1 AND id = $2 RETURNING id",
    [tenantId, id],
  );
  return rows.length === 1;
}
