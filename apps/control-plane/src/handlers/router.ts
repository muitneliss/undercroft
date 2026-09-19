import { TRPCError } from "@trpc/server";
import { MAX_PREVIEW_ROWS } from "@undercroft/contracts";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import * as connections from "../services/connections.ts";
import * as keys from "../services/keys.ts";
import * as lake from "../services/lake.ts";
import * as models from "../services/models.ts";
import * as preferences from "../services/preferences.ts";
import * as runs from "../services/runs.ts";
import { authedProcedure, publicProcedure, requireRole, router, tenantProcedure } from "./trpc.ts";

import { connectionsRouter } from "./connectionsRouter.ts";
import { biRouter } from "./biRouter.ts";
import { modelsRouter } from "./modelsRouter.ts";
import { peopleRouter } from "./peopleRouter.ts";
import { tenantsRouter } from "./tenantsRouter.ts";

/**
 * The control-plane API. The React app imports `AppRouter` as a type only, so the client
 * and server can never disagree about a shape -- the hand-mirrored DTO file the Python era
 * needed simply does not exist.
 *
 * Every procedure here is transport: validate the input, call one service, turn what comes
 * back into a tRPC result or a `TRPCError`. No SQL, no repo -- the schema is not the API's
 * business, and the enforcement is `layer-sql-in-repos` and `layer-handler-no-repo`.
 * Which status code a refusal deserves IS this layer's business, and it is why the services
 * return values rather than throwing: `null` here is a 404 only because this file says so.
 */
