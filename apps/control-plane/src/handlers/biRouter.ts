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
  ModelName,
  QueryParams,
  QuestionDefinition,
} from "@undercroft/contracts";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import { holds } from "../services/authz.ts";
import * as bi from "../services/bi.ts";
import * as questions from "../services/biQuestions.ts";
import * as biExports from "../services/biExports.ts";
import { exportPath, exportUrl } from "./exportLink.ts";
import { listingOrRefusal, NameFilterInput, PageInput } from "./listInputs.ts";
import { SchemaFilterInput, schemaOrRefusal } from "./schemaFilter.ts";
import { permissionRefusal, requirePermission } from "./permissionGate.ts";
import { actorOf, router, tenantProcedure } from "./trpc.ts";

/** What an export is of: a saved question, a definition as `bi.answer` takes one, or a model. */
const ExportSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("question"), questionId: z.string().uuid() }),
  z.object({ kind: z.literal("definition"), definition: QuestionDefinition }),
  z.object({ kind: z.literal("model"), model: ModelName }),
]);

export const biRouter = router({
  /**
   * Answer a definition -- the builder's or raw SQL -- as the tenant's read-only login,
   * through the worker. `reports:author` authors (member, builder, admin); a viewer's reads come through saved
   * questions. A query that did not run is BAD_REQUEST carrying Postgres's own sentence,
   * because that sentence is what lets the author fix it; so is a parameter with no value.
   */
  answer: requirePermission("reports:author")
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
      const outcome = await bi.answer(ctx.exec, ctx.worker, {
        tenantId: ctx.tenantId,
        definition: input.definition,
        params: input.params,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        reach: ctx.reach,
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
  compile: requirePermission("reports:author")
    .input(z.object({ definition: QuestionDefinition }))
    .query(({ input }) => ({ sql: bi.compileDefinition(input.definition) })),

  questions: router({
    /**
     * The saved questions as summaries -- kind, chart type, the definition's hash -- and no SQL.
     * `include` adds the `definition` or the `chart` in full, which a dashboard's tiles need.
     * `limit` or `cursor` answers a page, `{ items, nextCursor }`, rather than the array (ADR 0133).
     */
    list: tenantProcedure
      .input(
        z.object({
          ...NameFilterInput,
          ...PageInput,
          include: z
            .array(z.enum(["definition", "chart"]))
            .min(1)
            .optional(),
        }),
      )
      .query(async ({ ctx, input }) =>
        listingOrRefusal(
          ctx.locale,
          "bi.questions.list",
          await questions.listQuestionViews(ctx.exec, input.tenantId, ctx.reach, input),
        ),
      ),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const question = await questions.getQuestionView(
          ctx.exec,
          input.tenantId,
          input.id,
          ctx.reach,
        );
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

    /** Store a question. Executes nothing; needs `reports:author`, which a viewer lacks. */
    save: requirePermission("reports:author")
      .input(
        z.object({
          id: z.string().uuid().optional(),
          name: z.string().trim().min(1).max(120),
          definition: QuestionDefinition,
          chart: ChartConfig,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const outcome = await questions.saveQuestion(ctx.exec, {
          tenantId: ctx.tenantId,
          ...(input.id === undefined ? {} : { id: input.id }),
          name: input.name,
          definition: input.definition,
          chart: input.chart,
          actor: actorOf(ctx),
          actorId: ctx.user.userId,
          reach: ctx.reach,
        });
        if (!outcome.ok) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { id: outcome.id };
      }),

    delete: requirePermission("reports:author")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const removed = await questions.removeQuestion(ctx.exec, {
          tenantId: ctx.tenantId,
          id: input.id,
          actor: actorOf(ctx),
          reach: ctx.reach,
        });
        if (!removed) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { ok: true };
      }),
  }),

  dashboards: router({
    list: tenantProcedure.query(({ ctx, input }) =>
      bi.listDashboardViews(ctx.exec, input.tenantId, ctx.reach),
    ),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const dashboard = await bi.getDashboardView(ctx.exec, input.tenantId, input.id, ctx.reach);
        if (dashboard === null) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return dashboard;
      }),

    save: requirePermission("reports:author")
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
          reach: ctx.reach,
        });
        if (!outcome.ok) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { id: outcome.id };
      }),

    delete: requirePermission("reports:author")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const removed = await bi.removeDashboard(ctx.exec, {
          tenantId: ctx.tenantId,
          id: input.id,
          actor: actorOf(ctx),
          reach: ctx.reach,
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
     * SQL an author chooses, so it needs `reports:author` -- checked here rather than by
     * `requirePermission`, because which it needs depends on the input. A READ for the grant: it reads, and the row it keeps
     * is the asking, not data.
     */
    create: tenantProcedure
      .input(z.object({ source: ExportSource, params: QueryParams.default({}) }))
      .mutation(async ({ ctx, input }) => {
        const t = messages(ctx.locale);
        if (biExports.exportNeedsAuthor(input.source.kind) && !holds(ctx, "reports:author")) {
          throw permissionRefusal(ctx, "reports:author");
        }
        const outcome = await biExports.createExport(ctx.exec, {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          actor: actorOf(ctx),
          source: input.source,
          params: input.params,
          unnamed: t("export.unnamed"),
          reach: ctx.reach,
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
     * The download reads it through this procedure, so the tenant's gates, the grant and the permission
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
          reach: ctx.reach,
        });
        if (found === null) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (biExports.exportNeedsAuthor(found.kind) && !holds(ctx, "reports:author")) {
          throw permissionRefusal(ctx, "reports:author");
        }
        return found;
      }),
  }),

  /**
   * The tables and columns a question can name. Any member may read the shape. Narrowed to
   * the named or matching tables when asked (`schemaFilter.ts`), since the whole of a large
   * tenant's schema is more than an agent's client will hold (issue 443).
   */
  schema: tenantProcedure.input(SchemaFilterInput).query(async ({ ctx, input }) => {
    if (ctx.worker === null) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: messages(ctx.locale)("error.workerUnavailable"),
      });
    }
    const { tenantId, ...filter } = input;
    return schemaOrRefusal(
      ctx.locale,
      await bi.schema(ctx.worker, { tenantId, reach: ctx.reach }, filter),
    );
  }),
});
