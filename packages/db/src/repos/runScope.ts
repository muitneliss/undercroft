/**
 * `app.run_scope`: the scope a run read with, kept with the run. ADR 0091.
 *
 * Two readers, one writer. The worker's collectors ask {@link scopeForRun} for the scope they
 * read with, and the first ask copies it from `app.connection_detail` into the run's row; the
 * control plane's `runs.get` reads the row back with {@link recordedScope}. Because the scope a
 * run reads IS the row, the leaf cannot show a scope the run did not use -- a copy taken beside
 * the read, rather than as it, could disagree with it the moment an admin saved in between.
 *
 * In `app`, not on `ops.run`, for the reason `440_run_scope.sql` gives: the selection carries
 * names a person wrote, and BI reads `ops.run`.
 *
 * `selection` travels as JSON TEXT, as `readConnectionDetail` hands it: the caller knows which
 * kind of scope it expects and parses it there (`parseScope`), and this module would otherwise
 * have to know what a Gmail label is.
 */

import type { SqlExecutor } from "../executor.ts";

/** What a run recorded. `selectionJson` is `null` when the connection had no scope chosen. */
export interface RecordedScope {
  readonly selectionJson: string | null;
}

/**
 * The scope this run reads with, as JSON text, or `null` when its connection has none chosen.
 *
 * The first call for a run records the connection's chosen scope as that run's; every later call
 * answers with the recording, whatever has been saved since. One statement, so the copy and the
 * read are the same snapshot: `ON CONFLICT DO NOTHING` keeps the first recording, and the second
 * branch of the `UNION ALL` is what a later call sees (a row this statement inserts is not
 * visible to its own SELECT, so exactly one branch answers).
 *
 * The run must have its `ops.run` row -- the foreign key refuses a scope for a run the ledger
 * never opened, which is the right refusal for a collector handed an invented id.
 */
export async function scopeForRun(
  exec: SqlExecutor,
  run: { runId: string; tenantId: string; source: string },
): Promise<string | null> {
  const { rows } = await exec.query<{ selection: string | null }>(
    `WITH kept AS (
       INSERT INTO app.run_scope (run_id, selection)
       SELECT $1, (SELECT d.selection FROM app.connection_detail d
                    WHERE d.tenant_id = $2 AND d.source = $3)
       ON CONFLICT (run_id) DO NOTHING
       RETURNING selection
     )
     SELECT selection::text AS selection FROM kept
     UNION ALL
     SELECT selection::text AS selection FROM app.run_scope WHERE run_id = $1`,
    [run.runId, run.tenantId, run.source],
  );
  const [row] = rows;
  if (row !== undefined) {
    return row.selection;
  }
  // Only reachable if another session recorded this run's scope between this statement's
  // snapshot and its insert. A run reads its scope from one process, so this is a race with
  // nobody; it is answered by reading what was recorded rather than by a second copy.
  return (await recordedScope(exec, run.runId))?.selectionJson ?? null;
}

/**
 * What a run recorded as its scope, or `null` when it recorded none.
 *
 * `null` is "not recorded": every run from before `440_run_scope.sql`, and every run that reads
 * no scope (a lake-API batch, a transform). It is never filled in from the connection's scope
 * today, which would date today's answer to the past (ADR 0039).
 */
export async function recordedScope(
  exec: SqlExecutor,
  runId: string,
): Promise<RecordedScope | null> {
  const { rows } = await exec.query<{ selection: string | null }>(
    "SELECT selection::text AS selection FROM app.run_scope WHERE run_id = $1",
    [runId],
  );
  const [row] = rows;
  return row === undefined ? null : { selectionJson: row.selection };
}
