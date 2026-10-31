/**
 * The `people` procedures.
 *
 * Split from `router.ts`, which had grown past what one file may be. Same layer and the
 * same rules: validate the input, call one service, decide what its answer means over HTTP.
 */

import { TRPCError } from "@trpc/server";
import type { Locale } from "@undercroft/core";
import { z } from "zod";
import { Email, Role } from "./inputs.ts";
import { messages } from "../i18n/index.ts";
import * as people from "../services/people.ts";
import { noSuchRoleRefusal, notHeldRefusal } from "./accessRefusals.ts";
import { requirePermission } from "./permissionGate.ts";
import { actorOf, router } from "./trpc.ts";

/**
 * Why a role change or a removal was refused, worded for the caller.
 *
 * NOT_FOUND is safe to word here: `requirePermission` has already established that the caller
 * manages this tenant's people, so saying an address holds no role in it reveals nothing they
 * could not read off the roster. The last-admin refusal is CONFLICT, because the request is
 * well-formed and authorised and it is the tenant's present state that forbids it. A role the
 * customer lacks, and a change past the subset rule (ADR 0141), are worded where every router
 * that names a role words them.
 */
function membershipRefusal(
  ctx: { readonly locale: Locale; readonly tenantId: string },
  outcome: Exclude<people.MembershipResult, { ok: true }>,
  input: { readonly email: string; readonly role?: string },
): TRPCError {
  const t = messages(ctx.locale);
  switch (outcome.reason) {
    case "not-member":
      return new TRPCError({
        code: "NOT_FOUND",
        message: t("error.notMember", { email: input.email }),
      });
    case "last-admin":
      return new TRPCError({
        code: "CONFLICT",
        message: t("error.lastAdmin", { email: input.email }),
      });
    case "no-such-role":
      return noSuchRoleRefusal(ctx, input.role ?? "");
    default:
      return notHeldRefusal(ctx, outcome.lacking, outcome.objects);
  }
}

export const peopleRouter = router({
  /**
   * Who holds a role in the customer, and which. `people:manage`, as `invitations` is (ADR 0119).
   *
   * The roster and the open invitations are the customer's access list: every address that can
   * reach its connected accounts, and every one that soon may. Only a holder of `people:manage`
   * manages that list, so only they read it. A person's own actions stay theirs to read in every
   * customer, through `audit.mine` (ADR 0113). The browser keeps the division closed to anyone else; this
   * gate is the control, and the one the CLI, `/mcp` and the assistant reach as well.
   */
  members: requirePermission("people:manage").query(({ ctx }) =>
    people.members(ctx.exec, ctx.tenantId),
  ),

  /** The invitations sent into the customer. `people:manage`, for the reason `members` is. */
  invitations: requirePermission("people:manage").query(({ ctx }) =>
    people.invitationsFor(ctx.exec, ctx.tenantId),
  ),

  /**
   * Invite an address at a role, built-in or the customer's own.
   *
   * `people:manage`, and the subset rule (ADR 0141): an invitation grants a role inside a
   * customer's tenant, and the buttons behind some roles mint OAuth tokens into that customer's
   * accounting system, so nobody invites at a role holding more than they hold themselves.
   */
  invite: requirePermission("people:manage")
    .input(z.object({ email: Email, role: Role }))
    .mutation(async ({ ctx, input }) => {
      const result = await people.invite(ctx.exec, {
        tenantId: ctx.tenantId,
        email: input.email,
        role: input.role,
        held: { permissions: ctx.permissions, reach: ctx.reach },
        actor: actorOf(ctx),
        notify: ctx.notifyInvitation,
      });

      if (!result.ok) {
        if (result.reason === "no-such-role") {
          throw noSuchRoleRefusal(ctx, input.role);
        }
        if (result.reason === "not-held") {
          throw notHeldRefusal(ctx, result.lacking, result.objects);
        }
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

  /**
   * Change the role an existing member holds, under the subset rule, for the reason `invite` is:
   * both the role given and the role taken away must hold nothing the caller lacks.
   *
   * By address rather than user id, like `invite`: the address is what the roster shows and
   * what a person types at the command line.
   */
  setRole: requirePermission("people:manage")
    .input(z.object({ email: Email, role: Role }))
    .mutation(async ({ ctx, input }) => {
      const result = await people.setRole(ctx.exec, {
        tenantId: ctx.tenantId,
        email: input.email,
        role: input.role,
        held: { permissions: ctx.permissions, reach: ctx.reach },
        actor: actorOf(ctx),
      });
      if (!result.ok) {
        throw membershipRefusal(ctx, result, input);
      }
      return { email: input.email, role: input.role, previousRole: result.previous };
    }),

  /**
   * End an existing member's access, and with it every grant to them. Never the last admin's, and
   * only when the caller holds everything the member holds: removing is taking away.
   */
  removeMember: requirePermission("people:manage")
    .input(z.object({ email: Email }))
    .mutation(async ({ ctx, input }) => {
      const result = await people.removeMember(ctx.exec, {
        tenantId: ctx.tenantId,
        email: input.email,
        held: { permissions: ctx.permissions, reach: ctx.reach },
        actor: actorOf(ctx),
      });
      if (!result.ok) {
        throw membershipRefusal(ctx, result, input);
      }
      return { email: input.email, previousRole: result.previous };
    }),

  /** Withdraw an invitation that has not been accepted. */
  revokeInvitation: requirePermission("people:manage")
    .input(z.object({ id: z.uuid() }))
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
});
