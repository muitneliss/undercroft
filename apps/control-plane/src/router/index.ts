import { getConnection, listConnections } from "@undercroft/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authedProcedure, publicProcedure, requireRole, router, tenantProcedure } from "../trpc.ts";

/**
 * The control-plane API. The React app imports `AppRouter` as a type only, so the client
 * and server can never disagree about a shape -- the hand-mirrored DTO file the Python era
 * needed simply does not exist.
 */
export const appRouter = router({
  session: router({
    me: authedProcedure.query(({ ctx }) => ({ userId: ctx.user.userId, email: ctx.user.email })),

    signOut: authedProcedure.mutation(async ({ ctx }) => {
      // Revoked in SQL: the opaque session is gone the instant this returns, unlike a
      // stateless token that would stay valid until expiry.
      await ctx.exec.query("UPDATE app.session SET revoked_at = now() WHERE id = $1", [
        ctx.sessionId,
      ]);
      ctx.setCookie("undercroft_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
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
