/**
 * The `grants` procedures: one permission given to a role or to one member, standing or until a
 * moment. ADR 0141.
 *
 * Reading them needs `people:manage`, not `roles:manage`: a grant to a person says who holds what,
 * which is the roster's information and is read by whoever may read the roster (ADR 0119). Giving
 * or taking one away needs `roles:manage` and the subset rule inside the service.
 *
 * A subject is `role` (a key) or `email` (a member's address), exactly one of the two -- two plain
 * fields rather than a nested object, so a person at the CLI types `--role` or `--email` and an
 * agent fills one field.
 */

import type { TRPCError } from "@trpc/server";
import { PERMISSIONS } from "@undercroft/contracts/access";
import type { Locale } from "@undercroft/core";
import { z } from "zod";

import { messages } from "../i18n/index.ts";
import * as grants from "../services/grants.ts";
import { noSuchRoleRefusal, notHeldRefusal, notMemberRefusal } from "./accessRefusals.ts";
import { Email, Role } from "./inputs.ts";
import { requirePermission } from "./permissionGate.ts";
import { actorOf, refusal, router } from "./trpc.ts";

/** Who a request names, as the schema takes it: a role by key, or a member by address. */
const Subject = { role: Role.optional(), email: Email.optional() };

/** The refusal for a subject that could not be resolved, worded for the caller. */
function subjectRefusal(
  ctx: { readonly locale: Locale; readonly tenantId: string },
  reason: "one-subject" | "no-such-role" | "not-member",
  named: { readonly role?: string | undefined; readonly email?: string | undefined },
): TRPCError {
  switch (reason) {
    case "one-subject":
      return refusal("BAD_REQUEST", messages(ctx.locale)("error.grantOneSubject"), {
        reason: "ONE_SUBJECT",
      });
    case "no-such-role":
      return noSuchRoleRefusal(ctx, named.role ?? "");
    default:
      return notMemberRefusal(ctx, named.email ?? "");
  }
}

export const grantsRouter = router({
  /**
   * Every grant in the customer, expired ones included and marked, or the grants to one role or
   * one member. Each names its permission, or `null` for one the catalogue no longer knows.
   */
  list: requirePermission("people:manage")
    .input(z.object(Subject))
    .query(async ({ ctx, input }) => {
      const outcome = await grants.list(ctx.exec, ctx.tenantId, input);
      if (!outcome.ok) {
        throw subjectRefusal(ctx, outcome.reason, input);
      }
      return outcome.grants;
    }),

  /**
   * Give a permission to a role or a member, standing or until `expiresAt` (an ISO 8601 moment
   * with its offset). The same grant stored already has its expiry moved; an identical one is
   * `unchanged: true`. Refused for a permission the caller does not hold.
   */
  save: requirePermission("roles:manage")
    .input(
      z.object({
        ...Subject,
        permission: z.enum(PERMISSIONS),
        expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const outcome = await grants.save(ctx.exec, {
        tenantId: ctx.tenantId,
        role: input.role,
        email: input.email,
        permission: input.permission,
        expiresAt: input.expiresAt,
        held: ctx.permissions,
        now: new Date(),
        actor: actorOf(ctx),
        actorId: ctx.user.userId,
      });
      if (outcome.ok) {
        return { id: outcome.id, unchanged: outcome.unchanged };
      }
      switch (outcome.reason) {
        case "not-held":
          throw notHeldRefusal(ctx, outcome.lacking);
        case "expired":
          throw refusal(
            "BAD_REQUEST",
            messages(ctx.locale)("error.grantExpiryPassed", { expiresAt: input.expiresAt ?? "" }),
            { reason: "EXPIRY_PASSED", expiresAt: input.expiresAt },
          );
        default:
          throw subjectRefusal(ctx, outcome.reason, input);
      }
    }),

  /** Take one grant away, by id. Refused for a grant of a permission the caller does not hold. */
  delete: requirePermission("roles:manage")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const outcome = await grants.remove(ctx.exec, {
        tenantId: ctx.tenantId,
        id: input.id,
        held: ctx.permissions,
        actor: actorOf(ctx),
      });
      if (outcome.ok) {
        return { ok: true };
      }
      if (outcome.reason === "not-held") {
        throw notHeldRefusal(ctx, outcome.lacking);
      }
      throw refusal("NOT_FOUND", messages(ctx.locale)("error.noSuchGrant"), {
        reason: "GRANT_NOT_FOUND",
        id: input.id,
      });
    }),
});
