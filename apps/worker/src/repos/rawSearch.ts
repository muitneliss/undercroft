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
 * cannot change -- shows it one customer's rows. The explicit `tenant_id = $2` beside it is
 * belt and braces and a hint to the planner, not the boundary; deleting it would not widen what
 * a login can read, and it is written out so that a reader does not have to take that on faith.
 *
 * The matching, folding and excerpting are `raw.*` functions from `190_raw_search.sql`, not
 * expressions written here: the index is built on those functions, and an expression spelled a
 * second way in application code is an index that quietly stops being used.
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
}

interface HitRow {
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

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

/**
 * A record's payload is searched by value and excerpted from its text form.
 *
 * The excerpt therefore carries the JSON punctuation around the match -- `"deal_name":"Hợp đồng
 * thuê nhà"` rather than the sentence alone. That is information, not noise: it names the field
 * the match was in, which for a record is most of what a reader wants to know.
 *
 * `rank` is `::float8`, so it arrives as a number. The pinned `numeric`/`int8` parsers answer in
 * strings to keep MONEY out of floats (`.claude/rules/money.md`); a relevance score is an
 * ordering key and nothing else, and the cast says so at the one place it happens.
 */
const RECORD_BRANCH = `
  SELECT 'record'::text           AS kind,
         r.source                 AS source,
         r.entity                 AS entity,
         r.source_record_id       AS id,
         ts_rank_cd(raw.record_tsv(r.payload), raw.search_query($1))::float8 AS rank,
         raw.search_excerpt(r.payload::text, $1) AS excerpt,
         r.observed_at            AS observed_at,
         r.deleted_at             AS deleted_at,
         NULL::text               AS method,
         NULL::boolean            AS truncated
  FROM raw.records r
  WHERE r.tenant_id = $2
    AND raw.record_tsv(r.payload) @@ raw.search_query($1)`;

/**
 * A document is matched on its extracted text and dated by the catalogue row beside it.
 *
 * LEFT JOIN, and `coalesce` to `extracted_at`: a text row whose catalogue entry has gone would
 * otherwise vanish from the results entirely. The date would be missing, which is a smaller
 * wrong than the hit being missing, and `extracted_at` is a real instant rather than a guess.
 */
const DOCUMENT_BRANCH = `
  SELECT 'document'::text         AS kind,
         t.source                 AS source,
         NULL::text               AS entity,
         t.document_id            AS id,
         ts_rank_cd(raw.search_tsv(t.text), raw.search_query($1))::float8 AS rank,
         raw.search_excerpt(t.text, $1) AS excerpt,
         coalesce(d.observed_at, t.extracted_at) AS observed_at,
         d.deleted_at             AS deleted_at,
         t.method                 AS method,
         t.truncated              AS truncated
  FROM raw.document_text t
  LEFT JOIN raw.documents d
         ON d.source = t.source AND d.tenant_id = t.tenant_id AND d.document_id = t.document_id
  WHERE t.tenant_id = $2
    AND raw.search_tsv(t.text) @@ raw.search_query($1)`;

/**
 * One page of hits, best match first.
 *
 * `rank DESC` orders WITHIN a kind honestly; ACROSS the two it is a heuristic, because
 * `ts_rank_cd` over a short JSON payload and over twenty pages of contract are not measuring the
 * same thing. The remaining three keys are there so that the order is TOTAL: without them
 * `OFFSET` counts against an order Postgres is free to vary, and a hit can appear on two pages
 * or on neither.
 *
 * Asks for `limit + 1` so the caller can say the page was cut rather than infer it from a full
 * one -- "twenty hits" and "twenty of many" are different answers to "is what I want in here".
 */
export function searchLake(exec: SqlExecutor, scope: SearchScope): Promise<RawSearchHit[]> {
  const branches: string[] = [];
  if (scope.kinds.includes("record")) {
    branches.push(RECORD_BRANCH);
  }
  if (scope.kinds.includes("document")) {
    branches.push(DOCUMENT_BRANCH);
  }
  if (branches.length === 0) {
    return Promise.resolve([]);
  }
  return inReadOnlyTransaction(exec, { timeoutMs: scope.timeoutMs }, async () => {
    const { rows } = await exec.query<HitRow>(
      `${branches.join("\n  UNION ALL\n")}
       ORDER BY rank DESC, kind, source, id
       LIMIT $3 OFFSET $4`,
      [scope.q, scope.tenantId, scope.limit + 1, scope.offset],
    );
    return rows.map(toHit);
  });
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
