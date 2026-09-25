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

import type { SqlExecutor } from "../executor.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";

export type RunStatus = "running" | "ok" | "failed";
/**
 * What a run was doing. The SQL column is free text with no CHECK, deliberately, so a new
 * verb is a type change here and not a migration -- see `020_control_plane.sql`.
 *
 * `extract` reads landed documents into `raw.document_text`. It is separate from `ingest`
 * rather than its tail because OCR over a real tenant is tens of minutes, and the unique
 * index on `(tenant_id, source, verb)` lets the two run beside each other. ADR 0024.
 */
export type RunVerb = "ingest" | "transform" | "extract";
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
  /**
   * Which build produced this run -- `v1.16.0`, or `main@a1b2c3d` for a build cut from no
   * release. `""` is "this build did not say", never a guess: the deploy pointer is `latest`
   * by policy, so a version that is not baked into the image cannot be recovered from it.
   */
  readonly releaseTag: string;
  /**
   * How much work was outstanding when this run drew its batch, or `null` for a verb with no
   * backlog to report. Never 0 for "unknown" -- 0 claims the queue was empty, which is the
   * opposite fact and the one that makes a healthy drain look like a fault.
   */
  readonly pendingBefore: number | null;
}

/**
 * How many records one run refused for one reason -- the rollup that outlives the records.
 *
 * `ops.run_refusal` is pruned at 7 days and this is not, so a year-old run still answers "what
 * were the 245" with "230 of them were images too small to read". See `250_run_trace.sql`.
 */
