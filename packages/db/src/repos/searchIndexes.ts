/**
 * The tenants' BM25 search indexes on `raw.document_text`: what stands, and the statements that
 * build, mend and measure them (ADR 0155, ADR 0156).
 *
 * Every statement that names an index is ASKED of the database -- `raw.search_index_sql` and
 * `raw.search_index_name` in `680_bm25_search.sql` -- rather than spelled here. The door derives
 * the same names to rank with, and an index this file named one way while the door looked for
 * another would be built and never used.
 *
 * ONE CONNECTION. Building CONCURRENTLY cannot run in a transaction, and the serial setting and
 * the pass's advisory lock belong to a session: so every function here expects an executor bound
 * to one connection for the whole pass, and leaves no setting behind.
 */

import type { SqlExecutor } from "../executor.ts";

export type SearchIndexConfig = "simple" | "english";

/** One tenant's index in one configuration, as it stands. */
export interface SearchIndexState {
  readonly tenantId: string;
  readonly config: SearchIndexConfig;
  readonly indexName: string;
  /** Whether a relation of that name exists, valid or not. */
  readonly present: boolean;
  /** Valid and ready: a scan may use it. False while it is missing or a build was cut short. */
  readonly valid: boolean;
  /** Its size now; `null` when it is missing. Bytes, not money: a float8 holds them exactly. */
  readonly bytes: number | null;
  /** Its size when `search-index` last built or measured it; `null` before it ever has. */
  readonly builtBytes: number | null;
}

interface StateRow {
  tenant_id: string;
  config: SearchIndexConfig;
  index_name: string;
  present: boolean;
  valid: boolean;
  bytes: number | null;
  built_bytes: number | null;
}

/** Every tenant's indexes in every configuration, tenant by tenant, simple before english. */
export async function searchIndexStates(exec: SqlExecutor): Promise<SearchIndexState[]> {
  const { rows } = await exec.query<StateRow>(
    `SELECT t.id AS tenant_id, c.config,
            raw.search_index_name(t.id, c.config)::text AS index_name,
            x.oid IS NOT NULL AS present,
            coalesce(i.indisvalid AND i.indisready, false) AS valid,
            pg_relation_size(x.oid)::float8 AS bytes,
            b.built_bytes::float8 AS built_bytes
     FROM ops.tenant t
     CROSS JOIN raw.search_index_configs() WITH ORDINALITY AS c(config, position)
     LEFT JOIN pg_class x
            ON x.relname = raw.search_index_name(t.id, c.config)
           AND x.relnamespace = 'raw'::regnamespace
     LEFT JOIN pg_index i ON i.indexrelid = x.oid
     LEFT JOIN ops.search_index_build b ON b.index_name = raw.search_index_name(t.id, c.config)
     ORDER BY t.id, c.position`,
  );
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    config: row.config,
    indexName: row.index_name,
    present: row.present,
    valid: row.valid,
    bytes: row.bytes,
    builtBytes: row.built_bytes,
  }));
}

/**
 * Invalid BM25 indexes on `raw.document_text` that no tenant's name accounts for, schema-qualified
 * and quoted: the `_ccnew` copy a `REINDEX CONCURRENTLY` leaves when it is cut short, beside the
 * original it was replacing. An invalid index is still maintained on every write, so it is dead
 * weight on the table until it is dropped.
 */
export async function strayInvalidSearchIndexes(exec: SqlExecutor): Promise<string[]> {
  const { rows } = await exec.query<{ qualified: string }>(
    `SELECT format('%I.%I', n.nspname, x.relname) AS qualified
     FROM pg_index i
     JOIN pg_class x ON x.oid = i.indexrelid
     JOIN pg_namespace n ON n.oid = x.relnamespace
     JOIN pg_am a ON a.oid = x.relam
     WHERE i.indrelid = 'raw.document_text'::regclass
       AND a.amname = 'bm25'
       AND NOT (i.indisvalid AND i.indisready)
       AND x.relname NOT IN (
           SELECT raw.search_index_name(t.id, c.config)
           FROM ops.tenant t CROSS JOIN raw.search_index_configs() AS c(config))
     ORDER BY 1`,
  );
  return rows.map((row) => row.qualified);
}

