/**
 * One pass over every tenant's BM25 search indexes: build what is missing, rebuild what a killed
 * build left invalid, reindex what has grown, and leave the rest alone (ADR 0155, ADR 0156).
 *
 * WHY A SERVICE OF ITS OWN, NOT THE MIGRATION. An index over a tenant that already holds
 * documents can only be built CONCURRENTLY -- otherwise the build holds a SHARE lock on
 * `raw.document_text`, and every tenant's extraction waits for it -- and CONCURRENTLY cannot run
 * in a transaction or a function, which is all a migration is. It needs the table's owner, the
 * bootstrap role: on Postgres 17 `GRANT MAINTAIN` let the worker `REINDEX CONCURRENTLY` but not
 * `CREATE INDEX`, so building and reindexing both live here (measured, ADR 0156).
 *
 * IDEMPOTENT, AND SAFE TO KILL. A deploy that stops the pass mid-build leaves an INVALID index
 * (measured): the next pass finds it, drops it CONCURRENTLY and builds it again. Until then the
 * door reports the tenant not ready and the search ranks ADR 0123's way, so nothing waits on
 * this and nothing is wrong while it runs. One pass at a time, by an advisory lock.
 *
 * THE TWO RULES IT DECIDES BY, each a stated budget beside what it was measured against:
 *
 *   - Parallel or serial. A serial build bloats: for a tenant of 172,000 documents the simple
 *     index was 421 MB and the english 778 MB serially, against 214 MB in parallel. But a
 *     PARALLEL build of a partial expression index evaluates the expression for EVERY row of the
 *     table, the tenant's or not (timescale/pg_textsearch#593: a 200-document tenant took 111 s in
 *     parallel and 96 ms serially). So a tenant holding at least a quarter of `raw.document_text`
 *     builds in parallel -- the rows it does not own cost at most three times its own, split
 *     across the workers -- and every other tenant serially. The quarter is a judgement between
 *     those two measurements, not a measured optimum.
 *   - Reindex when grown. Re-extraction grows an index and `VACUUM` gives nothing back (216 ->
 *     362 MB for 10% of a tenant's documents rewritten). An index is rebuilt once it is at least
 *     twice its size at its last build AND at least 64 MiB larger: doubling keeps the rebuilds'
 *     total cost proportional to the index, and the floor keeps a small tenant's index -- or one
 *     built empty by `ops.provision_tenant` -- from being rebuilt for every few documents.
 *
 * Every action is one log line (`search_index.*`), so `task obs:logs FOR=search_index` follows a
 * pass on the server.
 */

import { type Clock, describeError, type Logger, systemClock } from "@undercroft/core";
import type { SqlExecutor } from "../executor.ts";
import {
  buildSearchIndex,
  documentShare,
  dropSearchIndex,
  dropStrayIndex,
  recordSearchIndexBuild,
  reindexSearchIndex,
  type SearchIndexState,
  searchIndexStates,
  strayInvalidSearchIndexes,
  tryLockSearchIndexing,
  unlockSearchIndexing,
} from "../repos/searchIndexes.ts";

/** A tenant holding at least this share of `raw.document_text` builds with parallel workers. */
export const PARALLEL_SHARE = 0.25;
/** An index is reindexed once it is at least this many times its size at its last build... */
export const REINDEX_GROWTH = 2;
/** ...and at least this many bytes larger. */
export const REINDEX_MIN_GROWTH_BYTES = 64 * 1024 * 1024;

export type SearchIndexAction =
  /** Missing, so built. */
  | "built"
  /** Invalid -- a build cut short -- so dropped and built again. */
  | "rebuilt"
  /** Grown past the rule, so reindexed. */
  | "reindexed"
  /** Valid with no size on record (built by `ops.provision_tenant`, or before this existed). */
  | "recorded"
  /** Valid, and not grown past the rule. */
  | "kept"
  /** An invalid index no tenant's name accounts for -- a cut-short reindex's copy -- dropped. */
  | "dropped"
  /** The action this index needed raised; the next pass tries again. */
  | "failed";

export interface SearchIndexingDeps {
  /** ONE connection for the whole pass: the lock and the session settings are per session. */
  readonly exec: SqlExecutor;
  readonly log: Logger;
  readonly clock?: Clock;
}

