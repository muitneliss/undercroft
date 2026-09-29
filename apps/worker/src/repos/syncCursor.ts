/**
 * `raw.sync_cursor`: how far a provider has been read, per stream.
 *
 * Two functions and one rule between them: **a watermark is only ever handed back under the
 * format it was written in, and for the request it was read with.** A spec that changes
 * `incremental.format` -- or an entity that grows one where the value used to be read some
 * other way -- leaves a stored string that means something else now, and comparing or sending
 * it would be the silent kind of wrong. A request that has changed since -- a spec edit, or a
 * scope that widened it -- is the same hazard in another place: the mark says how far the OLD
 * question was answered, and records it never asked about sit below it. So the read takes the format and the request key the caller is
 * about to use and answers `null` when the stored row was written under others, which costs one
 * honest full read and cannot be forgotten by a caller: there is no way to ask for the row
 * without saying what you would do with it. ADR 0034, and ADR 0052 and ADR 0072 for the
 * request.
 *
 * The row also says when the stream was last read WHOLE and what that cost, because a
 * watermark vouches only for what a source's filter can see: Xero documents edits its filter
 * never returns, so a connection may re-sync on a schedule (ADR 0082). Whether a re-sync is due
 * is decided one layer up, from these facts; this file only hands them back.
 *
 * This deliberately does NOT mirror `writeCursor`'s `GREATEST`. That guard exists because two
 * loaders overlap on one stream by construction and a rewound LOAD cursor drags a projection
 * back behind rows that are already there. Nothing overlaps here -- `run_one_running` in
 * `090_runs.sql` refuses a second run for the same (tenant, source) outright -- and `GREATEST`
 * could not be applied anyway: these strings are the provider's rendering, and `'9' > '10'`
 * is what text comparison says about epoch milliseconds. Ordering them needs the declared
 * format, which is `laterStamp`'s job in `@undercroft/connector-runtime`, one layer up where
 * the format is known.
 *
 * Nothing here decides anything. Whether a read finished cleanly enough to advance a cursor
 * is control flow in `../services/runPaths.ts`; these functions run the statements.
 */

import type { IncrementalFormat } from "@undercroft/connector-runtime";
import type { SqlExecutor } from "@undercroft/db";

import type { StreamIdentity } from "./rawRecords.ts";

/**
 * What a watermark is only meaningful under: the dialect it is written in, and the request it
 * was read with -- `requestKey` from `@undercroft/connector-runtime`, opaque here. A row still
 * holding the column's default `''` was written before every request had a key (ADR 0072) and
 * matches none, so its stream reads in full once and the write replaces it.
 */
export interface CursorReading {
  readonly format: IncrementalFormat;
  readonly requestKey: string;
}

/** What is held for a stream under the format and request a read is about to use. */
export interface StoredCursor {
  /**
   * The watermark, in the source's own rendering, or `null` for a list read whole that held no
   * stamp: nothing to send, so the next read is whole again (390).
   */
  readonly watermark: string | null;
  /** The start of the run that last read the stream whole, or `null` when none is recorded. */
  readonly wholeReadAt: string | null;
}

/**
 * The cursor held for this stream, or `null` for a full read.
 *
 * `null` covers every honest reason to read everything -- this stream has never run, or the
 * stored watermark was written under a different format or for a different request -- because a
 * caller does the same thing in each case and a distinction it cannot act on is one more thing
 * to get wrong.
 */
export async function readSyncCursor(
  exec: SqlExecutor,
  identity: StreamIdentity,
  reading: CursorReading,
): Promise<StoredCursor | null> {
  const { rows } = await exec.query<{
    watermark: string | null;
    wholeReadAt: Date | string | null;
  }>(
    `SELECT watermark, whole_read_at AS "wholeReadAt" FROM raw.sync_cursor
      WHERE source = $1 AND tenant_id = $2 AND entity = $3 AND format = $4 AND request_key = $5`,
    [identity.source, identity.tenantId, identity.entity, reading.format, reading.requestKey],
  );
  const [row] = rows;
  return row === undefined
    ? null
    : {
        watermark: row.watermark,
        wholeReadAt: row.wholeReadAt === null ? null : new Date(row.wholeReadAt).toISOString(),
      };
}

/**
 * Record how far this stream's source was read, in the source's own rendering.
 *
 * The format and the request key travel WITH the watermark rather than beside it in the
 * caller's head: they are one fact, and a row holding a value under yesterday's format or
 * yesterday's request is what {@link readSyncCursor} refuses to answer with.
 *
 * `wholeRead` is set for a read that sent no watermark and got to the end: the run that made it,
 * whose start becomes `whole_read_at`, and the requests it cost. `null` for a read that sent one,
 * which keeps what is already held.
 */
export async function writeSyncCursor(
  exec: SqlExecutor,
  identity: StreamIdentity,
  cursor: CursorReading & { readonly watermark: string | null },
  wholeRead: { readonly runId: string; readonly requests: number } | null,
): Promise<void> {
  await exec.query(
    `INSERT INTO raw.sync_cursor
       (source, tenant_id, entity, watermark, format, request_key,
        whole_read_at, whole_read_requests, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, (SELECT started_at FROM ops.run WHERE id = $7), $8, now())
     ON CONFLICT (source, tenant_id, entity) DO UPDATE
       SET watermark = EXCLUDED.watermark, format = EXCLUDED.format,
           request_key = EXCLUDED.request_key,
           whole_read_at = CASE WHEN $7::text IS NULL THEN raw.sync_cursor.whole_read_at
                                ELSE EXCLUDED.whole_read_at END,
           whole_read_requests = CASE WHEN $7::text IS NULL THEN raw.sync_cursor.whole_read_requests
                                      ELSE EXCLUDED.whole_read_requests END,
           updated_at = now()`,
    [
      identity.source,
      identity.tenantId,
      identity.entity,
      cursor.watermark,
      cursor.format,
      cursor.requestKey,
      wholeRead?.runId ?? null,
      wholeRead?.requests ?? null,
    ],
  );
}
