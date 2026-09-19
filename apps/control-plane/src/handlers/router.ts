import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import * as models from "../services/models.ts";
import * as people from "../services/people.ts";
import * as tenants from "../services/tenants.ts";
import {
  authedProcedure,
  publicProcedure,
  requireRole,
  router,
  superadminProcedure,
  tenantProcedure,
} from "./trpc.ts";
import { connectionsRouter } from "./connectionsRouter.ts";
import { Email, Role, TenantId } from "./inputs.ts";

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
    // `superadmin` is here so the SPA can leave out an affordance the caller cannot use --
    // courtesy, never the control. `superadminProcedure` refuses regardless of what the
    // browser chose to render, and this flag answers "am I one" and never "who are they",
    // which is the question that would turn this into a directory of the platform's
    // administrators.
    me: authedProcedure.query(({ ctx }) => ({
      userId: ctx.user.userId,
      email: ctx.user.email,
      superadmin: ctx.superadmin,
    })),

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
    list: authedProcedure.query(({ ctx }) =>
      tenants.listForCaller(ctx.exec, { userId: ctx.user.userId, superadmin: ctx.superadmin }),
    ),

    get: tenantProcedure.query(async ({ ctx, input }) => {
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
          actor: ctx.user.email,
        });

        if (!result.ok) {
          throw new TRPCError({
            code: "CONFLICT",
            message: messages(ctx.locale)("error.tenantExists", { tenantId: input.tenantId }),
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
     * `authorityIn` resolves them to `admin` in any tenant that exists.
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
          actor: ctx.user.email,
        });

        if (renamed === null) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        return renamed;
      }),
  }),

  connections: connectionsRouter,

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

  /**
   * The public halves of the Google client, for the browser's Picker.
   *
   * A client id and an API key are public by design -- they identify the app, they do not
   * authorise anything, and Google's own documentation puts both in page source. The client
   * SECRET is not here and never crosses this boundary.
   *
   * `authedProcedure` rather than public: there is no reason for an anonymous visitor to
   * learn which Google project a deployment belongs to.
   */
  config: router({
    google: authedProcedure.query(({ ctx }) => ctx.googlePicker),
  }),

  health: publicProcedure.query(() => ({ ok: true })),
});

export type AppRouter = typeof appRouter;
