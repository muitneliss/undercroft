/**
 * The `connections` procedures.
 *
 * Split from `router.ts`, which had grown past what one file may be. Same layer and the
 * same rules: validate the input, call one service, decide what its answer means over HTTP.
 */

import { TRPCError } from "@trpc/server";
import { Cadence, sourceKind } from "@undercroft/contracts";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import * as connections from "../services/connections.ts";
import { requireRole, router, tenantProcedure } from "./trpc.ts";
import { tokenRefusalKey } from "./answers.ts";

export const connectionsRouter = router({
  list: tenantProcedure.query(({ ctx, input }) => connections.list(ctx.exec, input.tenantId)),

  get: tenantProcedure
    .input(z.object({ source: z.string().min(1) }))
    .query(({ ctx, input }) => connections.get(ctx.exec, input.tenantId, input.source)),

  // Starting an OAuth flow mints tokens into a customer's account, so it is admin-only.
  // The redirect itself is a plain HTTP route (a provider cannot speak tRPC); this
  // returns the URL for the UI to navigate to.
  //
  // Gmail and Drive get a real Google URL with a handshake row recorded behind it.
  // Anything else is a refusal, and it is reported as one.
  //
  // This used to answer a refusal with `/oauth/{source}/start?tenant=__set_by_server__`,
  // a path no route has ever served. The browser was sent there, the SPA catch-all
  // answered with `index.html`, and the router's `*` rule bounced the operator to
  // /tenants with no message -- a dead end that reads exactly like a broken button, and
  // cost an afternoon to tell apart from one. A procedure that cannot do the thing says
  // so; `.claude/rules/money.md` calls this never guessing, and a fabricated URL is a
  // guess with a 200 on it.
  startOAuth: requireRole("admin")
    // `addAccount` connects a further account of the kind rather than (re)connecting `source`.
    // ADR 0043.
    .input(z.object({ source: z.string().min(1), addAccount: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const started = await ctx.startConsent({
        tenantId: ctx.tenantId,
        source: input.source,
        startedBy: ctx.user.userId,
        addAccount: input.addAccount,
      });
      if (started.ok) {
        return { authorizeUrl: started.authorizeUrl };
      }

      // PRECONDITION_FAILED for both, as `browseScope` already answers for an absent
      // worker: nothing about the request is wrong, the deployment simply cannot serve
      // it yet. The two reasons are worded apart because the remedies are: one is an
      // operator's environment, the other is a source this build does not connect.
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: messages(ctx.locale)(
          started.reason === "not-configured"
            ? "error.ingestNotConfigured"
            : "error.sourceNotConnectable",
          { source: input.source },
        ),
      });
    }),

  /**
   * What an admin may choose from, for the scope picker: Gmail's labels, or the
   * organisations a Xero consent can see.
   *
   * Proxied to the worker because it needs a live token, which only the worker can open.
   * Drive has no listing: under `drive.file` the choosing happens in the browser through
   * Google's own Picker, so there is nothing for the server to list.
   */
  browseScope: requireRole("admin")
    .input(z.object({ source: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      if (ctx.worker === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: messages(ctx.locale)("error.workerUnavailable"),
        });
      }
      const outcome = await ctx.worker.browseScope({
        source: input.source,
        tenantId: ctx.tenantId,
        kind: sourceKind(input.source) === "xero" ? "organisations" : "labels",
      });
      if (!outcome.ok) {
        // Three outcomes, three sentences. One message for all of them told an
        // administrator whose Gmail grant Google had refused that "the processing service
        // is not responding" -- on the very screen where the remedy was a reconnect they
        // could do themselves, and about a service that was answering perfectly.
        if (outcome.reason === "scope-insufficient") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: messages(ctx.locale)("error.scopeInsufficient"),
          });
        }
        throw new TRPCError({
          code: outcome.reason === "unreachable" ? "PRECONDITION_FAILED" : "BAD_REQUEST",
          message: messages(ctx.locale)(
            outcome.reason === "unreachable" ? "error.workerUnavailable" : "error.browseRefused",
            { source: input.source },
          ),
        });
      }
      return outcome.value;
    }),

  /** Record what may be read. Admin-only: it widens or narrows a live grant. */
  setScope: requireRole("admin")
    .input(z.object({ source: z.string().min(1), selection: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      const result = await connections.setScope(ctx.exec, {
        tenantId: ctx.tenantId,
        source: input.source,
        selectionJson: JSON.stringify(input.selection ?? {}),
        actor: ctx.user.email,
        actorId: ctx.user.userId,
      });
      if (!result.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: messages(ctx.locale)("error.scopeNotUnderstood", { source: input.source }),
        });
      }
      return { ok: true };
    }),

  /**
   * Connect a source with a pasted token. Admin-only: it is a credential into a customer's
   * account. The worker proves the token before sealing it, so a refusal here is worded
   * for the person who pasted it -- the token is wrong, not the platform.
   */
  setToken: requireRole("admin")
    .input(z.object({ source: z.string().min(1), token: z.string().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.worker === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: messages(ctx.locale)("error.workerUnavailable"),
        });
      }
      const result = await connections.setToken(ctx.exec, ctx.worker, {
        tenantId: ctx.tenantId,
        source: input.source,
        token: input.token,
        actor: ctx.user.email,
      });
      if (result.ok) {
        return { ok: true };
      }
      if (result.reason === "unreachable") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: messages(ctx.locale)("error.workerUnavailable"),
        });
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: messages(ctx.locale)(tokenRefusalKey(result.reason), { source: input.source }),
      });
    }),

  /**
   * How often a source is read. Admin-only, like every change to a live grant. A source
   * nobody has connected has nothing to set it on, and says so as NOT_FOUND.
   */
  setCadence: requireRole("admin")
    .input(z.object({ source: z.string().min(1), cadence: Cadence }))
    .mutation(async ({ ctx, input }) => {
      const result = await connections.setCadence(ctx.exec, {
        tenantId: ctx.tenantId,
        source: input.source,
        cadence: input.cadence,
        actor: ctx.user.email,
      });
      if (!result.ok) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { ok: true };
    }),

  /**
   * End a grant.
   *
   * Reports whether the provider was actually told rather than assuming it: our row
   * disappearing while Google's grant stands would make "you can disconnect at any time"
   * -- copy already on the consent card -- a half-truth.
   */
  disconnect: requireRole("admin")
    .input(z.object({ source: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      connections.disconnect(ctx.exec, ctx.worker, {
        tenantId: ctx.tenantId,
        source: input.source,
        actor: ctx.user.email,
      }),
    ),
});
