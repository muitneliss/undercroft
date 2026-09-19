/**
 * `ops.run` and the three tables under it: the one ledger of what the worker did.
 *
 * In `@undercroft/db` rather than in either app, because both read it and only one writes
 * it: the worker opens and closes every run and records what it refused; the control plane
 * lists and shows them. A private copy of these statements in each app is how the card and
 * the ledger drift apart about what a run is.
 *
 * Every function returns rows or a tagged value. `openRun` is the one that decides
 * anything, and what it decides is written in SQL: the partial unique index
 * `run_one_running` refuses a second running run for the same (tenant, source, verb), and
 * this repo only turns that refusal into a value a caller can name.
 *
 * Counts are numbers, not amounts: `integer` columns, and the money rule does not apply.
 */

// biome-ignore-all lint/style/noExcessiveLinesPerFile: One ledger, one repo. `ops.run` and the three tables under it are opened, written and read together, and a reader asking "what does the ledger hold" should find every statement in one file rather than four files that agree by convention.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useDestructuring: Style preference with no correctness content, and it fires where the current form names the source of the value (`items.at(-1)`), which is the thing worth seeing at the call site.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

import type { SqlExecutor } from "../executor.ts";

export type RunStatus = "running" | "ok" | "failed";
export type RunVerb = "ingest" | "transform";
export type RunTrigger = "schedule" | "manual" | "build" | "lake-api";

export interface Run {
  readonly id: string;
  readonly tenantId: string;
  /** The source for an ingest; `*` for a transform, which is per tenant. */
  readonly source: string;
  readonly verb: RunVerb;
  readonly trigger: RunTrigger;
  /** An `app_user` uuid, or `""` for the scheduler. Never an address: BI reads this table. */
  readonly triggeredBy: string;
  readonly parentRunId: string | null;
  readonly status: RunStatus;
  readonly created: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly refused: number;
  readonly testsFailed: number | null;
  /** A `ConnectorError`'s message -- counts and detail, never a row -- at most 500 chars. */
  readonly error: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface RunEntity {
  readonly entity: string;
  readonly landed: number;
  readonly created: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly refused: number;
}

export interface RunRefusal {
  readonly entity: string;
  readonly sourceRecordId: string;
  readonly reason: string;
}

export interface RunStep {
  readonly uniqueId: string;
  readonly kind: "model" | "test";
  readonly name: string;
  readonly status: string;
  readonly failures: number | null;
  readonly relation: string | null;
  readonly message: string | null;
  readonly executionMs: number | null;
}

/** The longest error text a run keeps. Enough to name the fault, too short to hold a row. */
export const MAX_ERROR_CHARS = 500;

const SOURCE_OF_TRANSFORM = "*";
export { SOURCE_OF_TRANSFORM };

export type OpenOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "in-progress"; readonly runId: string };

/**
 * Open a run, or learn which run is already in progress for the same pair.
 *
 * The refusal comes from `run_one_running`, not from a read-then-insert: two callers that
 * both read "nothing running" and both insert would both succeed, and the index is what
 * makes the second one lose.
 */
