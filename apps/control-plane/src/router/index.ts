import { hashToken, randomToken } from "@undercroft/crypto";
import { getConnection, listConnections } from "@undercroft/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authedProcedure, publicProcedure, requireRole, router, tenantProcedure } from "../trpc.ts";

/** How long an invitation stays open. Long enough to be acted on, short enough to expire. */
const INVITATION_DAYS = 7;

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
    list: authedProcedure.query(async ({ ctx }) => {
      // Only tenants the caller is a member of. This query IS the visibility boundary for
      // the list view.
      const { rows } = await ctx.exec.query<{ id: string; display_name: string; role: string }>(
        `SELECT t.id, t.display_name, m.role
         FROM app.tenant_member m JOIN ops.tenant t ON t.id = m.tenant_id
         WHERE m.user_id = $1 ORDER BY t.id`,
        [ctx.user.userId],
      );
      return rows.map((r) => ({ id: r.id, displayName: r.display_name, role: r.role }));
    }),

    get: tenantProcedure.query(async ({ ctx, input }) => {
      const { rows } = await ctx.exec.query<{ id: string; display_name: string }>(
        "SELECT id, display_name FROM ops.tenant WHERE id = $1",
        [input.tenantId],
      );
      const tenant = rows[0];
      if (tenant === undefined) throw new TRPCError({ code: "NOT_FOUND" });
      return { id: tenant.id, displayName: tenant.display_name, role: ctx.role };
    }),
  }),

  connections: router({
    list: tenantProcedure.query(({ ctx, input }) => listConnections(ctx.exec, input.tenantId)),

    get: tenantProcedure
      .input(z.object({ source: z.string().min(1) }))
      .query(({ ctx, input }) => getConnection(ctx.exec, input.tenantId, input.source)),

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
   * This is what closes the loop on invite-only sign-in: the gate admits an address that has
   * a live `app.invitation` row, and these procedures are how such a row comes to exist
   * without anyone opening a SQL client.
   *
   * No invitation token is ever returned or sent. `app.invitation.token_sha256` exists for a
   * link-based flow that this one does not use: Google and a one-time code already prove the
   * person controls the address, which is the only thing a token would have proved. A digest
   * of a random value is stored so the column keeps its shape and nothing replayable exists.
   */
  people: router({
    members: tenantProcedure.query(async ({ ctx, input }) => {
      const { rows } = await ctx.exec.query<{ user_id: string; email: string; role: string }>(
        `SELECT m.user_id, u.email, m.role
         FROM app.tenant_member m JOIN app.app_user u ON u.id = m.user_id
         WHERE m.tenant_id = $1 ORDER BY u.email`,
        [input.tenantId],
      );
      return rows.map((r) => ({ userId: r.user_id, email: r.email, role: r.role }));
    }),

    invitations: tenantProcedure.query(async ({ ctx, input }) => {
      // `status` is derived in SQL rather than from two nullable columns in the client, so
      // "expired" cannot disagree with the clock the gate reads.
      const { rows } = await ctx.exec.query<{
        id: string;
        email: string;
        role: string;
        status: string;
        expires_at: string;
      }>(
        `SELECT id, email, role, expires_at,
                CASE WHEN accepted_at IS NOT NULL THEN 'accepted'
                     WHEN expires_at <= now()     THEN 'expired'
                     ELSE 'pending' END AS status
         FROM app.invitation WHERE tenant_id = $1
         ORDER BY created_at DESC`,
        [input.tenantId],
      );
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        status: r.status,
        expiresAt: r.expires_at,
      }));
    }),

    /**
     * Invite an address.
     *
     * Admin-only: an invitation grants a role inside a customer's tenant, and the buttons
     * behind it mint OAuth tokens into that customer's accounting system.
     *
     * Re-inviting an address with a live invitation REFRESHES it rather than adding a second
     * row. Two open invitations for one address would both be redeemed at first sign-in,
     * which is a confusing way to grant one membership.
     */
    invite: requireRole("admin")
      .input(z.object({ email: Email, role: Role }))
      .mutation(async ({ ctx, input }) => {
        const alreadyMember = await ctx.exec.query<{ role: string }>(
          `SELECT m.role FROM app.tenant_member m JOIN app.app_user u ON u.id = m.user_id
           WHERE m.tenant_id = $1 AND u.email = $2`,
          [ctx.tenantId, input.email],
        );
        if (alreadyMember.rows[0] !== undefined) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `${input.email} already has access as ${alreadyMember.rows[0].role}.`,
          });
        }

        const { rows } = await ctx.exec.query<{ id: string }>(
          `INSERT INTO app.invitation (tenant_id, email, role, token_sha256, expires_at)
           VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval)
           RETURNING id`,
          [
            ctx.tenantId,
            input.email,
            input.role,
            hashToken(randomToken()),
            String(INVITATION_DAYS),
          ],
        );
        const id = rows[0]?.id;
        if (id === undefined) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        // Supersede any older open invitation for the same address, so exactly one is live.
        await ctx.exec.query(
          `DELETE FROM app.invitation
           WHERE tenant_id = $1 AND email = $2 AND accepted_at IS NULL AND id <> $3`,
          [ctx.tenantId, input.email, id],
        );

        await ctx.exec.query(
          `INSERT INTO ops.audit_log (tenant_id, actor, action, detail)
           VALUES ($1, $2, 'people.invite', $3)`,
          [ctx.tenantId, ctx.user.email, JSON.stringify({ email: input.email, role: input.role })],
        );

        // Whether the invitee was told is reported, never assumed: with no mail configured
        // the invitation is still valid and the admin has to pass the address on by hand.
        const notified = await ctx.notifyInvitation(input.email, ctx.tenantId);
        return { id, email: input.email, role: input.role, notified };
      }),

    /** Withdraw an invitation that has not been accepted. */
    revokeInvitation: requireRole("admin")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        // Scoped by tenant_id as well as id, so an admin of one tenant cannot revoke
        // another's invitation by guessing a uuid. `accepted_at IS NULL` because a redeemed
        // invitation is history -- removing access is removing the membership, not the
        // invitation, and conflating them would look like it worked and change nothing.
        const { rows } = await ctx.exec.query<{ id: string }>(
          `DELETE FROM app.invitation
           WHERE id = $1 AND tenant_id = $2 AND accepted_at IS NULL
           RETURNING id`,
          [input.id, ctx.tenantId],
        );
        if (rows[0] === undefined) {
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
      .input(z.object({ table: z.string().regex(/^[a-z][a-z0-9_]*$/) }))
      .query(async ({ ctx, input }) => {
        const { rows } = await ctx.exec.query<Record<string, unknown>>(
          `SELECT * FROM analytics.${input.table} LIMIT 50`,
        );
        return { rows };
      }),
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
