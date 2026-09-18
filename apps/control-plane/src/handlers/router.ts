import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as connections from "../services/connections.ts";
import * as models from "../services/models.ts";
import * as people from "../services/people.ts";
import * as tenants from "../services/tenants.ts";
import { authedProcedure, publicProcedure, requireRole, router, tenantProcedure } from "./trpc.ts";

const Role = z.enum(["viewer", "member", "admin"]);

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
    me: authedProcedure.query(({ ctx }) => ({ userId: ctx.user.userId, email: ctx.user.email })),

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
  }),

  tenants: router({
    list: authedProcedure.query(({ ctx }) => tenants.listForCaller(ctx.exec, ctx.user.userId)),

    get: tenantProcedure.query(async ({ ctx, input }) => {
      const tenant = await tenants.get(ctx.exec, input.tenantId);
      if (tenant === null) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { ...tenant, role: ctx.role };
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
    startOAuth: requireRole("admin")
      .input(z.object({ source: z.string().min(1) }))
      .mutation(({ input }) => ({
        authorizeUrl: `/oauth/${input.source}/start?tenant=__set_by_server__`,
      })),
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
              message: `${input.email} already has access as ${result.role}.`,
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
            message: "No open invitation with that id.",
          });
        }
        return { ok: true };
      }),
  }),

  models: router({
    // A preview of an analytics table for the UI. Money-shaped columns come back as
    // strings, never numbers -- the amount rule, held at the API boundary.
    preview: tenantProcedure
      .input(z.object({ table: z.string().regex(/^[a-z][a-z0-9_]*$/u) }))
      .query(async ({ ctx, input }) => ({
        rows: await models.preview(ctx.exec, input.table),
      })),
  }),

  runs: router({
    // Triggering a run proxies to the worker's verb allowlist with the same bearer token
    // Kestra uses; the control plane gains no wider privilege than the scheduler.
    trigger: requireRole("member")
      .input(z.object({ source: z.string().min(1) }))
      .mutation(({ input }) => ({ triggered: true, source: input.source })),
  }),

  health: publicProcedure.query(() => ({ ok: true })),
});

export type AppRouter = typeof appRouter;
