/**
 * The `bi` procedures.
 *
 * Split from `router.ts`, which had grown past what one file may be. Same layer and the
 * same rules: validate the input, call one service, decide what its answer means over HTTP.
 */

import { TRPCError } from "@trpc/server";
import { answerRefusal, answerSaved } from "./answers.ts";
import {
  ChartConfig,
  DashboardFilters,
  DashboardLayout,
  MAX_QUERY_ROWS,
  QueryParams,
  QuestionDefinition,
} from "@undercroft/contracts";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import * as bi from "../services/bi.ts";
import { requireRole, router, tenantProcedure } from "./trpc.ts";

export const biRouter = router({
  /**
   * Answer a definition -- the builder's or raw SQL -- as the tenant's read-only login,
   * through the worker. Members and admins author; a viewer's reads come through saved
   * questions. A query that did not run is BAD_REQUEST carrying Postgres's own sentence,
   * because that sentence is what lets the author fix it; so is a parameter with no value.
   */
  answer: requireRole("member")
    .input(
      z.object({
        definition: QuestionDefinition,
        params: QueryParams.default({}),
        limit: z.number().int().min(1).max(MAX_QUERY_ROWS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.worker === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: messages(ctx.locale)("error.workerUnavailable"),
        });
      }
      const outcome = await bi.answer(ctx.worker, {
        tenantId: ctx.tenantId,
        definition: input.definition,
        params: input.params,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      });
      if (!outcome.ok) {
        throw answerRefusal(ctx.locale, outcome);
      }
      return outcome.value;
    }),

  /** Answer a saved question. Any member of the tenant: the question was saved for them. */
  runQuestion: tenantProcedure
    .input(z.object({ questionId: z.string().uuid(), params: QueryParams.default({}) }))
    .mutation(({ ctx, input }) =>
      answerSaved(ctx, {
        tenantId: input.tenantId,
        questionId: input.questionId,
        params: input.params,
      }),
    ),

  /** What a definition compiles to, for the builder to show beside itself. Pure. */
  compile: requireRole("member")
    .input(z.object({ definition: QuestionDefinition }))
    .query(({ input }) => ({ sql: bi.compileDefinition(input.definition) })),

  questions: router({
    list: tenantProcedure.query(({ ctx, input }) => bi.listQuestionViews(ctx.exec, input.tenantId)),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const question = await bi.getQuestionView(ctx.exec, input.tenantId, input.id);
        if (question === null) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return question;
      }),

    /**
     * A saved question's answer under bound parameters, as a READ. A dashboard's tiles
     * fetch through the query cache keyed on the parameters, so a filter change refetches
     * each tile once and coming back to the dashboard costs nothing. The same answer as
     * `runQuestion`, which stays a mutation for the Run plate on the question's own leaf.
     */
    answer: tenantProcedure
      .input(z.object({ id: z.string().uuid(), params: QueryParams.default({}) }))
      .query(({ ctx, input }) =>
        answerSaved(ctx, {
          tenantId: input.tenantId,
          questionId: input.id,
          params: input.params,
        }),
      ),

    /** Store a question. Executes nothing; a member or an admin, never a viewer. */
    save: requireRole("member")
      .input(
        z.object({
          id: z.string().uuid().optional(),
          name: z.string().trim().min(1).max(120),
          definition: QuestionDefinition,
          chart: ChartConfig,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const outcome = await bi.saveQuestion(ctx.exec, {
          tenantId: ctx.tenantId,
          ...(input.id === undefined ? {} : { id: input.id }),
          name: input.name,
          definition: input.definition,
          chart: input.chart,
          actor: ctx.user.email,
          actorId: ctx.user.userId,
        });
        if (!outcome.ok) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { id: outcome.id };
      }),

    delete: requireRole("member")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const removed = await bi.removeQuestion(ctx.exec, {
          tenantId: ctx.tenantId,
          id: input.id,
          actor: ctx.user.email,
        });
        if (!removed) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { ok: true };
      }),
  }),

  dashboards: router({
    list: tenantProcedure.query(({ ctx, input }) =>
      bi.listDashboardViews(ctx.exec, input.tenantId),
    ),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const dashboard = await bi.getDashboardView(ctx.exec, input.tenantId, input.id);
        if (dashboard === null) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return dashboard;
      }),

    save: requireRole("member")
      .input(
        z.object({
          id: z.string().uuid().optional(),
          name: z.string().trim().min(1).max(120),
          layout: DashboardLayout,
          filters: DashboardFilters,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const outcome = await bi.saveDashboard(ctx.exec, {
          tenantId: ctx.tenantId,
          ...(input.id === undefined ? {} : { id: input.id }),
          name: input.name,
          layout: input.layout,
          filters: input.filters,
          actor: ctx.user.email,
          actorId: ctx.user.userId,
        });
        if (!outcome.ok) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { id: outcome.id };
      }),

    delete: requireRole("member")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const removed = await bi.removeDashboard(ctx.exec, {
          tenantId: ctx.tenantId,
          id: input.id,
          actor: ctx.user.email,
        });
        if (!removed) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { ok: true };
      }),
  }),

  /** The tables and columns a question can name. Any member may read the shape. */
  schema: tenantProcedure.query(async ({ ctx, input }) => {
    if (ctx.worker === null) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: messages(ctx.locale)("error.workerUnavailable"),
      });
    }
    const outcome = await bi.schema(ctx.worker, { tenantId: input.tenantId });
    if (!outcome.ok) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: messages(ctx.locale)("error.queryNotRun"),
      });
    }
    return outcome.value;
  }),
});
