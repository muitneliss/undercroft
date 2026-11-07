/**
 * The search statement: one question, both halves of the lake, as the tenant's own login.
 *
 * DELIBERATELY NOT `runFramed`. That path exists to run SQL an AUTHOR wrote, and binds an empty
 * parameter list on purpose so the author's own `$1` is never silently satisfied by one of ours.
 * This is the opposite case: the SQL is ours and fixed, and the only thing that varies is the
 * reader's text -- which is therefore a BOUND PARAMETER and never spliced. The two must not
 * share a code path, because the property each relies on is the other's hazard.
 *
 * WHO IT RUNS AS is the whole of the access control. Every statement here is issued on an
 * executor that already IS `undercroft_dbt_<slug>` (`../services/tenantSession.ts`), so the
 * row-level policy on `raw` -- keyed on `raw.tenant_of(current_user)`, the one thing a session
 * cannot change -- shows it one customer's rows. The candidate functions and the BM25 door are
 * told the same `current_user` and decide by the same function (530's and 680's headers). The
 * explicit `tenant_id = $2` in the joins is belt and braces and a hint to the planner, not the
 * boundary; deleting it would not widen what a login can read, and it is written out so that a
 * reader does not have to take that on faith.
 *
 * NO `search_path` IS SET HERE, and none may be. pg_textsearch's planner hook resolves its
 * cached-score stub by unqualified name through the path the backend's FIRST statement had
 * (ADR 0156 decision 8); the tenant login's role default carries `search_ext` for it. A
 * `SET search_path` -- even one local to this transaction -- comes too late to help and was not
 * measured to be harmless, so `inReadOnlyTransaction` is given no `schema` here. Every name below
 * is qualified, so nothing here needs a path.
 *
 * The matching, folding and excerpting are `raw.*` functions from `190_raw_search.sql` (the fold,
 * the vectors and the excerpt respelled for speed in `670_fast_fold.sql`, ADR 0154),
 * `530_raw_search_candidates.sql` (narrowed in 620) and `680_bm25_search.sql`, not expressions
 * written here: the indexes are built on those functions, and an expression spelled a second way
 * in application code is an index that quietly stops being used.
 */

import type { RawSearchHit, SearchKind } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";

import { isBm25Refusal } from "./bm25Refusal.ts";
import { inReadOnlyTransaction } from "./queries.ts";

/** One raw stream a search may look in; a whole source when `entity` is `null`. */
export interface SearchStream {
  readonly source: string;
  readonly entity: string | null;
}

/**
 * How a search ranks its documents (records are always ranked ADR 0123's way, ADR 0155
 * decision 6):
 *
 *   - `bm25`: through the tenant's BM25 door, every match by relevance (ADR 0155, ADR 0156);
 *   - `newest`: ADR 0123's way, `ts_rank_cd` over the newest `caps.document` matches.
 */
export type DocumentRanking = "bm25" | "newest";

export interface SearchScope {
  readonly tenantId: string;
  readonly q: string;
  readonly kinds: readonly SearchKind[];
  readonly limit: number;
  readonly offset: number;
  /**
   * The streams to look in, or `null` for the whole lake (ADR 0142). Passed INTO the candidate
   * lookups and the door as two parallel arrays, where they narrow beside the tenant's own
   * condition and before anything is ranked -- never applied to the page, which would rank,
   * count and cut matches the reader cannot see and then describe a lake that is not theirs.
   */
  readonly streams: readonly SearchStream[] | null;
  /**
   * How long the search may run.
   *
   * Not a constant here: a GIN scan over a large lake is exactly the statement that can run
   * long, and how long is a decision, which belongs one layer up beside the console's.
   */
  readonly timeoutMs: number;
  /**
   * How many of each kind's matches are ranked, newest first, where a kind is ranked ADR 0123's
   * way: records always, documents on the `newest` path. A decision for the same reason the
   * timeout is: it is the budget that keeps a common word inside it.
   */
  readonly caps: Readonly<Record<SearchKind, number>>;
  readonly ranking: DocumentRanking;
}

/** Which kinds had matches past their cap; on every row, and the only column of an empty page. */
interface CappedColumn {
  capped: SearchKind[];
}

interface HitRow extends CappedColumn {
  kind: SearchKind;
  source: string;
  entity: string | null;
  id: string;
  rank: number;
  excerpt: string;
  observed_at: Date | string;
  deleted_at: Date | string | null;
  method: string | null;
  truncated: boolean | null;
}

