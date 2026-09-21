/**
 * `raw.sync_cursor`: how far a provider has been read, per stream.
 *
 * Two functions and one rule between them: **a watermark is only ever handed back under the
 * format it was written in.** A spec that changes `incremental.format` -- or an entity that
 * grows one where the value used to be read some other way -- leaves a stored string that
 * means something else now, and comparing or sending it would be the silent kind of wrong.
 * So the read takes the format the caller is about to use and answers `null` when the stored
 * row was written under another, which costs one honest full read and cannot be forgotten by
 * a caller: there is no way to ask for the row without saying what you would do with it.
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
 * The watermark to send for this stream, or `null` for a full read.
 *
 * `null` covers both of the honest reasons to read everything -- this stream has never run,
 * and the stored watermark was written under a different format -- because a caller does the
 * same thing in either case and a distinction it cannot act on is one more thing to get
 * wrong.
 */
export async function readSyncCursor(
  exec: SqlExecutor,
  identity: StreamIdentity,
  format: IncrementalFormat,
): Promise<string | null> {
  const { rows } = await exec.query<{ watermark: string }>(
    `SELECT watermark FROM raw.sync_cursor
      WHERE source = $1 AND tenant_id = $2 AND entity = $3 AND format = $4`,
    [identity.source, identity.tenantId, identity.entity, format],
  );
  return rows[0]?.watermark ?? null;
}

/**
 * Record how far this stream's source was read, in the source's own rendering.
 *
 * The format travels WITH the watermark rather than beside it in the caller's head: they are
 * one fact, and a row holding a value under yesterday's format is what {@link readSyncCursor}
 * refuses to answer with.
 */
export async function writeSyncCursor(
  exec: SqlExecutor,
  identity: StreamIdentity,
  cursor: { watermark: string; format: IncrementalFormat },
): Promise<void> {
  await exec.query(
    `INSERT INTO raw.sync_cursor (source, tenant_id, entity, watermark, format, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (source, tenant_id, entity) DO UPDATE
       SET watermark = EXCLUDED.watermark, format = EXCLUDED.format, updated_at = now()`,
    [identity.source, identity.tenantId, identity.entity, cursor.watermark, cursor.format],
  );
}
