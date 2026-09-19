// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.

// biome-ignore-all lint/style/noExcessiveLinesPerFile: This file IS the tRPC surface: one router literal whose procedures are declared inside it. There is no split that does not separate a procedure from the router it attaches to, and the length is the count of endpoints rather than complexity in any one of them.
// biome-ignore-all lint/performance/noNamespaceImport: `import pg from "pg"` and friends: these packages have no useful named exports, and the namespace import is the documented way to consume them.
// biome-ignore-all lint/style/noMagicNumbers: What is left after the domain constants were named (see the WCAG block in acetate.ts) is structural: string slice offsets, the radix argument to parseInt, padStart widths, rounding factors. A name like SLICE_START_OF_GREEN_CHANNEL does not tell a reader anything the expression did not. The rule has no allow-list option, so it is per file or not at all.

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { TRPCError } from "@trpc/server";
import {
  Cadence,
  ChartConfig,
  DashboardFilters,
  DashboardLayout,
  MAX_MODEL_SQL_BYTES,
  MAX_PREVIEW_ROWS,
  MAX_QUERY_ROWS,
  ModelName,
  ModelTests,
  QueryParams,
  QuestionDefinition,
} from "@undercroft/contracts";
import type { Locale } from "@undercroft/core/locale";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import * as bi from "../services/bi.ts";
import * as connections from "../services/connections.ts";
import * as keys from "../services/keys.ts";
import * as lake from "../services/lake.ts";
import * as models from "../services/models.ts";
import * as people from "../services/people.ts";
import * as preferences from "../services/preferences.ts";
import * as runs from "../services/runs.ts";
import * as tenants from "../services/tenants.ts";
import {
  authedProcedure,
  publicProcedure,
  requireRole,
  router,
  superadminProcedure,
  tenantProcedure,
} from "./trpc.ts";

const Role = z.enum(["viewer", "member", "admin"]);

/** Which sentence a refused pasted token gets: the token is wrong, the source cannot, or the worker would not. */
function tokenRefusalKey(
  reason: "rejected" | "unsupported-source" | "refused",
): "error.tokenRejected" | "error.sourceNotConnectable" | "error.tokenNotStored" {
  switch (reason) {
    case "rejected":
      return "error.tokenRejected";
    case "unsupported-source":
      return "error.sourceNotConnectable";
    case "refused":
      return "error.tokenNotStored";
    default: {
      const exhaustive: never = reason;
      throw new Error(`unhandled refusal ${String(exhaustive)}`);
    }
  }
}

/**
 * Which refusal a question that was not answered gets. A parameter with no value and SQL
 * Postgres refused are both BAD_REQUEST -- the request was the fault, and the sentence says
 * what to change -- while a worker that did not answer is a precondition nobody at the
 * screen can fix.
 */
function answerRefusal(
  locale: Locale,
  outcome: Exclude<bi.AnswerOutcome, { ok: true }>,
): TRPCError {
  switch (outcome.reason) {
    case "param-missing":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: messages(locale)("error.paramMissing", { name: outcome.param }),
      });
    case "query-failed":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: messages(locale)("error.queryFailed", { message: outcome.message ?? "" }),
      });
    case "question-not-found":
      return new TRPCError({ code: "NOT_FOUND" });
    default:
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: messages(locale)("error.queryNotRun"),
      });
  }
}

/**
 * A tenant reference, as typed into the create form.
 *
 * Constrained to the shape `.claude/rules/pii.md` requires -- letters, digits, hyphen and
 * underscore, no spaces -- because this value becomes an S3 key prefix in the raw lake and
 * a directory name, and because a reference is a CASE-id and never a customer's name. The
 * refusal is worth more than the convenience: a reference cannot be renamed once the lake
 * has written under it.
 */
const TenantId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);

/**
 * Addresses are stored and compared lowercased.
 *
 * `app.app_user.email` and the sign-in gate both normalise this way, and an invitation
 * written in different case from the address someone signs in with would never be redeemed.
 */
