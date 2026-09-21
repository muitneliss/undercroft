/**
 * `raw.records` and `raw.load_cursor`: the projection of the lake into Postgres.
 *
 * Three guards live in the statements, not in application code, so a concurrent loader cannot
 * defeat them. Two are in the upsert:
 *
 * - **idempotent:** an unchanged payload writes no new row version (no WAL, no index
 *   churn), so re-running over an unchanged lake is free;
 * - **no time travel:** a late-arriving older observation never overwrites a newer row.
 *
 * and the third is in the cursor: **it only ever moves forward**, so a slow loader finishing
 * after a fast one cannot rewind it past rows that are already projected. See `writeCursor`.
 *
 * The payload is cast to jsonb by Postgres from the lake's own JSON text (`$5::jsonb[]`),
 * never re-serialised in JavaScript, so a number never round-trips through a float.
 *
 * Nothing here decides anything: the caller (`../services/loadToRaw.ts`) says where to
 * resume from and what to write, and these functions run the statements. That is why the
 * two guards are expressed in SQL -- a decision made here would be a decision two layers
 * below the thing that could act on it, and a concurrent loader would not be bound by it.
 *
 * `knownRecords` reads the other way for the same reason. It answers what a collector is
 * allowed to SKIP, and the comparison it turns on is a `timestamptz` one -- which only
 * Postgres can get right, because the text Drive sends and the text the column reads back
 * as are the same instant spelled two ways. See its own docstring.
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

/**
 * Record where this stream's load reached. Forward only.
 *
 * A third guard, in SQL for the same reason as the two above: a cursor that can be assigned
 * can be REWOUND, and a rewind is not a harmless replay. Since the loader writes the cursor
 * after every batch, two loaders over one stream now overlap by construction -- a scheduled
 * run and the recovery pass at the start of the next entity is the ordinary case -- and the
 * slower one finishing second would otherwise drag the cursor back behind rows that are
 * already projected. `GREATEST` makes the statement itself refuse that, so it holds for every
 * caller rather than for the one that remembered to check. Stamps are fixed-width and
 * lexically ordered (`@undercroft/core`'s `stamp.ts`), so text is the right comparison.
 */
export async function writeCursor(
  exec: SqlExecutor,
  identity: StreamIdentity,
  lastStamp: string,
): Promise<void> {
  await exec.query(
    `INSERT INTO raw.load_cursor (source, tenant_id, entity, last_stamp, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (source, tenant_id, entity) DO UPDATE
       SET last_stamp = GREATEST(load_cursor.last_stamp, EXCLUDED.last_stamp), updated_at = now()`,
    [identity.source, identity.tenantId, identity.entity, lastStamp],
  );
}

/**
 * One id, and the source timestamp a run would store for it if it read it now.
 *
 * `sourceUpdatedAt` is `null` where the listing carries no timestamp at all -- Gmail's
 * `messages.list` hands back ids and nothing else -- and then PRESENCE is the whole
 * question. A caller whose listing does carry one passes it, and Postgres parses both
 * sides.
 *
 * `null` means "do not compare", never "compare against nothing". A caller that HAS a
 * timestamp but does not trust it leaves the id out of the probe altogether, so the record
 * is read again; that is the honest reading of no evidence, and it is a decision for the
 * collector that knows what an absent `modifiedTime` means rather than for this statement.
 */
export interface RecordProbe {
  readonly sourceRecordId: string;
  readonly sourceUpdatedAt: string | null;
}

/**
 * How many ids ride in one probe.
 *
 * The scan is on the primary key's prefix `(source, tenant_id, entity, source_record_id)`
 * and the probe is bounded by a listing the caller is already holding, so this is about the
 * size of one statement rather than about the size of the tenant's history. What it must
 * never become is an unfiltered `SELECT`: that IS unbounded in the history, which is the
 * shape this whole change exists to stop.
 */
const PROBE_CHUNK = 1000;

/**
 * Which of these records this stream already holds, and holds unchanged.
 *
 * What a run does with the answer is skip: a message already in `raw.records` is not
 * fetched again, and a Drive file whose stored `source_updated_at` equals the
 * `modifiedTime` the listing just reported is not downloaded again. On an unchanged
 * mailbox that turns 7,786 paced requests into none.
 *
 * **THE COMPARISON IS POSTGRES'S, AND THAT IS THE POINT.** Drive renders a modification
 * time as `2026-09-17T12:00:00.000Z`; `timestamptz` reads back as `2026-09-17 12:00:00+00`.
 * The same instant, different text -- so a compare in JavaScript is false forever and
 * quietly re-fetches the entire source on every run, a defect that looks exactly like the
 * feature working. Both sides go into the statement as text and Postgres parses them, which
 * is why the probe is a repo function and not a helper beside the collector. Answering with
 * a SET rather than with the stored timestamps is the other half of that: there is no
 * rendering for a caller to compare, so there is nothing for a caller to get wrong.
 *
 * A tombstoned row does not count as held. `deleted_at` says the source dropped it, so an
 * id that came back is something to read again rather than something to skip.
 */
export async function knownRecords(
  exec: SqlExecutor,
  identity: StreamIdentity,
  probes: readonly RecordProbe[],
): Promise<Set<string>> {
  const held = new Set<string>();

  for (let from = 0; from < probes.length; from += PROBE_CHUNK) {
    const slice = probes.slice(from, from + PROBE_CHUNK);
    const { rows } = await exec.query<{ id: string }>(
      `SELECT r.source_record_id AS id
         FROM raw.records r
         JOIN unnest($4::text[], $5::timestamptz[]) AS v(srid, sua)
           ON v.srid = r.source_record_id
        WHERE r.source = $1 AND r.tenant_id = $2 AND r.entity = $3
          AND r.deleted_at IS NULL
          AND (v.sua IS NULL OR r.source_updated_at = v.sua)`,
      [
        identity.source,
        identity.tenantId,
        identity.entity,
        slice.map((probe) => probe.sourceRecordId),
        slice.map((probe) => probe.sourceUpdatedAt),
      ],
    );
    for (const row of rows) {
      held.add(row.id);
    }
  }

  return held;
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
