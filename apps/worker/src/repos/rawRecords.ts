/**
 * `raw.records` and `raw.load_cursor`: the projection of the lake into Postgres.
 *
 * Two guards live in the upsert, not in application code, so a concurrent loader cannot
 * defeat them:
 *
 * - **idempotent:** an unchanged payload writes no new row version (no WAL, no index
 *   churn), so re-running over an unchanged lake is free;
 * - **no time travel:** a late-arriving older observation never overwrites a newer row.
 *
 * The payload is cast to jsonb by Postgres from the lake's own JSON text (`$5::jsonb[]`),
 * never re-serialised in JavaScript, so a number never round-trips through a float.
 *
 * Nothing here decides anything: the caller (`../services/loadToRaw.ts`) says where to
 * resume from and what to write, and these functions run the statements. That is why the
 * two guards are expressed in SQL -- a decision made here would be a decision two layers
 * below the thing that could act on it, and a concurrent loader would not be bound by it.
 */

import type { SqlExecutor } from "@undercroft/db";

/** One observation of one record, ready to be written. */
export interface RawRecordRow {
  readonly sourceRecordId: string;
  readonly payloadText: string;
  readonly contentSha256: string;
  readonly sourceUpdatedAt: string | null;
  readonly observedAt: string;
  readonly lakeKey: string;
  readonly lakeStamp: string;
  readonly runId: string;
}

export interface StreamIdentity {
  readonly source: string;
  readonly tenantId: string;
  readonly entity: string;
}

export interface UpsertCounts {
  readonly created: number;
  readonly changed: number;
  readonly unchanged: number;
}

/** Where this stream's last load stopped, or `null` if it has never run. */
export async function readCursor(
  exec: SqlExecutor,
  identity: StreamIdentity,
): Promise<string | null> {
  const { rows } = await exec.query<{ last_stamp: string }>(
    "SELECT last_stamp FROM raw.load_cursor WHERE source = $1 AND tenant_id = $2 AND entity = $3",
    [identity.source, identity.tenantId, identity.entity],
  );
  return rows[0]?.last_stamp ?? null;
}

/** Record where this stream's load reached. */
export async function writeCursor(
  exec: SqlExecutor,
  identity: StreamIdentity,
  lastStamp: string,
): Promise<void> {
  await exec.query(
    `INSERT INTO raw.load_cursor (source, tenant_id, entity, last_stamp, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (source, tenant_id, entity) DO UPDATE SET last_stamp = EXCLUDED.last_stamp, updated_at = now()`,
    [identity.source, identity.tenantId, identity.entity, lastStamp],
  );
}

/**
 * Two portable statements instead of one `ON CONFLICT ... RETURNING (xmax = 0)`.
 *
 * Telling an insert from an update in a single upsert needs the `xmax` system column,
 * which not every Postgres surface exposes (PGlite does not). Splitting it is both
 * portable and self-checking:
 *
 * 1. INSERT ... ON CONFLICT DO NOTHING RETURNING the id -> the *created* rows.
 * 2. UPDATE the existing rows, guarded, RETURNING the id -> the *changed* rows.
 *
 * The freshly-inserted rows carry the same content hash as the incoming batch, so the
 * UPDATE's `content_sha256 IS DISTINCT FROM` guard skips them for free -- there is no
 * window in which a row is counted twice. `unchanged` is whatever neither touched.
 */
export async function upsertRecords(
  exec: SqlExecutor,
  identity: StreamIdentity,
  batch: readonly RawRecordRow[],
): Promise<UpsertCounts> {
  if (batch.length === 0) {
    return { created: 0, changed: 0, unchanged: 0 };
  }

  const cols = [
    batch.map(() => identity.source),
    batch.map(() => identity.tenantId),
    batch.map(() => identity.entity),
    batch.map((r) => r.sourceRecordId),
    batch.map((r) => r.payloadText),
    batch.map((r) => r.contentSha256),
    batch.map((r) => r.sourceUpdatedAt),
    batch.map((r) => r.observedAt),
    batch.map((r) => r.lakeKey),
    batch.map((r) => r.lakeStamp),
    batch.map((r) => r.runId),
  ];

  const inserted = await exec.query<{ id: string }>(
    `INSERT INTO raw.records (
        source, tenant_id, entity, source_record_id,
        payload, content_sha256, source_updated_at, observed_at,
        lake_key, lake_stamp, run_id)
     SELECT * FROM unnest(
        $1::text[], $2::text[], $3::text[], $4::text[],
        $5::jsonb[], $6::char(64)[], $7::timestamptz[], $8::timestamptz[],
        $9::text[], $10::text[], $11::text[])
     ON CONFLICT (source, tenant_id, entity, source_record_id) DO NOTHING
     RETURNING source_record_id AS id`,
    cols,
  );

  const changed = await exec.query<{ id: string }>(
    `UPDATE raw.records r SET
        payload           = v.payload,
        content_sha256    = v.sha,
        source_updated_at = v.sua,
        observed_at       = v.obs,
        lake_key          = v.lk,
        lake_stamp        = v.ls,
        run_id            = v.rid,
        loaded_at         = now(),
        deleted_at        = NULL
     FROM unnest(
        $1::text[], $2::text[], $3::text[], $4::text[],
        $5::jsonb[], $6::char(64)[], $7::timestamptz[], $8::timestamptz[],
        $9::text[], $10::text[], $11::text[])
        AS v(src, tid, ent, srid, payload, sha, sua, obs, lk, ls, rid)
     WHERE r.source = v.src AND r.tenant_id = v.tid AND r.entity = v.ent
       AND r.source_record_id = v.srid
       AND r.content_sha256 IS DISTINCT FROM v.sha
       AND r.observed_at    <=              v.obs
     RETURNING r.source_record_id AS id`,
    cols,
  );

  const created = inserted.rows.length;
  const changedCount = changed.rows.length;
  return { created, changed: changedCount, unchanged: batch.length - created - changedCount };
}
