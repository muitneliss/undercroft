/**
 * `app.bi_question`: the customer's saved questions, one row each.
 *
 * `definition` and `chart` travel as JSON in and parsed values out; their shapes are the
 * contract's and are validated one layer up, before a row is written and again as a row
 * is read, so a row written by an older contract is refused rather than half-drawn.
 */

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

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
