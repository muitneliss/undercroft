/**
 * The `tenants` procedures.
 *
 * Split from `router.ts`, which had grown past what one file may be. Same layer and the
 * same rules: validate the input, call one service, decide what its answer means over HTTP.
 */

import { TRPCError } from "@trpc/server";
import type { Locale } from "@undercroft/core";
import { z } from "zod";
import { TenantId } from "./inputs.ts";
import { messages } from "../i18n/index.ts";
import * as tenants from "../services/tenants.ts";
import type { Tenant, TransitionResult } from "../services/tenants.ts";
import {
  actorOf,
  authedProcedure,
  refusal,
  requireRole,
  router,
  superadminProcedure,
  tenantStatusProcedure,
} from "./trpc.ts";

/**
 * What a deactivation or reactivation answers: the tenant as it now stands, or the refusal.
 *
 * One mapping for both directions, so "already in that state" is the same code either way --
 * PRECONDITION_FAILED, as the middleware refuses a deactivated customer -- and the sentence and
 * the facts name the state the customer is actually in, whichever way the caller pushed.
 */
function transitioned(
  ctx: { readonly locale: Locale; readonly tenantId: string },
  result: TransitionResult,
): Tenant {
  if (result.ok) {
    return result.tenant;
  }
  if (result.reason === "not-found") {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  const deactivated = result.reason === "already-deactivated";
  throw refusal(
    "PRECONDITION_FAILED",
    messages(ctx.locale)(deactivated ? "error.tenantDeactivated" : "error.tenantNotDeactivated"),
    { reason: deactivated ? "TENANT_DEACTIVATED" : "TENANT_ACTIVE", tenantId: ctx.tenantId },
  );
}

export const tenantsRouter = router({
  list: authedProcedure.query(({ ctx }) =>
    tenants.listForCaller(ctx.exec, { userId: ctx.user.userId, superadmin: ctx.superadmin }),
  ),

  /**
   * One customer, and the caller's role in it -- answered while it is deactivated too.
   *
   * `tenantStatusProcedure`, deliberately: this is how a page, the CLI or an agent learns that
   * a customer is deactivated (`deactivatedAt`), and a refusal in its place would leave them
   * nothing to render but an error. It reveals no data the deactivation withholds: a name, an
   * id and a role the caller already holds.
   */
  get: tenantStatusProcedure.query(async ({ ctx, input }) => {
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
        actor: actorOf(ctx),
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
   * `accessIn` resolves them to `admin` in any tenant that exists.
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
        actor: actorOf(ctx),
      });

      if (renamed === null) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return renamed;
    }),

  /**
   * Deactivate a customer: every member loses access, and nothing more is started for it, until
   * an admin reactivates it. Nothing is deleted. ADR 0110.
   *
   * Tenant admin, for the reason `rename` is: an act inside one customer, which a superadmin
   * reaches as that customer's admin. On `tenantProcedure` like every other, so deactivating a
   * customer that is already deactivated is refused by the middleware with the same
   * PRECONDITION_FAILED every procedure gives there; the service's own `already-deactivated`
   * is the same answer for the one caller who loses a race to a second admin.
   */
  deactivate: requireRole("admin").mutation(async ({ ctx }) => {
    const result = await tenants.deactivate(ctx.exec, {
      tenantId: ctx.tenantId,
      actor: actorOf(ctx),
    });
    return transitioned(ctx, result);
  }),

  /**
   * Reactivate a deactivated customer: access and schedules return as they were. Tenant admin.
   *
   * The one admin procedure on `tenantStatusProcedure`, since it is the way out of the state
   * every other procedure refuses in. PRECONDITION_FAILED, worded, for a customer that is not
   * deactivated -- the same code as the refusal it undoes, so a transition to the state a
   * customer is already in reads the same in both directions, and is never a quiet success.
   */
  reactivate: requireRole("admin", tenantStatusProcedure).mutation(async ({ ctx }) => {
    const result = await tenants.reactivate(ctx.exec, {
      tenantId: ctx.tenantId,
      actor: actorOf(ctx),
    });
    return transitioned(ctx, result);
  }),
});
