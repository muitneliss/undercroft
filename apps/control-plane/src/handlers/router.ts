import { TRPCError } from "@trpc/server";
import { MAX_PREVIEW_ROWS } from "@undercroft/contracts";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import { ANSWER_SECONDS } from "./holdOpen.ts";
import { StepQuery } from "./inputs.ts";
import * as connections from "../services/connections.ts";
import * as keys from "../services/keys.ts";
import * as models from "../services/models.ts";
import * as preferences from "../services/preferences.ts";
import * as runs from "../services/runs.ts";
import { MAX_WAIT_SECONDS } from "../services/runWait.ts";
import { requirePermission, requireWholeReach } from "./permissionGate.ts";
import { actorOf, authedProcedure, publicProcedure, router } from "./trpc.ts";

import { accountRouter } from "./accountRouter.ts";
import { auditRouter } from "./auditRouter.ts";
import { connectionsRouter } from "./connectionsRouter.ts";
import { lakeRouter } from "./lakeRouter.ts";
import { biRouter } from "./biRouter.ts";
import { documentKindsRouter } from "./documentKindsRouter.ts";
import { macrosRouter } from "./macrosRouter.ts";
import { seedsRouter } from "./seedsRouter.ts";
import { modelsRouter } from "./modelsRouter.ts";
import { grantsRouter } from "./grantsRouter.ts";
import { scopesRouter } from "./scopesRouter.ts";
import { peopleRouter } from "./peopleRouter.ts";
import { rolesRouter } from "./rolesRouter.ts";
import { tenantsRouter } from "./tenantsRouter.ts";

