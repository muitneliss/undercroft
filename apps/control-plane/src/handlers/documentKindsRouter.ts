/**
 * The `documentKinds` procedures: a tenant's catalogue of document kinds. ADR 0085.
 *
 * Any member may read the catalogue and what publishing it would cost; only an admin may change
 * it or publish it, because a publish sends every text to the classifier again. Same layer and
 * rules as the other routers: validate, call one service, decide what its answer means.
 */

import { TRPCError } from "@trpc/server";
import { DocumentKindDescription, DocumentKindName } from "@undercroft/contracts";
import { z } from "zod";

import { messages } from "../i18n/index.ts";
import * as documentKinds from "../services/documentKinds.ts";
import { requireRole, router, tenantProcedure } from "./trpc.ts";

export const documentKindsRouter = router({
  list: tenantProcedure.query(({ ctx, input }) => documentKinds.list(ctx.exec, input.tenantId)),

  add: requireRole("admin")
    .input(z.object({ kind: DocumentKindName, description: DocumentKindDescription.optional() }))
    .mutation(async ({ ctx, input }) => {
      const outcome = await documentKinds.add(ctx.exec, {
        tenantId: ctx.tenantId,
        actor: ctx.user.email,
        actorId: ctx.user.userId,
        kind: input.kind,
        description: input.description ?? null,
      });
      if (!outcome.ok) {
        const say = messages(ctx.locale);
        throw outcome.reason === "exists"
          ? new TRPCError({
              code: "CONFLICT",
              message: say("error.documentKindExists", { kind: input.kind }),
            })
          : new TRPCError({
              code: "BAD_REQUEST",
              message: say("error.documentKindNeedsDescription", { kind: input.kind }),
            });
      }
      return { ok: true };
    }),

  update: requireRole("admin")
    .input(z.object({ kind: DocumentKindName, description: DocumentKindDescription }))
    .mutation(async ({ ctx, input }) => {
      const outcome = await documentKinds.update(ctx.exec, {
        tenantId: ctx.tenantId,
        actor: ctx.user.email,
        actorId: ctx.user.userId,
        kind: input.kind,
        description: input.description,
      });
      if (!outcome.ok) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { ok: true };
    }),

  remove: requireRole("admin")
    .input(z.object({ kind: DocumentKindName }))
    .mutation(async ({ ctx, input }) => {
      const outcome = await documentKinds.remove(ctx.exec, {
        tenantId: ctx.tenantId,
        actor: ctx.user.email,
        actorId: ctx.user.userId,
        kind: input.kind,
      });
      if (!outcome.ok) {
        throw outcome.reason === "required"
          ? new TRPCError({
              code: "BAD_REQUEST",
              message: messages(ctx.locale)("error.documentKindRequired", { kind: input.kind }),
            })
          : new TRPCError({ code: "NOT_FOUND" });
      }
      return { ok: true };
    }),

  /**
   * Draw the first catalogue from a sample, as a worker run, and answer with its id to watch.
   * Nothing is published: the admin reviews what was kept, then publishes.
   */
  initialise: requireRole("admin").mutation(async ({ ctx }) => {
    const say = messages(ctx.locale);
    if (ctx.worker === null) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: say("error.documentKindsNotStarted"),
      });
    }
    const outcome = await documentKinds.initialise(ctx.exec, ctx.worker, {
      tenantId: ctx.tenantId,
      actor: ctx.user.email,
      actorId: ctx.user.userId,
    });
    if (outcome.ok) {
      return { runId: outcome.runId };
    }
    switch (outcome.reason) {
      case "exists":
        throw new TRPCError({ code: "CONFLICT", message: say("error.documentKindsExist") });
      case "in-progress":
        throw new TRPCError({ code: "CONFLICT", message: say("error.documentKindsInitialising") });
      case "not-configured":
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: say("error.semanticNotConfigured"),
        });
      default:
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: say("error.documentKindsNotStarted"),
        });
    }
  }),

  /** Publish the draft as the version the worker classifies against. */
  publish: requireRole("admin").mutation(async ({ ctx }) => {
    const outcome = await documentKinds.publish(ctx.exec, {
      tenantId: ctx.tenantId,
      actor: ctx.user.email,
      actorId: ctx.user.userId,
    });
    if (!outcome.ok) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: messages(ctx.locale)("error.documentKindsEmpty"),
      });
    }
    return { version: outcome.version, changed: outcome.changed };
  }),
});
