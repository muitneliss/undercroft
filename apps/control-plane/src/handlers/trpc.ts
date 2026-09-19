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
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import { authorityIn, outranks, type Role } from "../services/authz.ts";
import type { WorkerClient } from "../services/workerClient.ts";

export interface SessionUser {
  readonly userId: string;
  readonly email: string;
}

export interface Context {
  readonly exec: SqlExecutor;
  readonly user: SessionUser | null;
  /** Better Auth's session id, or `""` when unauthenticated. For audit, not for authority. */
  readonly sessionId: string;
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
   */
  readonly startConsent: (input: {
    tenantId: string;
    source: string;
    startedBy: string;
  }) => Promise<
    | { ok: true; authorizeUrl: string }
    | { ok: false; reason: "not-configured" | "unsupported-source" }
  >;
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

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    // The type, never the detail. Exception text routinely embeds the offending row, and
    // this response goes to a browser.
    if (error.code === "INTERNAL_SERVER_ERROR") {
      return { ...shape, message: "internal_error" };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.user === null) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
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