/** The most run ids one `runs.list` takes: "where are these runs now", not a bulk export. */
const MAX_LISTED_RUNS = 50;

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

  /** The caller's own credentials. Session-only: see `accountRouter.ts`. */
  account: accountRouter,

  tenants: tenantsRouter,

  connections: connectionsRouter,

  /**
   * Ingest keys: the credential a script presents to the lake write API. All `keys:manage` --
   * a key is a standing grant to land data as this customer -- and the token is returned by
   * `mint` once and by nothing else.
   */
  keys: router({
    list: requirePermission("keys:manage").query(({ ctx }) => keys.list(ctx.exec, ctx.tenantId)),

    mint: requirePermission("keys:manage")
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
          actor: actorOf(ctx),
        }),
      ),

    revoke: requirePermission("keys:manage")
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const revoked = await keys.revoke(ctx.exec, {
          tenantId: ctx.tenantId,
          id: input.id,
          actor: actorOf(ctx),
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

  /**
   * The roles a customer has, built-in and its own, and the grants of one permission to a role
   * or a person (ADR 0141). Each change is under the subset rule, in its service.
   */
  roles: rolesRouter,
  grants: grantsRouter,
  /** What a person can see, resolved: every model they read, its rules, and the broken ones (ADR 0143). */
  scopes: scopesRouter,

  /** Who did what: a person's own actions, a tenant's for its admin, all for a superadmin. */
  audit: auditRouter,

  lake: lakeRouter,
  models: modelsRouter,
  macros: macrosRouter,
  seeds: seedsRouter,
  documentKinds: documentKindsRouter,

  bi: biRouter,

  dq: router({
    /**
     * The rows a failed test stored. `lake:read`: they are source data, the same rows the
     * dq schema exists to keep off dashboards. NOT_FOUND for a step that is not this
     * tenant's, BAD_REQUEST for one that stored nothing.
     */
    failures: requireWholeReach("lake:read")
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
     * The ledger, newest first. `runs:read`, as every read of the Journal is (ADR 0147): a run
     * names the accounts a customer reads and what each read returned, which a reader of its
     * Reports does not need. Whether a run happened is the question the division exists to
     * answer, so the permission opens the division and every read behind it at once.
     *
     * Every filter is optional and narrows (issue 439): `source` to one account's runs (ADR
     * 0043) -- what a source card opens, in the same 64 characters `lake.records` allows a source
     * -- and the rest to what an agent would otherwise list everything to find. They combine
     * with each other and with the cursor, and an empty page is "nothing matched".
     */
    list: requirePermission("runs:read")
      .input(
        z.object({
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
          source: z.string().trim().min(1).max(64).optional(),
          kind: z
            .array(z.enum(runs.RUN_FILTERS.kind))
            .min(1)
            .max(runs.RUN_FILTERS.kind.length)
            .optional(),
          status: z.enum(runs.RUN_FILTERS.status).optional(),
          trigger: z.enum(runs.RUN_FILTERS.trigger).optional(),
          parentRunId: z.string().min(1).optional(),
          chained: z.boolean().optional(),
          startedAfter: z.string().datetime({ offset: true }).optional(),
          startedBefore: z.string().datetime({ offset: true }).optional(),
          ids: z.array(z.string().min(1)).min(1).max(MAX_LISTED_RUNS).optional(),
        }),
      )
      .query(({ ctx, input }) =>
        runs.list(ctx.exec, input.tenantId, {
          limit: input.limit,
          cursor: input.cursor ?? null,
          source: input.source ?? null,
          kinds: input.kind ?? null,
          status: input.status ?? null,
          trigger: input.trigger ?? null,
          parentRunId: input.parentRunId ?? null,
          chained: input.chained ?? null,
          startedAfter: input.startedAfter ?? null,
          startedBefore: input.startedBefore ?? null,
          ids: input.ids ?? null,
        }),
      ),

    /**
     * One run in full, its dbt steps as a summary and the page of them asked for -- the problems
     * by default (issue 441, `StepQuery`).
     *
     * With `waitSeconds` it answers once the run is no longer `running` -- and, for an ingest that
     * closed ok, once the transform it chains exists -- or when the wait runs out, still saying
     * `running` (issue 440). So an agent that started a run reads it once instead of polling.
     * The wait holds the request open (`holdsOpenSeconds`, ADR 0124): its cap plus ten seconds to
     * read and send the run once it is over.
     *
     * A run that is not this tenant's is NOT_FOUND, not FORBIDDEN, for the reason
     * `tenantProcedure` gives: the id must not confirm that another customer's run exists.
     */
    get: requirePermission("runs:read")
      .meta({ holdsOpenSeconds: MAX_WAIT_SECONDS + ANSWER_SECONDS })
      .input(
        StepQuery.extend({
          runId: z.string().min(1),
          waitSeconds: z.number().int().min(1).max(MAX_WAIT_SECONDS).optional(),
        }),
      )
      .query(async ({ ctx, input, signal }) => {
        const { tenantId, runId, waitSeconds, ...steps } = input;
        const run = await runs.get(ctx.exec, tenantId, runId, {
          steps,
          ...(waitSeconds === undefined ? {} : { wait: { seconds: waitSeconds, signal } }),
        });
        if (run === null) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return run;
      }),

    /**
     * What the worker is saying about a run, as it says it.
     *
     * Its own procedure rather than part of `get`, because the leaf re-reads this every
     * couple of seconds while a run is live and re-reading the refusals and the dbt steps
     * at that rate would be a page of unchanged rows each time.
     *
     * `runs:read`, like the ledger above it: it carries counts, enumerations and opaque provider
     * ids, which is the same category of fact as the row itself.
     */
    events: requirePermission("runs:read")
      .input(z.object({ runId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const feed = await runs.events(ctx.exec, input.tenantId, input.runId);
        if (feed === null) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return feed;
      }),

    /**
     * Run now. `sources:manage`: starting a read of a customer's accounts is the same
     * authority as connecting them. The call proxies to the worker's verb allowlist with the same
     * bearer token Kestra uses, so the control plane gains no wider privilege than the
     * scheduler.
     *
     * Three refusals, three sentences: a run already in progress is CONFLICT and names it;
     * a worker that did not answer is PRECONDITION_FAILED; a worker that answered no is
     * BAD_REQUEST. One sentence for all three would send an admin to wait for a service that
     * is fine, on the screen where the run they wanted is already visible.
     */
    trigger: requirePermission("sources:manage")
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
          actor: actorOf(ctx),
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

  /** What the browser needs to know about how this install is configured. */
  config: router({
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
    google: authedProcedure.query(({ ctx }) => ctx.googlePicker),

    /**
     * The ways in, for the sign-in page. Public, and it has to be: the page asks before anybody
     * is signed in. It names methods and never who a method signs in as -- the local method's
     * address stays in the server's environment. ADR 0094: `dev` alone is a desktop install,
     * and the page signs its owner in without a click.
     */
    signIn: publicProcedure.query(({ ctx }) => ({ methods: ctx.signInMethods })),
  }),

  health: publicProcedure.query(() => ({ ok: true })),
});

export type AppRouter = typeof appRouter;
