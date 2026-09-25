/**
 * tRPC context and authorization.
 *
 * These ~100 lines are the crown jewel of the control plane, ported verbatim from the
 * Python's semantics because they are the security boundary, not plumbing:
 *
 * - **404, not 403, for a non-member.** A 403 confirms the tenant exists, which turns any
 *   tenant endpoint into an oracle for enumerating the customer list -- exactly the PII
 *   everything else goes to lengths to keep out of keys and logs. A non-member is told the
 *   tenant is not there.
 * - **403 once membership is established.** Then the caller already knows the tenant
 *   exists; what they lack is authority, and saying so lets the UI disable a button rather
 *   than hide a page.
 * - **Sessions are server-side and opaque.** A stateless token cannot be withdrawn before
 *   it expires, and the buttons behind this cookie mint OAuth tokens into a customer's
 *   accounting system. So the session row is read from the database on every request, and a
 *   session revoked a moment ago cannot be used by a request that read the row just before.
 *   Better Auth performs that read (`auth.api.getSession`) since it owns the session table;
 *   what it must never be allowed to do is answer from `session.cookieCache`, which would
 *   make this property quietly untrue. `handlers/auth.ts` records that.
 *
 * Authentication and authorization are two identities here, joined by email address:
 * Better Auth's `app.auth_user` proves who the caller is, and `app.app_user` -- which
 * `app.tenant_member` keys -- is what a role is resolved against. `Context.user.userId` is
 * always the `app_user` uuid, never Better Auth's id. `services/invite.ts` holds that seam.
 *
 * What is NOT here is the query. A role is resolved through `services/authz.ts`, which
 * answers with a role or `null`; turning that `null` into NOT_FOUND is the decision argued
 * above, and holding it in one place is why every tenant-scoped procedure gets it right.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import type { Locale } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { currentTraceId } from "@undercroft/telemetry";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import type { Grant } from "../services/accessTokens.ts";
import { authorityIn, outranks, type Role } from "../services/authz.ts";
import type { StartOutcome } from "../services/oauth.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import { effectOf, grantAdmits } from "./surface.ts";

export interface SessionUser {
  readonly userId: string;
  readonly email: string;
}

/**
 * Which door the caller came through: a person's browser session (the cookie `/trpc` and the
 * assistant read), or a bearer credential (`/mcp`). A procedure never branches on it except to
 * refuse -- `sessionProcedure` below -- and the grant is what carries its consequence.
 */
export type Via = "session" | "token";

export interface Context {
  readonly exec: SqlExecutor;
  readonly user: SessionUser | null;
  /**
   * What the caller presented, by id: Better Auth's session id, or a personal token's `upat_…`
   * id. `""` when unauthenticated. For audit and logs, never for authority.
   */
  readonly credentialId: string;
  readonly via: Via;
  /**
   * What the caller's credential lets through, which the base procedure below enforces against
   * each call's effect. A cookie session is always `write` -- it IS the person, at their own
   * browser -- and a token holds whatever its owner chose when minting it (ADR 0060).
   */
  readonly grant: Grant;
  /**
   * Whether the caller is named in `UNDERCROFT_SUPERADMINS`, and therefore holds `admin` in
   * every tenant.
   *
   * A boolean rather than the list itself: the list is a *configuration*, and putting it on
   * the context would let any procedure ask a question of it that this layer has not
   * sanctioned -- "is this OTHER address a superadmin", which is the shape of an
   * enumeration endpoint. The only question a procedure may ask is about its own caller,
   * and this is that question already answered, once, in `handlers/server.ts`.
   *
   * `false` for an unauthenticated caller, because `user` is `null` there and there is
   * nobody for it to be true of.
   */
  readonly superadmin: boolean;
  /**
   * Revoke the caller's session.
   *
   * A closure the HTTP layer builds over the auth instance and this request's headers, so
   * signing out deletes the session row through the code that owns that table rather than
   * with a `DELETE` of our own. It also means a procedure never needs the auth instance,
   * and this module keeps importing nothing but the database and tRPC.
   */
  readonly endSession: () => Promise<void>;
  /**
   * Tell an invited address that it has access. Resolves `true` if a message was sent.
   *
   * It reports rather than throws, because an invitation whose email failed is still a valid
   * invitation -- the person can be told by any other means. Silently returning `true` would
   * leave an admin waiting for someone who was never contacted.
   */
  readonly notifyInvitation: (email: string, tenantId: string) => Promise<boolean>;
  /**
   * The language to answer this request in, negotiated from its `Accept-Language`.
   *
   * On the context rather than resolved inside a procedure, because it is a property of the
   * request and not of any one endpoint -- and because the authorization middleware below
   * has to word a refusal before any procedure runs.
   */
  readonly locale: Locale;
  /**
   * Begin a per-tenant Google consent, returning the URL to send the browser to.
   *
   * A closure the HTTP layer builds, for the same reason `endSession` is one: the
   * composition root owns the Google client, and a procedure reaching for it would be a
   * transport layer holding infrastructure (`layer-injected-deps`).
   *
   * A refusal carries WHY. The narrower `{ ok: false }` this replaced left the procedure
   * nothing to report, and what it reported instead was a made-up URL -- see `router.ts`.
   * The service's own outcome type rather than a copy of it, so a refusal that learns a new
   * fact -- which provider has no client -- reaches the procedure that words it.
   */
  readonly startConsent: (input: {
    tenantId: string;
    source: string;
    startedBy: string;
    /** Connect a further account of the source's kind. ADR 0043. */
    addAccount?: boolean;
  }) => Promise<StartOutcome>;
  /**
   * The worker, for the two procedures needing a live token. `null` when unconfigured, and
   * the procedures say so rather than failing in a way that reads like an outage.
   */
  readonly worker: WorkerClient | null;
  /**
   * The public halves of the ingestion Google client, for the browser's Drive Picker. The
   * client SECRET is not in here and must never be: it stays in the process.
   */
  readonly googlePicker: { clientId: string; apiKey: string; appId: string } | null;
}

