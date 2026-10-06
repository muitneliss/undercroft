/**
 * The `models` procedures.
 *
 * Split from `router.ts`, which had grown past what one file may be. Same layer and the
 * same rules: validate the input, call one service, decide what its answer means over HTTP.
 */

import { TRPCError } from "@trpc/server";
import { MAX_MODEL_SQL_BYTES, ModelName, ModelTests } from "@undercroft/contracts";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import * as models from "../services/models.ts";
import { notRun } from "./answers.ts";
import { wordCheck } from "./checkWords.ts";
import { requireRole, router, tenantProcedure } from "./trpc.ts";

export const modelsRouter = router({
  /** The tenant's models with their last build. Any member may read what is built for them. */
  list: tenantProcedure.query(({ ctx, input }) => models.list(ctx.exec, input.tenantId)),

  get: tenantProcedure.input(z.object({ name: ModelName })).query(async ({ ctx, input }) => {
    const model = await models.get(ctx.exec, input.tenantId, input.name);
    if (model === null) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return model;
  }),

  /**
   * Store a model. Executes nothing: Build is the worker's verb, chosen separately, so a
   * saved mistake is a row and not a broken table. Admin-only, like every write that
   * changes what a customer's dashboards will show.
   */
  save: requireRole("admin")
    .input(
      z.object({
        name: ModelName,
        sql: z.string().max(MAX_MODEL_SQL_BYTES),
        tests: ModelTests,
        create: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const outcome = await models.save(ctx.exec, {
        tenantId: ctx.tenantId,
        name: input.name,
        sql: input.sql,
        tests: input.tests,
        create: input.create,
        actor: ctx.user.email,
        actorId: ctx.user.userId,
      });
      if (!outcome.ok) {
        throw new TRPCError({
          code: "CONFLICT",
          message: messages(ctx.locale)("error.modelNameTaken", { name: input.name }),
        });
      }
      return { ok: true };
    }),

  /**
   * Delete a model and drop what it built, or do neither (ADR 0077). Without a worker nothing
   * can drop the tables, so nothing is deleted: a "deleted" over data still readable is the
   * one answer this must never give. A build running and a model another one reads from are
   * CONFLICTs the person can act on; a worker that did not drop is a precondition they cannot.
   */
  delete: requireRole("admin")
    .input(z.object({ name: ModelName }))
    .mutation(async ({ ctx, input }) => {
      const t = messages(ctx.locale);
      if (ctx.worker === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: t("error.modelNotDeleted", { name: input.name }),
        });
      }
      const outcome = await models.remove(ctx.exec, ctx.worker, {
        tenantId: ctx.tenantId,
        name: input.name,
        actor: ctx.user.email,
      });
      if (outcome.ok) {
        return { ok: true };
      }
      switch (outcome.reason) {
        case "not-found":
          throw new TRPCError({ code: "NOT_FOUND" });
        case "in-progress":
          throw new TRPCError({ code: "CONFLICT", message: t("error.buildInProgress") });
        case "depended-on":
          throw new TRPCError({
            code: "CONFLICT",
            message: t("error.modelDependedOn", {
              name: input.name,
              dependents: outcome.dependents.join(", "),
            }),
          });
        default:
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: t("error.modelNotDeleted", { name: input.name }),
          });
      }
    }),

  /**
   * Build one model and wait for the answer. Admin-only like save: a build creates the
   * table a dashboard reads. A build already running for the tenant is a CONFLICT the
   * person can act on; a worker that did not answer is a precondition they cannot.
   */
  build: requireRole("admin")
    .input(z.object({ name: ModelName }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.worker === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: messages(ctx.locale)("error.buildNotStarted"),
        });
      }
      const outcome = await models.build(ctx.exec, ctx.worker, {
        tenantId: ctx.tenantId,
        name: input.name,
        actor: ctx.user.email,
        actorId: ctx.user.userId,
      });
      if (!outcome.ok) {
        if (outcome.reason === "in-progress") {
          throw new TRPCError({
            code: "CONFLICT",
            message: messages(ctx.locale)("error.buildInProgress"),
          });
        }
        throw notRun(ctx.locale, outcome.reason, "error.buildNotStarted");
      }
      return outcome.value;
    }),

  /**
   * Check a model's SQL, running nothing. Any member may: it tells an author about a mistake
   * while it is still text, and the model-builder skill runs it before every save. Advisory,
   * never a gate on `save` -- the editor's promise is that a saved mistake is a row, not a
   * broken table. Each finding and each thing it could not verify comes back worded.
   */
  check: tenantProcedure
    .input(
      z.object({
        name: ModelName,
        sql: z.string().max(MAX_MODEL_SQL_BYTES),
        tests: ModelTests,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const checked = await models.check(ctx.exec, {
        tenantId: ctx.tenantId,
        name: input.name,
        sql: input.sql,
        tests: input.tests,
      });
      return wordCheck(ctx.locale, checked);
    }),

  /**
   * What each model declares it reads: other models by `ref()`, raw lake tables by
   * `source()`, through any macro it calls. Any member may, as they may read the models it is
   * read from. Declared relations only (ADR 0092): a model whose upstream its text cannot
   * show carries why, and a ref to a deleted model stays as a missing dependency.
   */
  lineage: tenantProcedure.query(({ ctx, input }) => models.lineage(ctx.exec, input.tenantId)),

  /**
   * The sources and macros every project carries, and the tenant's own macros, for the
   * editor's reference panel and for an agent choosing what to call.
   */
  reference: tenantProcedure.query(({ ctx, input }) => models.reference(ctx.exec, input.tenantId)),
});