/** The statement `raw.search_index_sql` gives for this verb; see 680 for the four. */
async function statementFor(
  exec: SqlExecutor,
  tenantId: string,
  config: SearchIndexConfig,
  verb: "build" | "drop" | "reindex",
): Promise<string> {
  const { rows } = await exec.query<{ sql: string | null }>(
    "SELECT raw.search_index_sql($1, $2, $3) AS sql",
    [tenantId, config, verb],
  );
  const sql = rows[0]?.sql ?? null;
  if (sql === null) {
    throw new Error(`no ${verb} statement for ${tenantId}'s ${config} index`);
  }
  return sql;
}

/**
 * Run a maintenance statement serially, and put the session back.
 *
 * A `CONCURRENTLY` build of a pg_textsearch index is serial today whatever the server allows
 * (measured: no parallel worker in `pg_stat_activity`, and the same size either way). It is
 * pinned serial anyway because if a later release parallelised it, a parallel build of a
 * partial expression index evaluates the expression for EVERY row of the table, the tenant's or
 * not (timescale/pg_textsearch#593: 200 documents, 111 s against 96 ms).
 */
async function maintain(exec: SqlExecutor, sql: string): Promise<void> {
  await exec.query("SET max_parallel_maintenance_workers = 0");
  try {
    await exec.query(sql);
  } finally {
    await exec.query("RESET max_parallel_maintenance_workers");
  }
}

/** `CREATE INDEX CONCURRENTLY IF NOT EXISTS` for this tenant and configuration. */
export async function buildSearchIndex(
  exec: SqlExecutor,
  tenantId: string,
  config: SearchIndexConfig,
): Promise<void> {
  await maintain(exec, await statementFor(exec, tenantId, config, "build"));
}

/** `REINDEX INDEX CONCURRENTLY`: a fresh copy swapped in under the same name. */
export async function reindexSearchIndex(
  exec: SqlExecutor,
  tenantId: string,
  config: SearchIndexConfig,
): Promise<void> {
  await maintain(exec, await statementFor(exec, tenantId, config, "reindex"));
}

/** `DROP INDEX CONCURRENTLY IF EXISTS` this tenant's index in this configuration. */
export async function dropSearchIndex(
  exec: SqlExecutor,
  tenantId: string,
  config: SearchIndexConfig,
): Promise<void> {
  await exec.query(await statementFor(exec, tenantId, config, "drop"));
}

/** Drop an index `strayInvalidSearchIndexes` named, by the qualified name it gave. */
export async function dropStrayIndex(exec: SqlExecutor, qualified: string): Promise<void> {
  // The name was quoted by `format('%I.%I')` in the statement that found it, never by us.
  await exec.query(`DROP INDEX CONCURRENTLY IF EXISTS ${qualified}`);
}

/** Remember the index's size now as its size at build, which the growth rule measures from. */
export async function recordSearchIndexBuild(
  exec: SqlExecutor,
  tenantId: string,
  config: SearchIndexConfig,
): Promise<number> {
  const { rows } = await exec.query<{ built_bytes: number }>(
    `INSERT INTO ops.search_index_build (index_name, tenant_id, config, built_bytes, built_at)
     SELECT x.name, $1, $2, pg_relation_size(format('raw.%I', x.name)::regclass), now()
     FROM (SELECT raw.search_index_name($1, $2) AS name) x
     ON CONFLICT (index_name)
         DO UPDATE SET built_bytes = EXCLUDED.built_bytes, built_at = EXCLUDED.built_at
     RETURNING built_bytes::float8 AS built_bytes`,
    [tenantId, config],
  );
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`no ${config} index of ${tenantId} to measure`);
  }
  return row.built_bytes;
}

/**
 * One pass at a time. A session-level advisory lock, so it is released when the session ends --
 * including a container killed mid-build, whose backend may run on to finish the build it was
 * given. A second pass that cannot take it does nothing rather than drop that build's index as
 * "invalid" while it is still being made.
 */
export async function tryLockSearchIndexing(exec: SqlExecutor): Promise<boolean> {
  const { rows } = await exec.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock(hashtext($1))
       AS locked`,
    [PASS_LOCK],
  );
  return rows[0]?.locked === true;
}

export async function unlockSearchIndexing(exec: SqlExecutor): Promise<void> {
  await exec.query(
    `SELECT pg_advisory_unlock(hashtext($1))
       AS unlocked`,
    [PASS_LOCK],
  );
}

/** The lock's name, hashed to its key -- as `ops.lock_scopes` names its own. */
const PASS_LOCK = "undercroft.search-index";
