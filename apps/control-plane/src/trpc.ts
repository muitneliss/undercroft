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
 *   accounting system. Revocation and expiry are checked in SQL, so a session revoked a
 *   moment ago cannot be used by a request that read the row just before.
 */

import type { SqlExecutor } from "@undercroft/db";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";

export interface SessionUser {
  readonly userId: string;
  readonly email: string;
}

export interface Context {
  readonly exec: SqlExecutor;
  readonly user: SessionUser | null;
  readonly sessionId: string;
  /** Set by the HTTP layer so a procedure can hand the browser a cookie to clear. */
  readonly setCookie: (value: string) => void;
}

export type Role = "viewer" | "member" | "admin";
export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };

/** Resolve a session cookie to a user, checking revocation and expiry in SQL. */
export async function userForSession(
  exec: SqlExecutor,
  sessionId: string,
): Promise<SessionUser | null> {
  if (sessionId === "") return null;
  const { rows } = await exec.query<{ user_id: string; email: string }>(
    `SELECT u.id AS user_id, u.email
     FROM app.session s JOIN app.app_user u ON u.id = s.user_id
     WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sessionId],
  );
  const row = rows[0];
  return row === undefined ? null : { userId: row.user_id, email: row.email };
}

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
    const { rows } = await ctx.exec.query<{ role: Role }>(
      "SELECT role FROM app.tenant_member WHERE tenant_id = $1 AND user_id = $2",
      [input.tenantId, ctx.user.userId],
    );
    const role = rows[0]?.role;
    if (role === undefined) throw new TRPCError({ code: "NOT_FOUND" });
    return next({ ctx: { ...ctx, role, tenantId: input.tenantId } });
  });

/** Require at least `min` authority. FORBIDDEN here is correct: membership is established. */
export function requireRole(min: Role) {
  return tenantProcedure.use(({ ctx, next }) => {
    if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) {
      throw new TRPCError({ code: "FORBIDDEN", message: `requires ${min}` });
    }
    return next();
  });
}