/** The page had no hit: the `LEFT JOIN` gave the `capped` row nothing to join. */
interface EmptyPageRow extends CappedColumn {
  kind: null;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

/**
 * The two ways a search places its documents, each a `document_place (source, document_id,
 * place)` CTE -- `place` 1-based and total within the kind -- and what it says about a cut.
 *
 * `newest` is ADR 0123's: the candidate function finds the matches through the GIN index,
 * newest first, and is asked for `$6 + 1` of them so the answer can SAY the kind was cut rather
 * than rank a subset and present it as everything; at most `$6` are ranked by `ts_rank_cd`,
 * which rebuilds each one's vector. That rebuild is why there is a cap at all.
 *
 * `bm25` asks the door (680) for `$6` keys in fused BM25 order, which it ranks from the index's
 * own statistics without reading a row's text, over EVERY match of the tenant: no cap, so no
 * cut to report. The door ranks the whole match set and pages nothing, so `$6` is the depth the
 * page reaches -- `offset + limit + 1` -- and an `OFFSET` above it works. It refuses (55000)
 * rather than answer a page shorter than the matches, which `searchLake` turns into `null`.
 */
const DOCUMENT_PLACES: Readonly<Record<DocumentRanking, { places: string; cut: string }>> = {
  newest: {
    places: `
       document_candidate AS MATERIALIZED (
         SELECT c.source, c.document_id, c.ordinal
         FROM raw.search_document_candidates(current_user, $1, $6 + 1, $8::text[], $9::text[]) c
         WHERE 'document' = ANY($7::text[])),
       document_place AS (
         SELECT c.source, c.document_id,
                row_number() OVER (
                  ORDER BY ts_rank_cd(raw.search_tsv(t.text), raw.search_query($1)) DESC,
                           c.source, c.document_id) AS place
         FROM document_candidate c
         JOIN raw.document_text t
           ON t.source = c.source AND t.tenant_id = $2 AND t.document_id = c.document_id
         WHERE c.ordinal <= $6),`,
    cut: "CASE WHEN EXISTS (SELECT 1 FROM document_candidate WHERE ordinal > $6) THEN 'document' END",
  },
  bm25: {
    places: `
       document_place AS (
         SELECT b.source, b.document_id, b.ordinal AS place
         FROM raw.search_document_bm25(current_user, $1, $6, $8::text[], $9::text[]) b
         WHERE 'document' = ANY($7::text[])),`,
    cut: "NULL::text",
  },
};

/**
 * One page of hits: records ranked among their newest matches (ADR 0123), documents ranked as
 * `ranking` says. ADR 0155 amends ADR 0123 here for documents.
 *
 * WHY THE FUNCTIONS, NOT A `WHERE ... @@` HERE. This statement runs as the tenant's login, under
 * the row-level policy, and under a policy Postgres will not use an index for a non-leakproof
 * operator such as `@@`; the functions run as their owner and answer with keys only (530's
 * header). Everything shown -- dates, excerpt -- is read HERE, as the tenant, by joining those
 * keys back under the policy. The `@@` itself is spelled once, in 530 and 680, beside the
 * indexes it has to match.
 *
 * HOW THE TWO KINDS SHARE A PAGE. Each kind is ranked within itself -- records by `ts_rank_cd`,
 * documents by BM25 or by `ts_rank_cd` -- and the page interleaves them by PLACE: each kind's
 * first, then each kind's second, documents before records at an equal place. Comparing the
 * scores across kinds would mean nothing: `ts_rank_cd` over a short JSON payload and over twenty
 * pages of contract do not measure the same thing, and the door returns no score at all (a score
 * per row re-scores it from its text, 680). The same rule on both paths, so a page does not mix
 * differently because an index was being built. The remaining keys make the order TOTAL: without
 * them `OFFSET` counts against an order Postgres is free to vary, and a hit can appear on two
 * pages or on neither. Every place is total within its kind too, so every page of one search
 * ranks the same set.
 *
 * `rank` on the wire is `1 / place`: an ordering key and nothing else, 1 for each kind's best.
 * It is `::float8`, so it arrives as a number. The pinned `numeric`/`int8` parsers answer in
 * strings to keep MONEY out of floats (`.claude/rules/money.md`); a relevance key is not money,
 * and the cast says so at the one place it happens.
 *
 * WHERE THE BODY IS READ AND THE EXCERPT CUT. The page is ordered and cut over KEYS: a body is
 * joined only for the rows the LIMIT let through, so a deep page over the door carries no text
 * through its sort. `raw.search_excerpt` folds the body again and scans it once per term, so it
 * is computed in the outermost SELECT, over the page and nothing else.
 *
 * A record's excerpt is cut from its payload's text form, so it carries the JSON punctuation
 * around the match -- `"deal_name":"Hợp đồng thuê nhà"` rather than the sentence alone. That
 * is information, not noise: it names the field the match was in.
 *
 * `$3` is `limit + 1`, so the caller can say the page was cut rather than infer it from a full
 * one -- "twenty hits" and "twenty of many" are different answers to "is what I want in here".
 *
 * A document is dated by the catalogue row beside it, LEFT JOINed and `coalesce`d to
 * `extracted_at`: a text row whose catalogue entry has gone would otherwise vanish from the
 * results. The date would be missing, which is a smaller wrong than the hit being missing.
 *
 * `capped` names each kind that had matches past its cap -- records on either path, documents on
 * the `newest` path only -- and an empty page still carries it, which is when it matters most:
 * "no more hits" and "no more RANKED hits" are different answers.
 */
function searchStatement(ranking: DocumentRanking): string {
  const documents = DOCUMENT_PLACES[ranking];
  return `
  WITH record_candidate AS MATERIALIZED (
         SELECT c.source, c.entity, c.source_record_id, c.ordinal
         FROM raw.search_record_candidates(current_user, $1, $5 + 1, $8::text[], $9::text[]) c
         WHERE 'record' = ANY($7::text[])),
       record_place AS (
         SELECT c.source, c.entity, c.source_record_id AS id,
                row_number() OVER (
                  ORDER BY ts_rank_cd(raw.record_tsv(r.payload), raw.search_query($1)) DESC,
                           c.source, c.entity, c.source_record_id) AS place
         FROM record_candidate c
         JOIN raw.records r
           ON r.source = c.source AND r.tenant_id = $2
          AND r.entity = c.entity AND r.source_record_id = c.source_record_id
         WHERE c.ordinal <= $5),${documents.places}
       page AS (
         SELECT 'record'::text AS kind, source, entity, id, place FROM record_place
         UNION ALL
         SELECT 'document'::text, source, NULL::text, document_id, place FROM document_place
         ORDER BY place, kind, source, entity, id
         LIMIT $3 OFFSET $4),
       shown AS (
         SELECT p.kind, p.source, p.entity, p.id, p.place,
                r.payload::text AS body, r.observed_at, r.deleted_at,
                NULL::text AS method, NULL::boolean AS truncated
         FROM page p
         JOIN raw.records r
           ON p.kind = 'record' AND r.source = p.source AND r.tenant_id = $2
          AND r.entity = p.entity AND r.source_record_id = p.id
         UNION ALL
         SELECT p.kind, p.source, p.entity, p.id, p.place,
                t.text, coalesce(d.observed_at, t.extracted_at), d.deleted_at,
                t.method, t.truncated
         FROM page p
         JOIN raw.document_text t
           ON p.kind = 'document' AND t.source = p.source AND t.tenant_id = $2
          AND t.document_id = p.id
         LEFT JOIN raw.documents d
           ON d.source = t.source AND d.tenant_id = t.tenant_id AND d.document_id = t.document_id)
  SELECT s.kind, s.source, s.entity, s.id, (1.0 / s.place)::float8 AS rank,
         raw.search_excerpt(s.body, $1) AS excerpt,
         s.observed_at, s.deleted_at, s.method, s.truncated,
         cut.kinds AS capped
  FROM (SELECT array_remove(ARRAY[
          CASE WHEN EXISTS (SELECT 1 FROM record_candidate WHERE ordinal > $5) THEN 'record' END,
          ${documents.cut}
        ], NULL) AS kinds) cut
  LEFT JOIN shown s ON true
  ORDER BY s.place, s.kind, s.source, s.entity, s.id`;
}

/**
 * The statement each path runs. Exported for one reader besides `searchLake`: the test that asks
 * Postgres for its plan, so that what it proves is about the statement that runs and not a copy.
 */
export const SEARCH_STATEMENTS: Readonly<Record<DocumentRanking, string>> = {
  newest: searchStatement("newest"),
  bm25: searchStatement("bm25"),
};

/**
 * The most keys the door is asked for: Postgres's `integer`, its `p_limit`'s type.
 *
 * Clamping there loses nothing. The door holds at most its two heads' keys (twice
 * `raw.search_bm25_depth()`), far fewer than this, so any page reaching past them is either
 * every match -- answered -- or past what it ranked -- refused, and asked again the older way.
 */
const DOOR_MOST_KEYS = 2_147_483_647;

/** Whether the tenant's BM25 indexes are both valid and ready (680), asked as its login. */
async function bm25Ready(exec: SqlExecutor): Promise<boolean> {
  const { rows } = await exec.query<{ ready: boolean }>(
    "SELECT raw.search_document_bm25_ready(current_user) AS ready",
  );
  return rows[0]?.ready === true;
}

/** A page of hits, and which kinds had more matches than were ranked. */
export interface SearchPage {
  /** Up to `limit + 1` hits, best first. */
  readonly hits: RawSearchHit[];
  readonly capped: SearchKind[];
}

/**
 * One page over the tenant's lake, ranked as `scope.ranking` says; `null` when that was `bm25`
 * and the door could not answer it -- its indexes are not ready, or it refused the page (ADR
 * 0156 decision 5). The caller then asks again with `newest`; this answers nothing in between,
 * because a page half-ranked one way and half the other would describe neither.
 *
 * Each call is its own read-only frame. A refusal aborts the transaction it is raised in, and the
 * frame's ROLLBACK is what makes the connection usable for the next.
 */
export function searchLake(
  exec: SqlExecutor,
  scope: SearchScope & { readonly ranking: "newest" },
): Promise<SearchPage>;
export function searchLake(exec: SqlExecutor, scope: SearchScope): Promise<SearchPage | null>;
export function searchLake(exec: SqlExecutor, scope: SearchScope): Promise<SearchPage | null> {
  if (scope.kinds.length === 0) {
    return Promise.resolve({ hits: [], capped: [] });
  }
  return inReadOnlyTransaction(exec, { timeoutMs: scope.timeoutMs }, async () => {
    if (scope.ranking === "bm25" && !(await bm25Ready(exec))) {
      return null;
    }
    const rows = await pageRows(exec, scope);
    return rows === null ? null : pageOf(rows);
  });
}

/** The statement's rows, or `null` when the door refused the page (`bm25` only). */
async function pageRows(
  exec: SqlExecutor,
  scope: SearchScope,
): Promise<(HitRow | EmptyPageRow)[] | null> {
  try {
    const { rows } = await exec.query<HitRow | EmptyPageRow>(
      SEARCH_STATEMENTS[scope.ranking],
      parametersOf(scope),
    );
    return rows;
  } catch (error) {
    if (scope.ranking === "bm25" && isBm25Refusal(error)) {
      return null;
    }
    throw error;
  }
}

/** `$1`-`$9`, the same positions in both statements; only `$6`, the document budget, differs. */
function parametersOf(scope: SearchScope): unknown[] {
  const documentBudget =
    scope.ranking === "bm25"
      ? Math.min(scope.offset + scope.limit + 1, DOOR_MOST_KEYS)
      : scope.caps.document;
  return [
    scope.q,
    scope.tenantId,
    scope.limit + 1,
    scope.offset,
    scope.caps.record,
    documentBudget,
    scope.kinds,
    scope.streams === null ? null : scope.streams.map((stream) => stream.source),
    scope.streams === null ? null : scope.streams.map((stream) => stream.entity),
  ];
}

function pageOf(rows: readonly (HitRow | EmptyPageRow)[]): SearchPage {
  // An empty page is still one row -- the `capped` row with nothing joined to it -- so the cut
  // is reported when there is nothing left to show, which is exactly when it matters. No row at
  // all contradicts the statement, and is refused rather than read as "not cut".
  const [first] = rows;
  if (first === undefined) {
    throw new Error("the search answered no row, though its `capped` row is always there");
  }
  return {
    hits: rows.flatMap((row) => (isHit(row) ? [toHit(row)] : [])),
    capped: first.capped,
  };
}

function isHit(row: HitRow | EmptyPageRow): row is HitRow {
  return row.kind !== null;
}

function toHit(row: HitRow): RawSearchHit {
  const base = {
    source: row.source,
    rank: row.rank,
    excerpt: row.excerpt,
    observedAt: iso(row.observed_at),
    deletedAt: isoOrNull(row.deleted_at),
  };
  if (row.kind === "document") {
    return {
      kind: "document",
      ...base,
      documentId: row.id,
      method: row.method,
      // `truncated` is NOT NULL on the table and null only in the record branch's padding. A
      // document row reaching here without one is a contradiction, so it is refused rather than
      // defaulted to `false` -- which would tell a reader that a cut document was complete.
      truncated: notNull(row.truncated, "document_text.truncated"),
    };
  }
  return {
    kind: "record",
    ...base,
    // Same: `entity` is part of `raw.records`'s primary key and cannot be null. An empty string
    // would build a stream link that opens nothing.
    entity: notNull(row.entity, "records.entity"),
    sourceRecordId: row.id,
  };
}

function notNull<T>(value: T | null, column: string): T {
  if (value === null) {
    throw new Error(`${column} came back null, which the schema forbids`);
  }
  return value;
}