export type { Role } from "../services/authz.ts";

/** The facts a refusal names for a caller that acts on data: codes and ids, never sentences. */
export type RefusalFacts = Readonly<Record<string, string | null>>;

/**
 * The carrier for {@link RefusalFacts}, as a `TRPCError`'s cause.
 *
 * A cause because that is the one slot tRPC carries from a `throw` to the formatter below; a
 * class because the formatter must not publish an arbitrary cause -- a caught exception's
 * text is the row that caused it. Only a cause built HERE reaches the wire.
 */
class Refusal extends Error {
  readonly facts: RefusalFacts;

  constructor(facts: RefusalFacts) {
    super("refusal facts");
    this.facts = facts;
  }
}

/**
 * A worded refusal that also names its facts, which the answer carries as `data.details`.
 *
 * The sentence is for a person and is in their language; the facts are for an agent, which
 * matches on them the way it matches an error code, and so are never translated. The CLI
 * passes them on as its envelope's `error.details`, beside the zod issues it already puts
 * there -- so a refusal like "could not list Drive, reconnect" reaches an agent as something
 * it can act on rather than only as prose (issue 177).
 */
export function refusal(code: TRPCError["code"], message: string, facts: RefusalFacts): TRPCError {
  return new TRPCError({ code, message, cause: new Refusal(facts) });
}

const t = initTRPC.context<Context>().create({
  // Never development, whatever NODE_ENV says. tRPC's default reads `NODE_ENV !== "production"`,
  // the deployment sets no NODE_ENV, and in development mode every error -- an anonymous 401
  // included -- carries `data.stack`: server paths, line numbers, dependency versions (issue 152).
  isDev: false,
  errorFormatter({ shape, error }) {
    // Every answer that is an error names the request's trace, which is the one thing a
    // person can quote back that leads to the server's side of it. An opaque id, never a
    // payload -- `null` only outside a traced request, which a served request never is.
    const traced = { ...shape, data: { ...shape.data, traceId: currentTraceId() } };
    // The type, never the detail. Exception text routinely embeds the offending row, and
    // this response goes to a browser.
    if (error.code === "INTERNAL_SERVER_ERROR") {
      return { ...traced, message: "internal_error" };
    }
    if (error.cause instanceof Refusal) {
      return { ...traced, data: { ...traced.data, details: error.cause.facts } };
    }
    return traced;
  },
});

/**
 * The facts a refusal was built with (see `refusal`), or `null` for one built without any.
 *
 * For a door that is not tRPC's own HTTP adapter and so never runs the formatter above -- the
 * model-context door calls through `createCaller` and words its own answer. The class stays
 * private: this answers the one question such a door has, and nothing else can mint the cause.
 */
