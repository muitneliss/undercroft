/**
 * The raw lake division's API: what landed, the rows themselves, and a reader's own SQL.
 *
 * Its own file for the reason `biRouter` and `modelsRouter` have theirs -- `router.ts` is the
 * table of contents, not the procedures -- and because the three tiers of authority here are
 * worth reading in one place: a summary every member may see, and rows and a console only a
 * holder of `lake:read` may page or write (builder and admin, ADR 0139).
 */

import { TRPCError } from "@trpc/server";
import {
  DEFAULT_QUERY_ROWS,
  DEFAULT_SEARCH_HITS,
  MAX_QUERY_ROWS,
  MAX_QUERY_SQL_BYTES,
  MAX_SEARCH_HITS,
  MAX_SEARCH_QUERY_CHARS,
  SearchKind,
} from "@undercroft/contracts";
import { z } from "zod";

import { messages } from "../i18n/index.ts";
import * as lake from "../services/lake.ts";
import { notRun } from "./answers.ts";
import { SchemaFilterInput, schemaOrRefusal } from "./schemaFilter.ts";
import { requirePermission } from "./permissionGate.ts";
import { router, tenantProcedure } from "./trpc.ts";

export const lakeRouter = router({
  /**
   * What has landed, per stream: counts and freshness, nothing a person wrote. Every
   * member may read it; it is the Lake division's first screen.
   */
  summary: tenantProcedure.query(({ ctx, input }) => lake.summary(ctx.exec, input.tenantId)),

  /**
   * The rows themselves, for `lake:read` only: a payload is the source's data verbatim, and for
   * a CRM or a mailbox that is names and addresses. The permission gate is the whole of the
   * decision; the service only pages.
   *
   * `runId` narrows the page to the rows that run wrote and still names, and answers beside it
   * how many it wrote that a later run has since rewritten (`ofRun`, ADR 0091): what a run's
   * counts open onto from its leaf. The gate is unchanged -- the same rows, fewer of them.
   */
  records: requirePermission("lake:read")
    .input(
      z.object({
        source: z.string().trim().min(1).max(64),
        entity: z.string().trim().min(1).max(128),
        limit: z.number().int().min(1).max(50).default(50),
        cursor: z.string().optional(),
        runId: z.string().trim().min(1).max(128).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      lake.records(ctx.exec, ctx.tenantId, {
        source: input.source,
        entity: input.entity,
        limit: input.limit,
        cursor: input.cursor ?? null,
        runId: input.runId ?? null,
      }),
    ),

  documents: requirePermission("lake:read")
    .input(
      z.object({
        source: z.string().trim().min(1).max(64),
        limit: z.number().int().min(1).max(50).default(50),
        cursor: z.string().optional(),
        runId: z.string().trim().min(1).max(128).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      lake.documents(ctx.exec, ctx.tenantId, {
        source: input.source,
        limit: input.limit,
        cursor: input.cursor ?? null,
        runId: input.runId ?? null,
      }),
    ),

  /**
   * One SELECT over the raw lake, written by its reader, answered as the tenant's dbt login.
   *
   * `lake:read`, for the same reason `records` and `documents` are: a raw payload is the
   * source's data verbatim. What is different here is only that the reader chooses the shape
   * of the answer instead of paging a fixed one.
   *
   * The dbt login is the one that may read `raw`; the BI login behind `bi.answer` cannot,
   * and that stays true. A write is refused by the read-only transaction the worker frames
   * every query in, before any grant is consulted -- which matters because the dbt login
   * CAN create in its own two schemas. `queryRunner.runRawQuery`.
   */
  query: requirePermission("lake:read")
    .input(
      z.object({
        sql: z.string().trim().min(1).max(MAX_QUERY_SQL_BYTES),
        limit: z.number().int().min(1).max(MAX_QUERY_ROWS).default(DEFAULT_QUERY_ROWS),
        /**
         * Rows to skip. Paging is the CONSOLE's, not the author's: a reader who wrote no
         * LIMIT still gets one page at a time rather than every row the query matched, which
         * is what keeps a `SELECT * FROM records` from carrying a tenant's whole lake over
         * the wire and into a browser.
         */
        offset: z.number().int().min(0).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.worker === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: messages(ctx.locale)("error.workerUnavailable"),
        });
      }
      const outcome = await ctx.worker.runRawQuery({
        tenantId: ctx.tenantId,
        sql: input.sql,
        limit: input.limit,
        offset: input.offset,
      });
      if (!outcome.ok) {
        // Postgres's own sentence about the author's SQL is what lets them fix it, and it
        // quotes their text and nothing else. Every other refusal is a precondition.
        if (outcome.reason === "query-failed") {
          // The same wording the Reports console uses for the same refusal, from the
          // catalogue rather than written here -- `i18n.md`.
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: messages(ctx.locale)("error.queryFailed", {
              message: outcome.message ?? "",
            }),
          });
        }
        throw notRun(ctx.locale, outcome.reason, "error.queryNotRun");
      }
      return outcome.value;
    }),

  /**
   * One question over the whole of the tenant's raw lake, in Vietnamese or English.
   *
   * `lake:read`, for the same reason `records` and `documents` are and one sharper: a hit
   * carries an excerpt of what a source actually said, and for a scanned contract that is
   * whatever the contract says. It reaches the text through the tenant's dbt login at the
   * worker, not through this process -- the control plane is still denied that column, and a
   * reader admitted here could have written the same SELECT in the console beside it.
   * ADR 0026, which made it admin-only; ADR 0139 opened it to `lake:read`, which is exactly the
   * set of people the console beside it already admits.
   */
  search: requirePermission("lake:read")
    .input(
      z.object({
        q: z.string().trim().min(1).max(MAX_SEARCH_QUERY_CHARS),
        kinds: z.array(SearchKind).nonempty().optional(),
        limit: z.number().int().min(1).max(MAX_SEARCH_HITS).default(DEFAULT_SEARCH_HITS),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (ctx.worker === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: messages(ctx.locale)("error.workerUnavailable"),
        });
      }
      const outcome = await lake.search(ctx.worker, ctx.tenantId, {
        q: input.q,
        ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
        limit: input.limit,
        offset: input.offset,
      });
      if (!outcome.ok) {
        // A search that ran into its time limit is the reader's to fix -- by narrowing it --
        // so it is BAD_REQUEST, which every door words as "change the input", and never the
        // "did not answer; try again" below, which sent agents round the same query (#447).
        if (outcome.reason === "timed-out") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: messages(ctx.locale)("error.searchTimedOut"),
          });
        }
        // No `query-failed` branch: there is no author's SQL here for Postgres to have an
        // opinion about. Any other search that did not run is a precondition, like every
        // other refusal from a worker that answered.
        throw notRun(ctx.locale, outcome.reason, "error.searchNotRun");
      }
      return outcome.value;
    }),

  /**
   * The `raw` schema's tables and columns: the console's sidebar. `lake:read`, as above.
   * Narrowed to the named or matching tables when asked, by the rule `bi.schema` uses.
   */
  querySchema: requirePermission("lake:read")
    .input(SchemaFilterInput)
    .query(async ({ ctx, input }) => {
      if (ctx.worker === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: messages(ctx.locale)("error.workerUnavailable"),
        });
      }
      const { tenantId, ...filter } = input;
      return schemaOrRefusal(ctx.locale, await lake.querySchema(ctx.worker, tenantId, filter));
    }),
});
