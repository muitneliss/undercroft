/**
 * The `connections` procedures.
 *
 * Split from `router.ts`, which had grown past what one file may be. Same layer and the
 * same rules: validate the input, call one service, decide what its answer means over HTTP.
 */

import { TRPCError } from "@trpc/server";
import { type BrowseListing, Cadence } from "@undercroft/contracts";
import type { Locale } from "@undercroft/core";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import * as connections from "../services/connections.ts";
import { providerName } from "../services/oauthProviders.ts";
import type { WorkerFailure } from "../services/workerClient.ts";
import { refusal, requireRole, router, tenantProcedure } from "./trpc.ts";
import { tokenRefusalKey } from "./answers.ts";

/**
 * Why a browse was refused, and what the person or agent reading it can do about it.
 *
 * Four answers, because the remedies have nothing in common. One message for all of them
 * told an administrator whose Gmail grant Google had refused that "the processing service is
 * not responding" -- on the very screen where the remedy was a reconnect they could do
 * themselves, and about a service that was answering perfectly. The sentence is worded for
 * the reader; `details` carries the same verdict as codes an agent matches on, since the
 * sentence alone left one guessing what could not be listed (issue 177).
 */
function browseRefusal(
  locale: Locale,
  at: { source: string; listing: BrowseListing | null },
  reason: WorkerFailure | "unsupported",
): TRPCError {
  const t = messages(locale);
  const facts = { source: at.source, listing: at.listing };
  switch (reason) {
    // A source with nothing to choose from. The request will never succeed, so BAD_REQUEST;
    // the facts say so, which is what keeps an agent from "fixing the input" and retrying.
    case "unsupported":
      return refusal("BAD_REQUEST", t("error.browseUnsupported", { source: at.source }), {
        ...facts,
        reason: "unsupported",
        remedy: "none",
      });
    // Google refused the grant, or the recorded grant lacks the scope -- a Drive grant from
    // before ADR 0047 is `drive.file`, which Google answers with an empty list rather than a
    // refusal, so the worker refuses it by the recorded scope instead. HubSpot's token is a
    // private app's, and its remedy is worded for that: there is no consent screen to tick.
    case "scope-insufficient":
      return refusal(
        "PRECONDITION_FAILED",
        at.listing === "properties"
          ? t("error.propertiesInsufficient")
          : t("error.scopeInsufficient", { source: at.source }),
        { ...facts, reason: "scope-insufficient", remedy: "reconnect" },
      );
    case "unreachable":
      return refusal("PRECONDITION_FAILED", t("error.workerUnavailable"), {
        ...facts,
        reason: "worker-unreachable",
        remedy: "retry-later",
      });
    default:
      return refusal("BAD_REQUEST", t("error.browseRefused", { source: at.source }), {
        ...facts,
        reason: "refused",
        remedy: "none",
      });
  }
}

/** Why a scope was not saved: the one refusal left is a selection nobody could read. */
function scopeRefusal(locale: Locale, source: string): TRPCError {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: messages(locale)("error.scopeNotUnderstood", { source }),
  });
}

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
      // operator's environment, the other is a source this build does not connect. The
      // first names the provider the service found without a client, never a fixed one: a
      // deployment may hold Google's and not Xero's (issue 211).
      const t = messages(ctx.locale);
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          started.reason === "not-configured"
            ? t("error.ingestNotConfigured", { provider: providerName(started.provider) })
            : t("error.sourceNotConnectable", { source: input.source }),
      });
    }),

  /**
   * What an admin may choose from, for the scope picker or an agent at the CLI: Gmail's
   * labels, the organisations a Xero consent can see, Drive's folders -- each with its
   * path -- and the file types across the grant (ADR 0047), or the properties of each
   * HubSpot CRM object, the portal's own included (ADR 0052).
   *
   * Proxied to the worker because it needs a live token, which only the worker can open.
   * Every refusal names, in `details`, which listing could not be had and what would fix it.
   */
  browseScope: requireRole("admin")
    .input(z.object({ source: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const listing = connections.browseListingFor(input.source);
      if (listing === null) {
        throw browseRefusal(ctx.locale, { source: input.source, listing }, "unsupported");
      }
      if (ctx.worker === null) {
        throw browseRefusal(ctx.locale, { source: input.source, listing }, "unreachable");
      }
      const outcome = await ctx.worker.browseScope({
        source: input.source,
        tenantId: ctx.tenantId,
        kind: listing,
      });
      if (!outcome.ok) {
        throw browseRefusal(ctx.locale, { source: input.source, listing }, outcome.reason);
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
        throw scopeRefusal(ctx.locale, input.source);
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
