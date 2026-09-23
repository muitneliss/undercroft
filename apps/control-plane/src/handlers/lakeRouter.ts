/**
 * The raw lake division's API: what landed, the rows themselves, and an admin's own SQL.
 *
 * Its own file for the reason `biRouter` and `modelsRouter` have theirs -- `router.ts` is the
 * table of contents, not the procedures -- and because the three tiers of authority here are
 * worth reading in one place: a summary every member may see, rows only an admin may page,
 * and a console only an admin may write.
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
import { requireRole, router, tenantProcedure } from "./trpc.ts";

export const lakeRouter = router({
  /**
   * What has landed, per stream: counts and freshness, nothing a person wrote. Every
   * member may read it; it is the Lake division's first screen.
   */
  summary: tenantProcedure.query(({ ctx, input }) => lake.summary(ctx.exec, input.tenantId)),

  /**
   * The rows themselves, admin-only: a payload is the source's data verbatim, and for a
   * CRM or a mailbox that is names and addresses. The role gate is the whole of the
   * decision; the service only pages.
   */
  records: requireRole("admin")
    .input(
      z.object({
        source: z.string().trim().min(1).max(64),
        entity: z.string().trim().min(1).max(128),
        limit: z.number().int().min(1).max(50).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      lake.records(ctx.exec, ctx.tenantId, {
        source: input.source,
        entity: input.entity,
        limit: input.limit,
        cursor: input.cursor ?? null,
      }),
    ),

  documents: requireRole("admin")
    .input(
      z.object({
        source: z.string().trim().min(1).max(64),
        limit: z.number().int().min(1).max(50).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      lake.documents(ctx.exec, ctx.tenantId, {
        source: input.source,
        limit: input.limit,
        cursor: input.cursor ?? null,
      }),
    ),

  /**
   * One SELECT over the raw lake, written by an admin, answered as the tenant's dbt login.
   *
   * ADMIN-ONLY, and for the same reason `records` and `documents` are: a raw payload is
   * the source's data verbatim. What is different here is only that the admin chooses the
   * shape of the answer instead of paging a fixed one.
   *
   * The dbt login is the one that may read `raw`; the BI login behind `bi.answer` cannot,
   * and that stays true. A write is refused by the read-only transaction the worker frames
   * every query in, before any grant is consulted -- which matters because the dbt login
   * CAN create in its own two schemas. `queryRunner.runRawQuery`.
   */
  query: requireRole("admin")
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
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: messages(ctx.locale)("error.queryNotRun"),
        });
      }
      return outcome.value;
    }),

  /**
   * One question over the whole of the tenant's raw lake, in Vietnamese or English.
   *
   * ADMIN-ONLY, for the same reason `records` and `documents` are and one sharper: a hit
   * carries an excerpt of what a source actually said, and for a scanned contract that is
   * whatever the contract says. It reaches the text through the tenant's dbt login at the
   * worker, not through this process -- the control plane is still denied that column, and a
   * reader admitted here could have written the same SELECT in the console beside it.
   * ADR 0026.
   */
  search: requireRole("admin")
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
        // No `query-failed` branch: there is no author's SQL here for Postgres to have an
        // opinion about. A search that did not run is a precondition, like every other
        // refusal from a worker that answered.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: messages(ctx.locale)("error.searchNotRun"),
        });
      }
      return outcome.value;
    }),

  /** The `raw` schema's tables and columns: the console's sidebar. Admin-only, as above. */
  querySchema: requireRole("admin").query(async ({ ctx, input }) => {
    if (ctx.worker === null) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: messages(ctx.locale)("error.workerUnavailable"),
      });
    }
    const outcome = await ctx.worker.readRawSchema({ tenantId: input.tenantId });
    if (!outcome.ok) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: messages(ctx.locale)("error.queryNotRun"),
      });
    }
    return outcome.value;
  }),
});