export const appRouter = router({
  session: router({
    // `superadmin` is here so the SPA can leave out an affordance the caller cannot use --
    // courtesy, never the control. `superadminProcedure` refuses regardless of what the
    // browser chose to render, and this flag answers "am I one" and never "who are they",
    // which is the question that would turn this into a directory of the platform's
    // administrators.
    me: authedProcedure.query(({ ctx }) => ({
      userId: ctx.user.userId,
      email: ctx.user.email,
      superadmin: ctx.superadmin,
    })),

    signOut: authedProcedure.mutation(async ({ ctx }) => {
      // The session row is DELETED, not flagged: the session is gone the instant this
      // returns, so the next request cannot be authenticated by a row that no longer
      // exists. Stronger than the `revoked_at` flag this replaces, and unlike a stateless
      // token it does not stay valid until expiry.
      //
      // Through `endSession` rather than a `DELETE` of our own, so the code that owns the
      // session table is the code that writes to it. The browser keeps its now-dangling
      // cookie until the next sign-in overwrites it; it resolves to no session, which is
      // why signing out is safe without clearing it by hand.
      await ctx.endSession();
      return { ok: true };
    }),

    /**
     * Remember the language this person reads, for the emails nobody's browser is open to
     * see. The browser's store stays the owner of the choice while a page is open; this is
     * where it is projected so a failed-run notice at three in the morning arrives in it.
     */
    setLocale: authedProcedure
      .input(z.object({ locale: z.enum(["vi", "en"]) }))
      .mutation(async ({ ctx, input }) => {
        await preferences.setLocale(ctx.exec, ctx.user.userId, input.locale);
        return { ok: true };
      }),
  }),

  tenants: tenantsRouter,

  connections: connectionsRouter,

  /**
   * Ingest keys: the credential a script presents to the lake write API. All admin-only --
   * a key is a standing grant to land data as this customer -- and the token is returned by
   * `mint` once and by nothing else.
   */
  keys: router({
    list: requireRole("admin").query(({ ctx }) => keys.list(ctx.exec, ctx.tenantId)),

    mint: requireRole("admin")
      .input(
        z.object({
          label: z.string().trim().min(1).max(80),
          allowedSources: z.array(z.enum(connections.KNOWN_SOURCES)).max(4).default([]),
          expiresInDays: z.number().int().min(1).max(365).optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        keys.mint(ctx.exec, {
          tenantId: ctx.tenantId,
          label: input.label,
          allowedSources: [...new Set(input.allowedSources)],
          ...(input.expiresInDays === undefined ? {} : { expiresInDays: input.expiresInDays }),
          actor: ctx.user.email,
        }),
      ),

    revoke: requireRole("admin")
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const revoked = await keys.revoke(ctx.exec, {
          tenantId: ctx.tenantId,
          id: input.id,
          actor: ctx.user.email,
        });
        if (!revoked) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { ok: true };
      }),
  }),

  /**
   * Who may see a tenant, and how they were invited.
   *
   * The decisions -- one live invitation per address, an audit entry, whether the invitee
   * could be told -- are in `services/people.ts`. What is left here is the HTTP meaning of
   * each outcome: an address that already has access is a CONFLICT, an invitation that was
   * not open is a NOT_FOUND.
   */
  people: peopleRouter,

  lake: router({
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
  }),

  models: modelsRouter,

  bi: biRouter,

  dq: router({
    /**
     * The rows a failed test stored. Admin-only: they are source data, the same rows the
     * dq schema exists to keep off dashboards. NOT_FOUND for a step that is not this
     * tenant's, BAD_REQUEST for one that stored nothing.
     */
    failures: requireRole("admin")
      .input(
        z.object({
          runId: z.string().min(1),
          uniqueId: z.string().min(1),
          limit: z.number().int().min(1).max(MAX_PREVIEW_ROWS).default(MAX_PREVIEW_ROWS),
        }),
      )
      .query(async ({ ctx, input }) => {
        if (ctx.worker === null) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: messages(ctx.locale)("error.dqNotRead"),
          });
        }
        const outcome = await models.dqFailures(ctx.worker, { ...input, tenantId: ctx.tenantId });
        if (!outcome.ok) {
          throw new TRPCError({
            code: outcome.reason === "refused" ? "NOT_FOUND" : "PRECONDITION_FAILED",
            message: messages(ctx.locale)("error.dqNotRead"),
          });
        }
        return outcome.value;
      }),
  }),

  runs: router({
    /**
     * The ledger, newest first. Any member of the tenant may read it: whether a run happened
     * is the question the whole division exists to answer, and hiding it from a viewer would
     * hide the one thing they came to look at.
     */
    list: tenantProcedure
      .input(
        z.object({
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
        }),
      )
      .query(({ ctx, input }) =>
        runs.list(ctx.exec, input.tenantId, { limit: input.limit, cursor: input.cursor ?? null }),
      ),

    // A run that is not this tenant's is NOT_FOUND, not FORBIDDEN, for the reason
    // `tenantProcedure` gives: the id must not confirm that another customer's run exists.
    get: tenantProcedure
      .input(z.object({ runId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const run = await runs.get(ctx.exec, input.tenantId, input.runId);
        if (run === null) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return run;
      }),

    /**
     * Run now. Admin-only: starting a read of a customer's accounts is the same authority
     * as connecting them. The call proxies to the worker's verb allowlist with the same
     * bearer token Kestra uses, so the control plane gains no wider privilege than the
     * scheduler.
     *
     * Three refusals, three sentences: a run already in progress is CONFLICT and names it;
     * a worker that did not answer is PRECONDITION_FAILED; a worker that answered no is
     * BAD_REQUEST. One sentence for all three would send an admin to wait for a service that
     * is fine, on the screen where the run they wanted is already visible.
     */
    trigger: requireRole("admin")
      .input(z.object({ source: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.worker === null) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: messages(ctx.locale)("error.runNotStarted"),
          });
        }
        const outcome = await runs.trigger(ctx.exec, ctx.worker, {
          tenantId: ctx.tenantId,
          source: input.source,
          actor: ctx.user.email,
          actorId: ctx.user.userId,
        });
        if (outcome.ok) {
          return { runId: outcome.runId };
        }
        if (outcome.reason === "in-progress") {
          throw new TRPCError({
            code: "CONFLICT",
            message: messages(ctx.locale)("error.runInProgress", { source: input.source }),
          });
        }
        throw new TRPCError({
          code: outcome.reason === "unreachable" ? "PRECONDITION_FAILED" : "BAD_REQUEST",
          message: messages(ctx.locale)(
            outcome.reason === "unreachable" ? "error.runNotStarted" : "error.runRefused",
            { source: input.source },
          ),
        });
      }),
  }),

  /**
   * The public halves of the Google client, for the browser's Picker.
   *
   * A client id and an API key are public by design -- they identify the app, they do not
   * authorise anything, and Google's own documentation puts both in page source. The client
   * SECRET is not here and never crosses this boundary.
   *
   * `authedProcedure` rather than public: there is no reason for an anonymous visitor to
   * learn which Google project a deployment belongs to.
   */
  config: router({
    google: authedProcedure.query(({ ctx }) => ctx.googlePicker),
  }),

  health: publicProcedure.query(() => ({ ok: true })),
});

export type AppRouter = typeof appRouter;