export interface RunReasonCount {
  readonly entity: string;
  readonly reason: string;
  readonly count: number;
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

/**
 * One line of what a run is doing, as it does it.
 *
 * `event` is a verb from a fixed set the interface has a sentence for, never prose, and
 * `detail` carries counts and opaque provider ids and nothing else -- see the docstring on
 * `160_run_events.sql` for why that restriction is the whole design and not a style.
 */
export interface RunEvent {
  readonly at: string;
  readonly level: "info" | "warn" | "error";
  readonly event: string;
  /** The entity it concerns; `null` is "the run as a whole". */
  readonly entity: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
  /**
   * Whether this line is a reading of a dial rather than a thing that happened.
   *
   * A live line keeps ONE row per `(run, event, entity)` and is rewritten in place as its
   * figure moves; a milestone appends and is never touched again. That distinction is the
   * whole of `210_run_event_live.sql`, and it is what lets a run narrate itself for hours
   * without the feed becoming the thing it is describing.
   *
   * It travels to the browser because the two are read differently there as well: a milestone
   * is a line of the ledger, a live one is the gauge above it.
   */
  readonly live: boolean;
}

/** The longest error text a run keeps. Enough to name the fault, too short to hold a row. */
export const MAX_ERROR_CHARS = 500;

/** How much of a run's feed one read returns. Above the worker's own per-run cap. */
export const MAX_EVENTS_READ = 300;

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
    /** Which build is opening this run. Stamped here so it is true even of a run that fails. */
    releaseTag?: string;
  },
): Promise<OpenOutcome> {
  try {
    await exec.query(
      `INSERT INTO ops.run (id, tenant_id, source, verb, trigger, triggered_by, parent_run_id,
                            release_tag)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.id,
        input.tenantId,
        input.source,
        input.verb,
        input.trigger,
        input.triggeredBy ?? "",
        input.parentRunId ?? null,
        input.releaseTag ?? "",
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

/**
 * Record how many records one run refused for each reason.
 *
 * Summed on conflict rather than replaced, matching `recordEntities`: a verb that records in
 * batches adds to its own tally, and a resumed entity must not overwrite the half already
 * counted. Reasons are the fixed vocabulary in `extract/extractText.ts` and `extract/ocr.ts`,
 * so this table stays a handful of rows per run however many records were refused.
 */
export async function recordRefusalReasons(
  exec: SqlExecutor,
  runId: string,
  counts: readonly RunReasonCount[],
): Promise<void> {
  if (counts.length === 0) {
    return;
  }
  await exec.query(
    `INSERT INTO ops.run_refusal_reason (run_id, entity, reason, count)
     SELECT $1, c->>'entity', left(c->>'reason', $3), (c->>'count')::int
     FROM jsonb_array_elements($2::jsonb) AS c
     ON CONFLICT (run_id, entity, reason) DO UPDATE SET
       count = ops.run_refusal_reason.count + EXCLUDED.count`,
    [runId, JSON.stringify(counts), MAX_ERROR_CHARS],
  );
}

/** The rollup for one run, biggest reason first -- the order a reader wants to read it in. */
export async function reasonsFor(exec: SqlExecutor, runId: string): Promise<RunReasonCount[]> {
  const { rows } = await exec.query<{ entity: string; reason: string; count: number }>(
    `SELECT entity, reason, count FROM ops.run_refusal_reason
      WHERE run_id = $1 ORDER BY count DESC, reason`,
    [runId],
  );
  return rows.map((row) => ({ entity: row.entity, reason: row.reason, count: row.count }));
}

/**
 * How much was outstanding when this run drew its batch.
 *
 * Written when it is learned rather than folded into `closeRun`, so a run that FAILS still
 * records the queue it was looking at -- which is the run whose depth a reader most wants.
 */
export async function recordPendingBefore(
  exec: SqlExecutor,
  runId: string,
  pending: number,
): Promise<void> {
  await exec.query("UPDATE ops.run SET pending_before = $2 WHERE id = $1", [runId, pending]);
}

/**
 * Drop per-record refusals older than `keepDays`, and answer how many went.
 *
 * The rollup is untouched -- it is a different table, and that is why it is a different table.
 * Called by the verb that writes refusals rather than by a scheduler: one DELETE does not earn
 * a cron, and the count comes back so the caller can say what it removed instead of pruning
 * silently (`raw-lake.md`).
 */
export async function pruneRefusals(exec: SqlExecutor, keepDays: number): Promise<number> {
  const { rows } = await exec.query<{ removed: number }>(
    "SELECT ops.prune_run_refusals($1) AS removed",
    [keepDays],
  );
  return rows[0]?.removed ?? 0;
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

/** The key a live line is unique on, matching `run_event_live_one`'s own expression. */
function liveKey(event: RunEvent): string {
  return `${event.event} ${event.entity ?? ""}`;
}

/**
 * The batch as the two statements below need it: milestones in the order they happened, and
 * at most ONE live line per key -- the last, which is the only reading still true.
 *
 * The de-duplication is not an optimisation. `ON CONFLICT DO UPDATE` refuses a source that
 * offers the same key twice ("cannot affect row a second time"), and a flush that spans two
 * coalescing intervals offers exactly that.
 */
function partition(events: readonly RunEvent[]): {
  appended: RunEvent[];
  live: RunEvent[];
} {
  const appended: RunEvent[] = [];
  const latest = new Map<string, RunEvent>();
  for (const event of events) {
    if (event.live) {
      latest.set(liveKey(event), event);
    } else {
      appended.push(event);
    }
  }
  return { appended, live: [...latest.values()] };
}

/**
 * Record what a run is doing, while it is still doing it.
 *
 * `at` travels with each event rather than defaulting to `now()`, because the worker buffers
 * a handful of events and flushes them together: stamping them on arrival here would file
 * three minutes of work under one instant.
 *
 * JSON in, rows out, as `recordEntities` and `recordSteps` do -- one statement whatever the
 * count, and the same parameter shape under `pg` and PGlite.
 *
 * TWO STATEMENTS, because the table holds two kinds of line. A milestone is appended and never
 * touched again. A live line -- a reading of a dial -- keeps one row per `(run, event, entity)`
 * and is rewritten in place, which is what lets an hours-long run keep a counter moving without
 * writing a row per reading. `210_run_event_live.sql` argues the distinction; the worker decides
 * which side a line falls on by calling `progress` rather than `info`.
 *
 * The milestones go first, so a run's opening line is filed before the first reading of the
 * dial it opened.
 */
export async function recordEvents(
  exec: SqlExecutor,
  runId: string,
  events: readonly RunEvent[],
): Promise<void> {
  const { appended, live } = partition(events);

  if (appended.length > 0) {
    await exec.query(
      `INSERT INTO ops.run_event (run_id, at, level, event, entity, detail)
       SELECT $1, (e->>'at')::timestamptz, e->>'level', e->>'event', e->>'entity',
              coalesce(e->'detail', '{}'::jsonb)
       FROM jsonb_array_elements($2::jsonb) AS e`,
      [runId, JSON.stringify(appended)],
    );
  }

  if (live.length > 0) {
    // The row keeps its id, and therefore its place in the feed: a gauge stays where it first
    // appeared rather than jumping to the end of the ledger every two seconds.
    await exec.query(
      `INSERT INTO ops.run_event (run_id, at, level, event, entity, detail, live)
       SELECT $1, (e->>'at')::timestamptz, e->>'level', e->>'event', e->>'entity',
              coalesce(e->'detail', '{}'::jsonb), true
       FROM jsonb_array_elements($2::jsonb) AS e
       ON CONFLICT (run_id, event, coalesce(entity, '')) WHERE live
       DO UPDATE SET at = EXCLUDED.at, detail = EXCLUDED.detail`,
      [runId, JSON.stringify(live)],
    );
  }
}

/**
 * One run's feed, oldest first.
 *
 * Bounded by the NEWEST `limit` events and then re-ordered, so a run that somehow exceeded
 * the worker's own cap shows what it is doing now rather than what it was doing first. There
 * is no cursor, deliberately: the feed is capped, so a reader can have all of it on every
 * read and never has to hold a second copy that could drift from the run.
 */
export async function eventsFor(
  exec: SqlExecutor,
  runId: string,
  limit: number = MAX_EVENTS_READ,
): Promise<RunEvent[]> {
  // `detail` arrives parsed: both drivers hand a jsonb column back as a value, which is the
  // same assumption `models.ts` makes about `app.model.columns`.
  const { rows } = await exec.query<{
    at: Date | string;
    level: RunEvent["level"];
    event: string;
    entity: string | null;
    detail: Record<string, unknown>;
    live: boolean;
  }>(
    `SELECT at, level, event, entity, detail, live FROM (
       SELECT id, at, level, event, entity, detail, live FROM ops.run_event
       WHERE run_id = $1 ORDER BY id DESC LIMIT $2
     ) AS recent ORDER BY id`,
    [runId, limit],
  );
  return rows.map((r) => ({
    at: new Date(r.at).toISOString(),
    level: r.level,
    event: r.event,
    entity: r.entity,
    detail: r.detail,
    live: r.live,
  }));
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

/** A failure claimed for notice, and whether it is to be sent or was suppressed. */
export interface FailedRunNotice {
  readonly id: string;
  readonly tenantId: string;
  readonly source: string;
  readonly verb: RunVerb;
  readonly error: string | null;
  readonly endedAt: string;
  readonly notice: "sent" | "suppressed";
}

/**
 * Claim every failed run of the last day that nobody has been told about.
 *
 * One UPDATE that marks and returns, so a notice goes out at most once whatever runs the
 * tick. The suppression is decided in the same statement: a failure of a pair that had a
 * notice SENT within the last day, with no successful run of that pair since, is marked
 * `suppressed` and returned as such -- the caller sends nothing for it. A success in
 * between resets the window, because "it failed again" after "it worked" is news.
 *
 * Failures older than a day are left alone rather than claimed late: a notice about last
 * week arriving today would be read as today's.
 */
export async function claimFailedRuns(exec: SqlExecutor): Promise<FailedRunNotice[]> {
  const { rows } = await exec.query<{
    id: string;
    tenant_id: string;
    source: string;
    verb: RunVerb;
    error: string | null;
    ended_at: Date | string;
    notice: "sent" | "suppressed";
  }>(
    `UPDATE ops.run r
     SET notified_at = now(),
         notice = CASE WHEN EXISTS (
           SELECT 1 FROM ops.run p
           WHERE p.tenant_id = r.tenant_id AND p.source = r.source AND p.verb = r.verb
             AND p.id <> r.id AND p.notice = 'sent'
             AND p.notified_at > now() - interval '1 day'
             AND NOT EXISTS (
               SELECT 1 FROM ops.run o
               WHERE o.tenant_id = r.tenant_id AND o.source = r.source AND o.verb = r.verb
                 AND o.status = 'ok' AND o.ended_at >= p.notified_at
             )
         ) THEN 'suppressed' ELSE 'sent' END
     WHERE r.status = 'failed' AND r.notified_at IS NULL
       AND r.ended_at > now() - interval '1 day'
     RETURNING r.id, r.tenant_id, r.source, r.verb, r.error, r.ended_at, r.notice`,
  );
  return rows
    .map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      source: row.source,
      verb: row.verb,
      error: row.error,
      endedAt: new Date(row.ended_at).toISOString(),
      notice: row.notice,
    }))
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt));
}

/** A success claimed for notice because it ended a failure somebody was told about. */
export interface RecoveredRunNotice {
  readonly id: string;
  readonly tenantId: string;
  readonly source: string;
  readonly verb: RunVerb;
  readonly endedAt: string;
  /** When the first failure of the streak this run ended was recorded. */
  readonly failingSince: string;
}

/**
 * Claim every successful run of the last day that ended an announced failure.
 *
 * The streak a success ends is every failure of its pair since the pair's previous success.
 * It was announced when any of those failures was claimed by `claimFailedRuns`, as sent or as
 * suppressed; a streak nobody was told about needs no "it works again", so its success is left
 * unclaimed. Marked `recovered` in the same UPDATE that returns it, so the notice goes out at
 * most once whatever runs the tick.
 *
 * Runs are ordered by `(ended_at, id)`, not the timestamp alone: two runs can end in the same
 * millisecond, and a run id leads with its start time, so the pair is a total order that
 * agrees with the clock.
 *
 * Call it after `claimFailedRuns` in the same tick: a failure and the success that ended it
 * can both land between two ticks, and the recovery only counts a failure already claimed.
 */
export async function claimRecoveredRuns(exec: SqlExecutor): Promise<RecoveredRunNotice[]> {
  const { rows } = await exec.query<{
    id: string;
    tenant_id: string;
    source: string;
    verb: RunVerb;
    ended_at: Date | string;
    failing_since: Date | string;
  }>(
    `UPDATE ops.run r
     SET notified_at = now(), notice = 'recovered'
     FROM (
       SELECT ok.id, min(f.ended_at) AS failing_since
       FROM ops.run ok
       JOIN ops.run f
         ON f.tenant_id = ok.tenant_id AND f.source = ok.source AND f.verb = ok.verb
        AND f.status = 'failed' AND (f.ended_at, f.id) < (ok.ended_at, ok.id)
        AND NOT EXISTS (
          SELECT 1 FROM ops.run o
          WHERE o.tenant_id = ok.tenant_id AND o.source = ok.source AND o.verb = ok.verb
            AND o.status = 'ok'
            AND (o.ended_at, o.id) > (f.ended_at, f.id) AND (o.ended_at, o.id) < (ok.ended_at, ok.id)
        )
       WHERE ok.status = 'ok' AND ok.notified_at IS NULL
         AND ok.ended_at > now() - interval '1 day'
       GROUP BY ok.id
       HAVING bool_or(f.notice IS NOT NULL)
     ) streak
     WHERE r.id = streak.id
     RETURNING r.id, r.tenant_id, r.source, r.verb, r.ended_at, streak.failing_since`,
  );
  return rows
    .map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      source: row.source,
      verb: row.verb,
      endedAt: new Date(row.ended_at).toISOString(),
      failingSince: new Date(row.failing_since).toISOString(),
    }))
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt));
}

/**
 * Every run still marked running is one the worker was in the middle of when it stopped.
 * Called at boot, and by a stopping worker whose drain ran out of time, each with its own
 * sentence for why: a row that stayed `running` forever would hold `run_one_running` against
 * every later run of the same pair.
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
  release_tag: string;
  pending_before: number | null;
}

const RUN_COLUMNS = `id, tenant_id, source, verb, trigger, triggered_by, parent_run_id, status,
  created, changed, unchanged, refused, tests_failed, error, started_at, ended_at,
  release_tag, pending_before`;

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
    releaseTag: row.release_tag,
    pendingBefore: row.pending_before,
  };
}

/** A run by id alone, for the worker's own verb. Callers with a tenant use `getRun`. */
export async function findRunById(exec: SqlExecutor, id: string): Promise<Run | null> {
  const { rows } = await exec.query<RunRow>(`SELECT ${RUN_COLUMNS} FROM ops.run WHERE id = $1`, [
    id,
  ]);
  const [row] = rows;
  return row === undefined ? null : toRun(row);
}

export async function getRun(exec: SqlExecutor, tenantId: string, id: string): Promise<Run | null> {
  const { rows } = await exec.query<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM ops.run WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const [row] = rows;
  return row === undefined ? null : toRun(row);
}

/**
 * The run a given run chained into, if it has finished chaining yet.
 *
 * `startIngestJob` opens the child only after the parent's own `done` settles (jobs.ts), so
 * a reader who just watched the parent close ok may still get `null` back for a beat before
 * the child row exists. At most one child is expected per parent -- chaining happens once,
 * right after the parent settles -- but the query takes the newest by `started_at` rather
 * than assume it, the same defensiveness `openRun`'s in-progress lookup already applies.
 */
export async function findChildRun(
  exec: SqlExecutor,
  tenantId: string,
  parentRunId: string,
): Promise<Run | null> {
  const { rows } = await exec.query<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM ops.run
     WHERE tenant_id = $1 AND parent_run_id = $2
     ORDER BY started_at DESC, id DESC LIMIT 1`,
    [tenantId, parentRunId],
  );
  const [row] = rows;
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
  const after = decodeCursor(page.cursor);
  const { rows } = await exec.query<RunRow>(
    after === null
      ? `SELECT ${RUN_COLUMNS} FROM ops.run WHERE tenant_id = $1
         ORDER BY started_at DESC, id DESC LIMIT $2`
      : `SELECT ${RUN_COLUMNS} FROM ops.run
         WHERE tenant_id = $1 AND (started_at, id) < ($3::timestamptz, $4)
         ORDER BY started_at DESC, id DESC LIMIT $2`,
    after === null ? [tenantId, page.limit + 1] : [tenantId, page.limit + 1, after.at, after.id],
  );
  const items = rows.slice(0, page.limit).map(toRun);
  const last = items.at(-1);
  const nextCursor =
    rows.length > page.limit && last !== undefined ? encodeCursor(last.startedAt, last.id) : null;
  return { items, nextCursor };
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
