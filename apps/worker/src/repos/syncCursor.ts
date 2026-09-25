/**
 * `raw.sync_cursor`: how far a provider has been read, per stream.
 *
 * Two functions and one rule between them: **a watermark is only ever handed back under the
 * format it was written in, and for the request it was read with.** A spec that changes
 * `incremental.format` -- or an entity that grows one where the value used to be read some
 * other way -- leaves a stored string that means something else now, and comparing or sending
 * it would be the silent kind of wrong. A request a scope has widened since is the same hazard
 * in another place: the mark says how far the OLD question was answered, and records it never
 * asked about sit below it. So the read takes the format and the request key the caller is
 * about to use and answers `null` when the stored row was written under others, which costs one
 * honest full read and cannot be forgotten by a caller: there is no way to ask for the row
 * without saying what you would do with it. ADR 0034, and ADR 0052 for the request.
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
 * was read with -- `""` for an entity read exactly as its spec declares it, which is every row
 * written before the key existed (`280_sync_cursor_request.sql`).
 */
export interface CursorReading {
  readonly format: IncrementalFormat;
  readonly requestKey: string;
}

/**
 * The watermark to send for this stream, or `null` for a full read.
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
): Promise<string | null> {
  const { rows } = await exec.query<{ watermark: string }>(
    `SELECT watermark FROM raw.sync_cursor
      WHERE source = $1 AND tenant_id = $2 AND entity = $3 AND format = $4 AND request_key = $5`,
    [identity.source, identity.tenantId, identity.entity, reading.format, reading.requestKey],
  );
  return rows[0]?.watermark ?? null;
}

/**
 * Record how far this stream's source was read, in the source's own rendering.
 *
 * The format and the request key travel WITH the watermark rather than beside it in the
 * caller's head: they are one fact, and a row holding a value under yesterday's format or
 * yesterday's request is what {@link readSyncCursor} refuses to answer with.
 */
export async function writeSyncCursor(
  exec: SqlExecutor,
  identity: StreamIdentity,
  cursor: CursorReading & { readonly watermark: string },
): Promise<void> {
  await exec.query(
    `INSERT INTO raw.sync_cursor
       (source, tenant_id, entity, watermark, format, request_key, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (source, tenant_id, entity) DO UPDATE
       SET watermark = EXCLUDED.watermark, format = EXCLUDED.format,
           request_key = EXCLUDED.request_key, updated_at = now()`,
    [
      identity.source,
      identity.tenantId,
      identity.entity,
      cursor.watermark,
      cursor.format,
      cursor.requestKey,
    ],
  );
}