const Email = z.string().trim().toLowerCase().email().max(320); // the longest address RFC 5321 allows

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

  tenants: router({
    list: authedProcedure.query(({ ctx }) =>
      tenants.listForCaller(ctx.exec, { userId: ctx.user.userId, superadmin: ctx.superadmin }),
    ),

    get: tenantProcedure.query(async ({ ctx, input }) => {
      const tenant = await tenants.get(ctx.exec, input.tenantId);
      if (tenant === null) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { ...tenant, role: ctx.role };
    }),

    /**
     * Create a customer. Superadmin only.
     *
     * Not `requireRole("admin")`, which would read as the stricter choice and is in fact the
     * wrong axis entirely: a tenant `admin` is senior *inside one customer*, and nothing
     * about that authority implies the right to bring another customer into existence. This
     * is the one procedure in the router whose authority is not tenant-scoped, and ADR 0013
     * is what permits it to exist at all.
     *
     * CONFLICT for a reference already in use, worded, because the operator is looking at a
     * form and has to be told which of the two things happened: a 409 that read like a
     * success would have them believe they created a customer they merely collided with.
     */
    create: superadminProcedure
      .input(z.object({ tenantId: TenantId, displayName: z.string().trim().max(200) }))
      .mutation(async ({ ctx, input }) => {
        const result = await tenants.create(ctx.exec, {
          tenantId: input.tenantId,
          // The reference doubles as the name until somebody gives it one, which is what
          // `bun run invite --create-tenant` already does. An empty display name would
          // render as a blank row in the list.
          displayName: input.displayName || input.tenantId,
          actor: ctx.user.email,
        });

        if (!result.ok) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              result.reason === "role-collision"
                ? messages(ctx.locale)("error.tenantRoleCollision", { tenantId: input.tenantId })
                : messages(ctx.locale)("error.tenantExists", { tenantId: input.tenantId }),
          });
        }

        return result.tenant;
      }),

    /**
     * Correct a customer's display name. Tenant admin, and the id is not an input.
     *
     * `requireRole("admin")` rather than `superadminProcedure`, which is the opposite axis to
     * `create` above and deliberately so: bringing a customer into existence is platform
     * authority, but retitling one that already exists is an act *inside* that customer, and
     * a tenant admin is exactly who that belongs to. A superadmin still reaches it, because
     * `authorityIn` resolves them to `admin` in any tenant that exists.
     *
     * There is no `tenantId` in the body and there never will be. The id is an S3 key prefix
     * in the raw lake and the lake is create-only, so a "rename" of it would strand every
     * object already written under the old prefix. Leaving it out of the input is what makes
     * that impossible to ask for rather than merely refused.
     *
     * An empty name falls back to the id, matching `create`: the list renders
     * `displayName || id`, and a blank row is not a name.
     */
    rename: requireRole("admin")
      .input(z.object({ displayName: z.string().trim().max(200) }))
      .mutation(async ({ ctx, input }) => {
        const renamed = await tenants.rename(ctx.exec, {
          tenantId: ctx.tenantId,
          displayName: input.displayName || ctx.tenantId,
          actor: ctx.user.email,
        });

        if (renamed === null) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        return renamed;
      }),
  }),

  connections: router({
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
      .input(z.object({ source: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const started = await ctx.startConsent({
          tenantId: ctx.tenantId,
          source: input.source,
          startedBy: ctx.user.userId,
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
          kind: input.source === "xero" ? "organisations" : "labels",
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
  }),

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
  people: router({
    members: tenantProcedure.query(({ ctx, input }) => people.members(ctx.exec, input.tenantId)),

    invitations: tenantProcedure.query(({ ctx, input }) =>
      people.invitationsFor(ctx.exec, input.tenantId),
    ),

    /**
     * Invite an address.
     *
     * Admin-only: an invitation grants a role inside a customer's tenant, and the buttons
     * behind it mint OAuth tokens into that customer's accounting system.
     */
    invite: requireRole("admin")
      .input(z.object({ email: Email, role: Role }))
      .mutation(async ({ ctx, input }) => {
        const result = await people.invite(ctx.exec, {
          tenantId: ctx.tenantId,
          email: input.email,
          role: input.role,
          actor: ctx.user.email,
          notify: ctx.notifyInvitation,
        });

        if (!result.ok) {
          if (result.reason === "already-member") {
            throw new TRPCError({
              code: "CONFLICT",
              // In the caller's language: `People.tsx` renders this message verbatim in an
              // errata slip, so an English sentence would be the one untranslated thing on
              // a Vietnamese page -- appearing exactly when something has gone wrong.
              message: messages(ctx.locale)("error.alreadyMember", {
                email: input.email,
                role: result.role,
              }),
            });
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        }

        // Whether the invitee was told is reported, never assumed: with no mail configured
        // the invitation is still valid and the admin has to pass the address on by hand.
        return {
          id: result.id,
          email: input.email,
          role: input.role,
          notified: result.notified,
        };
      }),

    /** Withdraw an invitation that has not been accepted. */
    revokeInvitation: requireRole("admin")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const revoked = await people.revokeInvitation(ctx.exec, {
          id: input.id,
          tenantId: ctx.tenantId,
        });
        if (!revoked) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: messages(ctx.locale)("error.noOpenInvitation"),
          });
        }
        return { ok: true };
      }),
  }),

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

  models: router({
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
  }),

  bi: router({
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
      .mutation(async ({ ctx, input }) => {
        if (ctx.worker === null) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: messages(ctx.locale)("error.workerUnavailable"),
          });
        }
        const outcome = await bi.answerQuestion(ctx.exec, ctx.worker, {
          tenantId: input.tenantId,
          questionId: input.questionId,
          params: input.params,
        });
        if (!outcome.ok) {
          throw answerRefusal(ctx.locale, outcome);
        }
        return outcome.value;
      }),

    /** What a definition compiles to, for the builder to show beside itself. Pure. */
    compile: requireRole("member")
      .input(z.object({ definition: QuestionDefinition }))
      .query(({ input }) => ({ sql: bi.compileDefinition(input.definition) })),

    questions: router({
      list: tenantProcedure.query(({ ctx, input }) =>
        bi.listQuestionViews(ctx.exec, input.tenantId),
      ),

      get: tenantProcedure
        .input(z.object({ id: z.string().uuid() }))
        .query(async ({ ctx, input }) => {
          const question = await bi.getQuestionView(ctx.exec, input.tenantId, input.id);
          if (question === null) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
          return question;
        }),

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
            actor: ctx.user.email,
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
            actor: ctx.user.email,
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
            actor: ctx.user.email,
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
            actor: ctx.user.email,
          });
          if (!removed) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
          return { ok: true };
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
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: messages(ctx.locale)("error.queryNotRun"),
        });
      }
      return outcome.value;
    }),
  }),

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