export function refusalFacts(error: TRPCError): RefusalFacts | null {
  return error.cause instanceof Refusal ? error.cause.facts : null;
}

export const { router } = t;

/**
 * The grant guard, at the root of every procedure -- the one door every caller shares.
 *
 * A `read` grant admits a call only when `surface.ts` classifies it `read`; anything else,
 * an unclassified path included, is refused here. Here and not in the model-context door that
 * mints read credentials, because a check in one door binds one door: the assistant, the CLI
 * and whatever arrives next all reach the router through this middleware, and none of them can
 * route around it. The door keeps its own check as well (`mcp.ts`), for a refusal worded before
 * any procedure is resolved -- but this is the one that holds.
 *
 * FORBIDDEN, worded, with the facts an agent matches on: the caller is authenticated, and what
 * they lack is a grant their owner can give them by minting a `write` token.
 */
export const publicProcedure = t.procedure.use(({ ctx, path, type, next }) => {
  if (!grantAdmits(ctx.grant, effectOf({ path, type }))) {
    throw refusal("FORBIDDEN", messages(ctx.locale)("error.writesDisabled"), {
      reason: "WRITES_DISABLED",
      grant: ctx.grant,
    });
  }
  return next();
});

export const authedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (ctx.user === null) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * A procedure only a person's own browser session may call: never a bearer credential.
 *
 * The procedures on it manage credentials. A token that could reach them could mint a token,
 * and a read token could mint itself a write one, so the grant its owner chose would bind
 * nothing. `SESSION_ONLY` in `surface.ts` is the list of them a bearer-only door leaves out,
 * and `procedureManifest` refuses a router whose list and this middleware disagree.
 *
 * FORBIDDEN rather than UNAUTHORIZED: the caller IS authenticated, and signing in again with
 * the same credential would change nothing. The sentence says where the action lives.
 */
export const sessionProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.via !== "session") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: messages(ctx.locale)("error.requiresSession"),
    });
  }
  return next();
});

/**
 * A procedure scoped to a tenant the caller holds authority in. Resolves that authority and
 * puts it on the context; a caller with none gets NOT_FOUND, never FORBIDDEN.
 *
 * "Authority", not "membership", since ADR 0013: a superadmin resolves to `admin` in any
 * tenant that exists, and to `null` in one that does not. `authorityIn` makes both paths
 * answer in the same shape, so the 404-not-403 reasoning above still happens exactly here
 * and exactly once -- which is the property that mattered before a second kind of caller
 * existed, and matters more now there is.
 */
export const tenantProcedure = authedProcedure
  .input(z.object({ tenantId: z.string().min(1) }))
  .use(async ({ ctx, input, next }) => {
    const role = await authorityIn(ctx.exec, {
      tenantId: input.tenantId,
      userId: ctx.user.userId,
      superadmin: ctx.superadmin,
    });
    if (role === null) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return next({ ctx: { ...ctx, role, tenantId: input.tenantId } });
  });

/**
 * A procedure only a platform superadmin may call.
 *
 * FORBIDDEN, not NOT_FOUND, and the difference is deliberate: these procedures are not
 * scoped to a tenant, so refusing one reveals nothing about which customers exist. There is
 * no enumeration oracle to protect here, and telling a signed-in operator plainly that they
 * lack platform authority is what lets the UI leave the affordance out rather than present
 * a button that fails.
 *
 * Note what this does NOT accept: a tenant `admin`. Platform authority is not the top of the
 * role ladder, it is beside it -- `ROLE_RANK` orders authority *within* a customer, and no
 * amount of it adds up to the right to create another one.
 */
export const superadminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.superadmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: messages(ctx.locale)("error.requiresSuperadmin"),
    });
  }
  return next();
});

/** Require at least `min` authority. FORBIDDEN here is correct: membership is established. */
export function requireRole(min: Role): ReturnType<typeof tenantProcedure.use> {
  return tenantProcedure.use(({ ctx, next }) => {
    if (!outranks(ctx.role, min)) {
      // Worded, because the UI shows this message to the caller verbatim. The two refusals
      // above it -- UNAUTHORIZED, and NOT_FOUND for a non-member -- deliberately carry no
      // message at all: what they must not do is confirm that the tenant exists.
      throw new TRPCError({
        code: "FORBIDDEN",
        message: messages(ctx.locale)("error.requiresRole", { role: min }),
      });
    }
    return next();
  });
}
