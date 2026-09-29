/**
 * The `macros` procedures: a tenant's own dbt macros. ADR 0086.
 *
 * Any member may read and check them, as they may read and check models; only an admin may
 * save or delete one, because a macro changes what every model calling it builds. Same layer
 * and rules as the other routers: validate, call one service, decide what its answer means.
 */

import { TRPCError } from "@trpc/server";
import { MacroDescription, MacroName, MAX_MACRO_SQL_BYTES } from "@undercroft/contracts";
import { z } from "zod";

import { messages } from "../i18n/index.ts";
import * as macros from "../services/macros.ts";
import { findingSentence, wordCheck } from "./checkWords.ts";
import { requireRole, router, tenantProcedure } from "./trpc.ts";

const definition = z.string().max(MAX_MACRO_SQL_BYTES);

export const macrosRouter = router({
  /** The tenant's macros with what each is for, so a reader can choose one to reuse. */
  list: tenantProcedure.query(({ ctx, input }) => macros.list(ctx.exec, input.tenantId)),

  get: tenantProcedure.input(z.object({ name: MacroName })).query(async ({ ctx, input }) => {
    const macro = await macros.get(ctx.exec, input.tenantId, input.name);
    if (macro === null) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return macro;
  }),

  /**
   * Check a macro's definition, running nothing, as `models.check` checks a model. A POST
   * because a definition does not fit a query string.
   */
  check: tenantProcedure
    .input(z.object({ name: MacroName, sql: definition }))
    .mutation(async ({ ctx, input }) => {
      const checked = await macros.check(ctx.exec, {
        tenantId: ctx.tenantId,
        name: input.name,
        sql: input.sql,
      });
      return wordCheck(ctx.locale, checked);
    }),

  /**
   * Store a macro. Executes nothing. A definition that is not one macro a tenant may have is
   * BAD_REQUEST with the same sentence `macros.check` gives for it; a taken name under
   * `create` is a CONFLICT.
   */
  save: requireRole("admin")
    .input(
      z.object({
        name: MacroName,
        description: MacroDescription,
        sql: definition,
        create: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const outcome = await macros.save(ctx.exec, {
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description,
        sql: input.sql,
        create: input.create,
        actor: ctx.user.email,
        actorId: ctx.user.userId,
      });
      if (outcome.ok) {
        return { ok: true };
      }
      throw outcome.reason === "name-taken"
        ? new TRPCError({
            code: "CONFLICT",
            message: messages(ctx.locale)("error.macroNameTaken", { name: input.name }),
          })
        : new TRPCError({
            code: "BAD_REQUEST",
            message: findingSentence(ctx.locale, outcome.refusal, outcome.subject),
          });
    }),

  /** Delete a macro nothing calls. One a model or another macro calls is a CONFLICT naming them. */
  delete: requireRole("admin")
    .input(z.object({ name: MacroName }))
    .mutation(async ({ ctx, input }) => {
      const outcome = await macros.remove(ctx.exec, {
        tenantId: ctx.tenantId,
        name: input.name,
        actor: ctx.user.email,
      });
      if (outcome.ok) {
        return { ok: true };
      }
      throw outcome.reason === "not-found"
        ? new TRPCError({ code: "NOT_FOUND" })
        : new TRPCError({
            code: "CONFLICT",
            message: messages(ctx.locale)("error.macroDependedOn", {
              name: input.name,
              dependents: outcome.dependents.join(", "),
            }),
          });
    }),
});
