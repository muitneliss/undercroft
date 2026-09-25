/**
 * The caller's own account: today, their personal access tokens (ADR 0059).
 *
 * Every procedure here is a `sessionProcedure`. They manage credentials, and a credential that
 * could reach them could mint another -- a read token would mint itself a write one -- so only
 * the person's own browser session (or the CLI, which signs in with the same cookie) may call
 * them. `SESSION_ONLY` in `surface.ts` names them for the door that holds only bearers.
 *
 * Keyed by the caller, never by an argument: there is no "whose tokens" input, so there is no
 * way to ask about somebody else's. A token that is not the caller's is NOT_FOUND on revoke,
 * the same answer as one that does not exist.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as accessTokens from "../services/accessTokens.ts";
import { router, sessionProcedure } from "./trpc.ts";

export const accountRouter = router({
  tokens: router({
    list: sessionProcedure.query(({ ctx }) => accessTokens.list(ctx.exec, ctx.user.userId)),

    /** The token is in this answer and in no other, ever. */
    mint: sessionProcedure
      .input(
        z.object({
          label: z.string().trim().min(1).max(80),
          grant: z.enum(["read", "write"]),
          expiresInDays: z.number().int().min(1).max(accessTokens.MAX_TOKEN_DAYS),
        }),
      )
      .mutation(({ ctx, input }) =>
        accessTokens.mint(ctx.exec, {
          userId: ctx.user.userId,
          actor: ctx.user.email,
          label: input.label,
          grant: input.grant,
          expiresInDays: input.expiresInDays,
        }),
      ),

    revoke: sessionProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const revoked = await accessTokens.revoke(ctx.exec, {
          userId: ctx.user.userId,
          id: input.id,
          actor: ctx.user.email,
        });
        if (!revoked) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { ok: true };
      }),
  }),
});