export interface SearchIndexPass {
  /** False when another pass held the lock, and this one did nothing. */
  readonly ran: boolean;
  /** What happened to each index, in the order it happened. */
  readonly actions: readonly { readonly index: string; readonly action: SearchIndexAction }[];
}

/** What a VALID index needs: nothing, a baseline to measure growth from, or a reindex. */
export function upkeepOf(
  state: Pick<SearchIndexState, "bytes" | "builtBytes">,
): "kept" | "recorded" | "reindexed" {
  if (state.builtBytes === null || state.bytes === null) {
    return "recorded";
  }
  const grown =
    state.bytes >= state.builtBytes * REINDEX_GROWTH &&
    state.bytes - state.builtBytes >= REINDEX_MIN_GROWTH_BYTES;
  return grown ? "reindexed" : "kept";
}

/** The parallel-or-serial rule in the header, over the tenant's rows and the table's. */
export function buildsInParallel(tenantRows: number, totalRows: number): boolean {
  return totalRows > 0 && tenantRows >= totalRows * PARALLEL_SHARE;
}

/** Run one pass. Never throws for one index's failure: it is logged, and the pass goes on. */
export async function indexSearch(deps: SearchIndexingDeps): Promise<SearchIndexPass> {
  const { exec, log } = deps;
  const clock = deps.clock ?? systemClock;
  if (!(await tryLockSearchIndexing(exec))) {
    log.info("search_index.skipped", { reason: "another pass holds the lock" });
    return { ran: false, actions: [] };
  }
  const actions: { index: string; action: SearchIndexAction }[] = [];
  try {
    for (const qualified of await strayInvalidSearchIndexes(exec)) {
      const started = clock.now().getTime();
      try {
        await dropStrayIndex(exec, qualified);
        actions.push({ index: qualified, action: "dropped" });
        log.info("search_index.dropped", { index: qualified, ms: clock.now().getTime() - started });
      } catch (error) {
        actions.push({ index: qualified, action: "failed" });
        log.error("search_index.failed", { index: qualified, ...describeError(error) });
      }
    }

    for (const state of await searchIndexStates(exec)) {
      const fields = { tenantId: state.tenantId, config: state.config, index: state.indexName };
      const started = clock.now().getTime();
      try {
        const done = await mend(exec, state);
        actions.push({ index: state.indexName, action: done.action });
        log.info(`search_index.${done.action}`, {
          ...fields,
          ...done.facts,
          ms: clock.now().getTime() - started,
        });
      } catch (error) {
        actions.push({ index: state.indexName, action: "failed" });
        log.error("search_index.failed", { ...fields, ...describeError(error) });
      }
    }
  } finally {
    await unlockSearchIndexing(exec);
  }
  return { ran: true, actions };
}

/** Bring one index to where the rules want it, and say what that took. */
async function mend(
  exec: SqlExecutor,
  state: SearchIndexState,
): Promise<{ action: SearchIndexAction; facts: Record<string, unknown> }> {
  if (state.valid) {
    const upkeep = upkeepOf(state);
    if (upkeep === "kept") {
      return { action: "kept", facts: { bytes: state.bytes, builtBytes: state.builtBytes } };
    }
    if (upkeep === "recorded") {
      const builtBytes = await recordSearchIndexBuild(exec, state.tenantId, state.config);
      return { action: "recorded", facts: { builtBytes } };
    }
    const parallel = await inParallel(exec, state.tenantId);
    await reindexSearchIndex(exec, state.tenantId, state.config, parallel);
    const builtBytes = await recordSearchIndexBuild(exec, state.tenantId, state.config);
    return { action: "reindexed", facts: { parallel, bytesBefore: state.bytes, builtBytes } };
  }
  if (state.present) {
    await dropSearchIndex(exec, state.tenantId, state.config);
  }
  const parallel = await inParallel(exec, state.tenantId);
  await buildSearchIndex(exec, state.tenantId, state.config, parallel);
  const builtBytes = await recordSearchIndexBuild(exec, state.tenantId, state.config);
  return { action: state.present ? "rebuilt" : "built", facts: { parallel, builtBytes } };
}

async function inParallel(exec: SqlExecutor, tenantId: string): Promise<boolean> {
  const { tenantRows, totalRows } = await documentShare(exec, tenantId);
  return buildsInParallel(tenantRows, totalRows);
}