export async function openRun(
  exec: SqlExecutor,
  input: {
    id: string;
    tenantId: string;
    source: string;
    verb: RunVerb;
    trigger: RunTrigger;
    triggeredBy?: string;
    parentRunId?: string | null;
  },
): Promise<OpenOutcome> {
  try {
    await exec.query(
      `INSERT INTO ops.run (id, tenant_id, source, verb, trigger, triggered_by, parent_run_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.id,
        input.tenantId,
        input.source,
        input.verb,
        input.trigger,
        input.triggeredBy ?? "",
        input.parentRunId ?? null,
      ],
    );
    return { ok: true };
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("run_one_running"))) {
      throw error;
    }
    const { rows } = await exec.query<{ id: string }>(
      `SELECT id FROM ops.run
       WHERE tenant_id = $1 AND source = $2 AND verb = $3 AND status = 'running'`,
      [input.tenantId, input.source, input.verb],
    );
    return { ok: false, reason: "in-progress", runId: rows[0]?.id ?? "" };
  }
}

export async function closeRun(
  exec: SqlExecutor,
  id: string,
  outcome: {
    status: "ok" | "failed";
    created?: number;
    changed?: number;
    unchanged?: number;
    refused?: number;
    testsFailed?: number | null;
    error?: string | null;
  },
): Promise<void> {
  await exec.query(
    `UPDATE ops.run
     SET status = $2, created = $3, changed = $4, unchanged = $5, refused = $6,
         tests_failed = $7, error = $8, ended_at = now()
     WHERE id = $1`,
    [
      id,
      outcome.status,
      outcome.created ?? 0,
      outcome.changed ?? 0,
      outcome.unchanged ?? 0,
      outcome.refused ?? 0,
      outcome.testsFailed ?? null,
      outcome.error === undefined || outcome.error === null
        ? null
        : outcome.error.slice(0, MAX_ERROR_CHARS),
    ],
  );
}

/**
 * Record what one run did per entity. JSON in, rows out: one statement whatever the count,
 * and the same parameter shape under `pg` and PGlite.
 */
export async function recordEntities(
  exec: SqlExecutor,
  runId: string,
  entities: readonly RunEntity[],
): Promise<void> {
  if (entities.length === 0) {
    return;
  }
  await exec.query(
    `INSERT INTO ops.run_entity (run_id, entity, landed, created, changed, unchanged, refused)
     SELECT $1, e->>'entity', (e->>'landed')::int, (e->>'created')::int, (e->>'changed')::int,
            (e->>'unchanged')::int, (e->>'refused')::int
     FROM jsonb_array_elements($2::jsonb) AS e
     ON CONFLICT (run_id, entity) DO UPDATE SET
       landed = ops.run_entity.landed + EXCLUDED.landed,
       created = ops.run_entity.created + EXCLUDED.created,
       changed = ops.run_entity.changed + EXCLUDED.changed,
       unchanged = ops.run_entity.unchanged + EXCLUDED.unchanged,
       refused = ops.run_entity.refused + EXCLUDED.refused`,
    [runId, JSON.stringify(entities)],
  );
}

export async function recordRefusals(
  exec: SqlExecutor,
  runId: string,
  refusals: readonly RunRefusal[],
): Promise<void> {
  if (refusals.length === 0) {
    return;
  }
  await exec.query(
    `INSERT INTO ops.run_refusal (run_id, entity, source_record_id, reason)
     SELECT $1, r->>'entity', r->>'sourceRecordId', left(r->>'reason', $3)
     FROM jsonb_array_elements($2::jsonb) AS r`,
    [runId, JSON.stringify(refusals), MAX_ERROR_CHARS],
  );
}

export async function recordSteps(
  exec: SqlExecutor,
  runId: string,
  steps: readonly RunStep[],
): Promise<void> {
  if (steps.length === 0) {
    return;
  }
  await exec.query(
    `INSERT INTO ops.run_step
       (run_id, unique_id, kind, name, status, failures, relation, message, execution_ms)
     SELECT $1, s->>'uniqueId', s->>'kind', s->>'name', s->>'status',
            (s->>'failures')::int, s->>'relation', left(s->>'message', $3), (s->>'executionMs')::int
     FROM jsonb_array_elements($2::jsonb) AS s
     ON CONFLICT (run_id, unique_id) DO UPDATE SET
       status = EXCLUDED.status, failures = EXCLUDED.failures, relation = EXCLUDED.relation,
       message = EXCLUDED.message, execution_ms = EXCLUDED.execution_ms`,
    [runId, JSON.stringify(steps), MAX_ERROR_CHARS],
  );
}

/**
 * Claim a run id for an external caller of the lake API, or refuse it.
 *
 * A script posts batches under a run id of its own choosing, possibly several. The first
 * batch creates the row; later ones add to it. What must not happen is one caller's run id
 * landing on another tenant's row, so the claim answers `false` when the id exists for a
 * different (tenant, source) and the handler refuses before anything is landed.
 */
export async function claimExternalRun(
  exec: SqlExecutor,
  input: { id: string; tenantId: string; source: string },
): Promise<boolean> {
  await exec.query(
    `INSERT INTO ops.run (id, tenant_id, source, verb, trigger, status)
     VALUES ($1, $2, $3, 'ingest', 'lake-api', 'ok')
     ON CONFLICT (id) DO NOTHING`,
    [input.id, input.tenantId, input.source],
  );
  const { rows } = await exec.query<{ ok: boolean }>(
    "SELECT tenant_id = $2 AND source = $3 AS ok FROM ops.run WHERE id = $1",
    [input.id, input.tenantId, input.source],
  );
  return rows[0]?.ok === true;
}

/** Add one landed batch to an external run. The run's status follows its worst batch. */
export async function recordExternalBatch(
  exec: SqlExecutor,
  id: string,
  batch: { created: number; unchanged: number; refused: number },
): Promise<void> {
  await exec.query(
    `UPDATE ops.run
     SET created = created + $2, unchanged = unchanged + $3, refused = refused + $4,
         status = CASE WHEN $4 > 0 OR status = 'failed' THEN 'failed' ELSE 'ok' END,
         ended_at = now()
     WHERE id = $1`,
    [id, batch.created, batch.unchanged, batch.refused],
  );
}

/**
 * Every run still marked running is one the worker was in the middle of when it stopped.
 * Called once at boot: a row that stayed `running` forever would hold `run_one_running`
 * against every later run of the same pair.
 */
export async function closeAbandoned(exec: SqlExecutor, error: string): Promise<string[]> {
  const { rows } = await exec.query<{ id: string }>(
    `UPDATE ops.run SET status = 'failed', error = $1, ended_at = now()
     WHERE status = 'running' RETURNING id`,
    [error.slice(0, MAX_ERROR_CHARS)],
  );
  return rows.map((r) => r.id);
}

interface RunRow {
  id: string;
  tenant_id: string;
  source: string;
  verb: RunVerb;
  trigger: RunTrigger;
  triggered_by: string;
  parent_run_id: string | null;
  status: RunStatus;
  created: number;
  changed: number;
  unchanged: number;
  refused: number;
  tests_failed: number | null;
  error: string | null;
  started_at: Date | string;
  ended_at: Date | string | null;
}

const RUN_COLUMNS = `id, tenant_id, source, verb, trigger, triggered_by, parent_run_id, status,
  created, changed, unchanged, refused, tests_failed, error, started_at, ended_at`;

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    source: row.source,
    verb: row.verb,
    trigger: row.trigger,
    triggeredBy: row.triggered_by,
    parentRunId: row.parent_run_id,
    status: row.status,
    created: row.created,
    changed: row.changed,
    unchanged: row.unchanged,
    refused: row.refused,
    testsFailed: row.tests_failed,
    error: row.error,
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: row.ended_at === null ? null : new Date(row.ended_at).toISOString(),
  };
}

export async function getRun(exec: SqlExecutor, tenantId: string, id: string): Promise<Run | null> {
  const { rows } = await exec.query<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM ops.run WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const row = rows[0];
  return row === undefined ? null : toRun(row);
}

/**
 * A page of runs, newest first, keyed by an opaque cursor.
 *
 * The cursor is `startedAt|id` in base64url: the pair the index is ordered by, so a page
 * boundary is exact even when two runs share a start instant. Opaque to the caller, which
 * only ever hands it back.
 */
export async function listRuns(
  exec: SqlExecutor,
  tenantId: string,
  page: { limit: number; cursor?: string | null },
): Promise<{ items: Run[]; nextCursor: string | null }> {
  const after = decodeCursor(page.cursor ?? null);
  const { rows } = await exec.query<RunRow>(
    after === null
      ? `SELECT ${RUN_COLUMNS} FROM ops.run WHERE tenant_id = $1
         ORDER BY started_at DESC, id DESC LIMIT $2`
      : `SELECT ${RUN_COLUMNS} FROM ops.run
         WHERE tenant_id = $1 AND (started_at, id) < ($3::timestamptz, $4)
         ORDER BY started_at DESC, id DESC LIMIT $2`,
    after === null
      ? [tenantId, page.limit + 1]
      : [tenantId, page.limit + 1, after.startedAt, after.id],
  );
  const items = rows.slice(0, page.limit).map(toRun);
  const last = items.at(-1);
  const nextCursor =
    rows.length > page.limit && last !== undefined ? encodeCursor(last.startedAt, last.id) : null;
  return { items, nextCursor };
}

export function encodeCursor(startedAt: string, id: string): string {
  return Buffer.from(`${startedAt}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null): { startedAt: string; id: string } | null {
  if (cursor === null || cursor === "") {
    return null;
  }
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const split = text.indexOf("|");
  if (split <= 0) {
    return null;
  }
  return { startedAt: text.slice(0, split), id: text.slice(split + 1) };
}

/** The entity names per run, for a page of runs, in one statement. */
export async function entitiesForRuns(
  exec: SqlExecutor,
  runIds: readonly string[],
): Promise<Map<string, RunEntity[]>> {
  const byRun = new Map<string, RunEntity[]>();
  if (runIds.length === 0) {
    return byRun;
  }
  const { rows } = await exec.query<{
    run_id: string;
    entity: string;
    landed: number;
    created: number;
    changed: number;
    unchanged: number;
    refused: number;
  }>(
    `SELECT run_id, entity, landed, created, changed, unchanged, refused
     FROM ops.run_entity
     WHERE run_id IN (SELECT jsonb_array_elements_text($1::jsonb))
     ORDER BY run_id, entity`,
    [JSON.stringify(runIds)],
  );
  for (const row of rows) {
    const list = byRun.get(row.run_id) ?? [];
    list.push({
      entity: row.entity,
      landed: row.landed,
      created: row.created,
      changed: row.changed,
      unchanged: row.unchanged,
      refused: row.refused,
    });
    byRun.set(row.run_id, list);
  }
  return byRun;
}

export async function refusalsFor(
  exec: SqlExecutor,
  runId: string,
  limit = 200,
): Promise<(RunRefusal & { at: string })[]> {
  const { rows } = await exec.query<{
    entity: string;
    source_record_id: string;
    reason: string;
    at: Date | string;
  }>(
    `SELECT entity, source_record_id, reason, at FROM ops.run_refusal
     WHERE run_id = $1 ORDER BY id LIMIT $2`,
    [runId, limit],
  );
  return rows.map((r) => ({
    entity: r.entity,
    sourceRecordId: r.source_record_id,
    reason: r.reason,
    at: new Date(r.at).toISOString(),
  }));
}

export async function stepsFor(exec: SqlExecutor, runId: string): Promise<RunStep[]> {
  const { rows } = await exec.query<{
    unique_id: string;
    kind: "model" | "test";
    name: string;
    status: string;
    failures: number | null;
    relation: string | null;
    message: string | null;
    execution_ms: number | null;
  }>(
    `SELECT unique_id, kind, name, status, failures, relation, message, execution_ms
     FROM ops.run_step WHERE run_id = $1 ORDER BY kind, name`,
    [runId],
  );
  return rows.map((r) => ({
    uniqueId: r.unique_id,
    kind: r.kind,
    name: r.name,
    status: r.status,
    failures: r.failures,
    relation: r.relation,
    message: r.message,
    executionMs: r.execution_ms,
  }));
}
