/**
 * The `people` procedures.
 *
 * Split from `router.ts`, which had grown past what one file may be. Same layer and the
 * same rules: validate the input, call one service, decide what its answer means over HTTP.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Email, Role } from "./inputs.ts";
import { messages } from "../i18n/index.ts";
import * as people from "../services/people.ts";
import { requireRole, router, tenantProcedure } from "./trpc.ts";

export const peopleRouter = router({
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
});
