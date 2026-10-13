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
 * cannot change -- shows it one customer's rows. The candidate functions are told the same
 * `current_user` and decide by the same function (530's header). The explicit `tenant_id = $2`
 * in the joins is belt and braces and a hint to the planner, not the boundary; deleting it would
 * not widen what a login can read, and it is written out so that a reader does not have to take
 * that on faith.
 *
 * The matching, folding and excerpting are `raw.*` functions from `190_raw_search.sql` and
 * `530_raw_search_candidates.sql`, not expressions written here: the index is built on those
 * functions, and an expression spelled a second way in application code is an index that
 * quietly stops being used.
 */

import type { RawSearchHit, SearchKind } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";

import { inReadOnlyTransaction } from "./queries.ts";

export interface SearchScope {
  readonly tenantId: string;
  readonly q: string;
  readonly kinds: readonly SearchKind[];
  readonly limit: number;
  readonly offset: number;
  /**
   * How long the search may run.
   *
   * Not a constant here: a GIN scan over a large lake is exactly the statement that can run
   * long, and how long is a decision, which belongs one layer up beside the console's.
   */
  readonly timeoutMs: number;
  /**
   * How many of each kind's matches are ranked, newest first. A decision for the same reason
   * the timeout is: it is the budget that keeps a common word inside it.
   */
  readonly caps: Readonly<Record<SearchKind, number>>;
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
 * One page of hits, ranked among each kind's newest matches. ADR 0123 amends ADR 0026 here.
 *
 * WHICH ROWS ARE RANKED. Ranking a row means rebuilding its folded tsvector -- the GIN index
 * answers `@@` and stores no vector -- so ranking every match made a common word cost the whole
 * lake. Each kind's matches are found first by `raw.search_*_candidates` (530), through the
 * index and without ranking, newest first; at most `caps[kind]` of them are ranked. The function
 * is asked for one more than the cap, so the answer can SAY a kind was cut rather than rank a
 * subset and present it as everything: `capped` names those kinds, and an empty page still
 * carries it, which is when it matters most -- "no more hits" and "no more RANKED hits" are
 * different answers.
 *
 * WHY THE FUNCTIONS, NOT A `WHERE ... @@` HERE. This statement runs as the tenant's login, under
 * the row-level policy, and under a policy Postgres will not use an index for a non-leakproof
 * operator such as `@@`; the functions run as their owner and answer with keys only (530's
 * header). Everything shown -- rank, dates, excerpt -- is read HERE, as the tenant, by joining
 * those keys back under the policy. The `@@` itself is spelled once, in 530, beside the indexes
 * it has to match.
 *
 * WHERE THE EXCERPT IS CUT. `raw.search_excerpt` folds the body again and scans it once per
 * term, so it is computed in the outermost SELECT, over the page and nothing else: a target
 * list above a LIMIT is evaluated for the rows the LIMIT lets through.
 *
 * A record's excerpt is cut from its payload's text form, so it carries the JSON punctuation
 * around the match -- `"deal_name":"Hợp đồng thuê nhà"` rather than the sentence alone. That
 * is information, not noise: it names the field the match was in.
 *
 * ORDER. `rank DESC` orders WITHIN a kind honestly; ACROSS the two it is a heuristic, because
 * `ts_rank_cd` over a short JSON payload and over twenty pages of contract are not measuring the
 * same thing. The remaining three keys make the order TOTAL: without them `OFFSET` counts
 * against an order Postgres is free to vary, and a hit can appear on two pages or on neither.
 * The candidate order is total too, so every page of one search ranks the same set.
 *
 * `rank` is `::float8`, so it arrives as a number. The pinned `numeric`/`int8` parsers answer
 * in strings to keep MONEY out of floats (`.claude/rules/money.md`); a relevance score is an
 * ordering key and nothing else, and the cast says so at the one place it happens.
 *
 * `$3` is `limit + 1`, so the caller can say the page was cut rather than infer it from a full
 * one -- "twenty hits" and "twenty of many" are different answers to "is what I want in here".
 *
 * A document is dated by the catalogue row beside it, LEFT JOINed and `coalesce`d to
 * `extracted_at`: a text row whose catalogue entry has gone would otherwise vanish from the
 * results. The date would be missing, which is a smaller wrong than the hit being missing.
 *
 * Exported for one reader besides `searchLake`: the test that asks Postgres for this
 * statement's plan, so that what it proves is about the statement that runs and not a copy.
 */
export const SEARCH_STATEMENT = `
  WITH record_candidate AS MATERIALIZED (
         SELECT c.source, c.entity, c.source_record_id, c.ordinal
         FROM raw.search_record_candidates(current_user, $1, $5 + 1) c
         WHERE 'record' = ANY($7::text[])),
       document_candidate AS MATERIALIZED (
         SELECT c.source, c.document_id, c.ordinal
         FROM raw.search_document_candidates(current_user, $1, $6 + 1) c
         WHERE 'document' = ANY($7::text[])),
       hit AS (
         SELECT 'record'::text           AS kind,
                r.source                 AS source,
                r.entity                 AS entity,
                r.source_record_id       AS id,
                ts_rank_cd(raw.record_tsv(r.payload), raw.search_query($1))::float8 AS rank,
                r.payload::text          AS body,
                r.observed_at            AS observed_at,
                r.deleted_at             AS deleted_at,
                NULL::text               AS method,
                NULL::boolean            AS truncated
         FROM record_candidate c
         JOIN raw.records r
           ON r.source = c.source AND r.tenant_id = $2
          AND r.entity = c.entity AND r.source_record_id = c.source_record_id
         WHERE c.ordinal <= $5
         UNION ALL
         SELECT 'document'::text,
                t.source,
                NULL::text,
                t.document_id,
                ts_rank_cd(raw.search_tsv(t.text), raw.search_query($1))::float8,
                t.text,
                coalesce(d.observed_at, t.extracted_at),
                d.deleted_at,
                t.method,
                t.truncated
         FROM document_candidate c
         JOIN raw.document_text t
           ON t.source = c.source AND t.tenant_id = $2 AND t.document_id = c.document_id
         LEFT JOIN raw.documents d
           ON d.source = t.source AND d.tenant_id = t.tenant_id AND d.document_id = t.document_id
         WHERE c.ordinal <= $6),
       page AS (
         SELECT * FROM hit
         ORDER BY rank DESC, kind, source, id
         LIMIT $3 OFFSET $4)
  SELECT p.kind, p.source, p.entity, p.id, p.rank,
         raw.search_excerpt(p.body, $1) AS excerpt,
         p.observed_at, p.deleted_at, p.method, p.truncated,
         cut.kinds AS capped
  FROM (SELECT array_remove(ARRAY[
          CASE WHEN EXISTS (SELECT 1 FROM record_candidate WHERE ordinal > $5) THEN 'record' END,
          CASE WHEN EXISTS (SELECT 1 FROM document_candidate WHERE ordinal > $6) THEN 'document' END
        ], NULL) AS kinds) cut
  LEFT JOIN page p ON true
  ORDER BY p.rank DESC, p.kind, p.source, p.id`;

/** A page of hits, and which kinds had more matches than were ranked. */
export interface SearchPage {
  /** Up to `limit + 1` hits, best first. */
  readonly hits: RawSearchHit[];
  readonly capped: SearchKind[];
}

export function searchLake(exec: SqlExecutor, scope: SearchScope): Promise<SearchPage> {
  if (scope.kinds.length === 0) {
    return Promise.resolve({ hits: [], capped: [] });
  }
  return inReadOnlyTransaction(exec, { timeoutMs: scope.timeoutMs }, async () => {
    const { rows } = await exec.query<HitRow | EmptyPageRow>(SEARCH_STATEMENT, [
      scope.q,
      scope.tenantId,
      scope.limit + 1,
      scope.offset,
      scope.caps.record,
      scope.caps.document,
      scope.kinds,
    ]);
    // An empty page is still one row -- the `capped` row with nothing joined to it -- so the
    // cut is reported when there is nothing left to show, which is exactly when it matters.
    // No row at all contradicts the statement, and is refused rather than read as "not cut".
    const [first] = rows;
    if (first === undefined) {
      throw new Error("the search answered no row, though its `capped` row is always there");
    }
    return {
      hits: rows.flatMap((row) => (isHit(row) ? [toHit(row)] : [])),
      capped: first.capped,
    };
  });
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
