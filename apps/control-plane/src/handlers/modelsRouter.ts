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

  delete: requireRole("admin")
    .input(z.object({ name: ModelName }))
    .mutation(async ({ ctx, input }) => {
      const removed = await models.remove(ctx.exec, {
        tenantId: ctx.tenantId,
        name: input.name,
        actor: ctx.user.email,
      });
      if (!removed) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { ok: true };
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
        throw new TRPCError({
          code: outcome.reason === "in-progress" ? "CONFLICT" : "PRECONDITION_FAILED",
          message: messages(ctx.locale)(
            outcome.reason === "in-progress" ? "error.buildInProgress" : "error.buildNotStarted",
          ),
        });
      }
      return outcome.value;
    }),

  /** The sources and macros every project carries, for the editor's reference panel. */
  reference: tenantProcedure.query(() => models.reference()),
});
