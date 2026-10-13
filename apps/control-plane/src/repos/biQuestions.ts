/**
 * `app.bi_question`: the customer's saved questions, one row each.
 *
 * `definition` and `chart` travel as JSON in and parsed values out; their shapes are the
 * contract's and are validated one layer up, before a row is written and again as a row
 * is read, so a row written by an older contract is refused rather than half-drawn.
 *
 * Each read carries the SHA-256 of `definition` and `chart` as Postgres prints the stored
 * `jsonb` -- the bytes it holds, normalised by Postgres and by nothing else -- so a client can
 * tell whether its copy is current by comparing with a hash the platform gave (ADR 0127).
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
  readonly definitionSha256: string;
  readonly chartSha256: string;
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
  definition_sha256: string;
  chart_sha256: string;
}

/**
 * Hashed in SQL over Postgres's own text of the `jsonb`, not over a JavaScript serialisation of
 * the parsed value: `JSON.stringify` neither orders keys nor keeps a number as written, so two
 * programs would disagree about one definition. ADR 0127.
 */
const CONTENT_HASHES = `encode(sha256(convert_to(definition::text, 'UTF8')), 'hex') AS definition_sha256,
  encode(sha256(convert_to(chart::text, 'UTF8')), 'hex') AS chart_sha256`;

const COLUMNS = `id, name, definition, chart, created_by, updated_by, created_at, updated_at,
  ${CONTENT_HASHES}`;

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
    definitionSha256: r.definition_sha256,
    chartSha256: r.chart_sha256,
  };
}

export async function listQuestions(exec: SqlExecutor, tenantId: string): Promise<QuestionRow[]> {
  const { rows } = await exec.query<Row>(
    `SELECT ${COLUMNS} FROM app.bi_question WHERE tenant_id = $1 ORDER BY name, id`,
    [tenantId],
  );
  return rows.map(toRow);
}

/** One question's id, name and the hashes of what a save writes, for a revision (ADR 0127). */
export interface QuestionHashes {
  readonly id: string;
  readonly name: string;
  readonly definitionSha256: string;
  readonly chartSha256: string;
}

/** Every question's hashes, by id, without reading a definition out of Postgres. */
export async function listQuestionHashes(
  exec: SqlExecutor,
  tenantId: string,
): Promise<QuestionHashes[]> {
  const { rows } = await exec.query<{
    id: string;
    name: string;
    definition_sha256: string;
    chart_sha256: string;
  }>(`SELECT id, name, ${CONTENT_HASHES} FROM app.bi_question WHERE tenant_id = $1 ORDER BY id`, [
    tenantId,
  ]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    definitionSha256: r.definition_sha256,
    chartSha256: r.chart_sha256,
  }));
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
