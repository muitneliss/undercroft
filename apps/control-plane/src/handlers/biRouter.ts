/**
 * The `bi` procedures.
 *
 * Split from `router.ts`, which had grown past what one file may be. Same layer and the
 * same rules: validate the input, call one service, decide what its answer means over HTTP.
 */

import { TRPCError } from "@trpc/server";
import { answerRefusal, answerSaved, notRun } from "./answers.ts";
import {
  ChartConfig,
  DashboardFilters,
  DashboardLayout,
  MAX_QUERY_ROWS,
  ModelName,
  QueryParams,
  QuestionDefinition,
} from "@undercroft/contracts";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import { outranks } from "../services/authz.ts";
import * as bi from "../services/bi.ts";
import * as biExports from "../services/biExports.ts";
import { exportPath, exportUrl } from "./exportLink.ts";
import { actorOf, requireRole, router, tenantProcedure } from "./trpc.ts";

/** What an export is of: a saved question, a definition as `bi.answer` takes one, or a model. */
const ExportSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("question"), questionId: z.string().uuid() }),
  z.object({ kind: z.literal("definition"), definition: QuestionDefinition }),
  z.object({ kind: z.literal("model"), model: ModelName }),
]);

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
          actor: actorOf(ctx),
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
          actor: actorOf(ctx),
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
          actor: actorOf(ctx),
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
          actor: actorOf(ctx),
        });
        if (!removed) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { ok: true };
      }),
  }),

  exports: router({
    /**
     * Ask for every row of a saved question, a definition or a model as a CSV file (ADR 0111),
     * answered with a link good for fifteen minutes to the person who asked. Everything a
     * procedure decides is decided here -- who may, which SQL -- and the download only finds it.
     * A saved question is any member's to export, as its answer is; a definition or a model is
     * SQL an author chooses, so a member's. A READ for the grant: it reads, and the row it keeps
     * is the asking, not data.
     */
    create: tenantProcedure
      .input(z.object({ source: ExportSource, params: QueryParams.default({}) }))
      .mutation(async ({ ctx, input }) => {
        const t = messages(ctx.locale);
        if (biExports.exportNeedsMember(input.source.kind) && !outranks(ctx.role, "member")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: t("error.requiresRole", { role: "member" }),
          });
        }
        const outcome = await biExports.createExport(ctx.exec, {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          actor: actorOf(ctx),
          source: input.source,
          params: input.params,
          unnamed: t("export.unnamed"),
        });
        if (!outcome.ok) {
          if (outcome.reason === "param-missing") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: t("error.paramMissing", { name: outcome.param }),
            });
          }
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const { id, fileName, expiresAt } = outcome.export;
        const path = exportPath(ctx.tenantId, id);
        return { id, fileName, expiresAt, path, url: exportUrl(ctx.publicUrl, path) };
      }),

    /**
     * One export the caller asked for, while it lives: what it runs and what its file is called.
     * The download reads it through this procedure, so the tenant's gates, the grant and the role
     * an export needs are asked again at the moment the rows are taken. Anyone else's export, and
     * an expired one, is NOT_FOUND.
     */
    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const found = await biExports.openExport(ctx.exec, {
          tenantId: ctx.tenantId,
          id: input.id,
          userId: ctx.user.userId,
        });
        if (found === null) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (biExports.exportNeedsMember(found.kind) && !outranks(ctx.role, "member")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: messages(ctx.locale)("error.requiresRole", { role: "member" }),
          });
        }
        return found;
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
      throw notRun(ctx.locale, outcome.reason, "error.queryNotRun");
    }
    return outcome.value;
  }),
});
