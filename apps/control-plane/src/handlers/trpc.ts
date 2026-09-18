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

import type { SqlExecutor } from "@undercroft/db";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { outranks, type Role, roleFor } from "../services/authz.ts";

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
}

export type { Role };

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
  if (ctx.user === null) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * A procedure scoped to a tenant the caller is a member of. Resolves the caller's role and
 * puts it on the context; a non-member gets NOT_FOUND, never FORBIDDEN.
 */
export const tenantProcedure = authedProcedure
  .input(z.object({ tenantId: z.string().min(1) }))
  .use(async ({ ctx, input, next }) => {
    const role = await roleFor(ctx.exec, input.tenantId, ctx.user.userId);
    if (role === null) throw new TRPCError({ code: "NOT_FOUND" });
    return next({ ctx: { ...ctx, role, tenantId: input.tenantId } });
  });

/** Require at least `min` authority. FORBIDDEN here is correct: membership is established. */
export function requireRole(min: Role) {
  return tenantProcedure.use(({ ctx, next }) => {
    if (!outranks(ctx.role, min)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `requires ${min}` });
    }
    return next();
  });
}
