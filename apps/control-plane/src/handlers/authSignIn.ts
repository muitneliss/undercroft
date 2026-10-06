/**
 * The sign-in record (ADR 0113), as Better Auth's session hook.
 *
 * A session is what every way in ends with -- a code, a Google account, the CLI's sign-in, a
 * development install -- so its creation is the one place all of them pass. Its own module beside
 * `auth.ts`, as `authLocale.ts` is, because that file is long enough already.
 */

import type { SqlExecutor } from "@undercroft/db";
import type { BetterAuthOptions } from "better-auth";
import { recordSignIn } from "../services/invite.ts";
import { channelOf } from "./channel.ts";

type SessionHooks = NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["session"]>;

/**
 * The address comes from Better Auth's own adapter, not a query of ours: the session names only
 * its `auth_user`, and that table is Better Auth's, wherever it is kept.
 */
export function signInHooks(exec: SqlExecutor): SessionHooks {
  return {
    create: {
      after: async (session, context): Promise<void> => {
        const user = await context?.context.internalAdapter.findUserById(session.userId);
        if (user === null || user === undefined) {
          return;
        }
        await recordSignIn(exec, {
          email: user.email,
          channel: channelOf("cookie", context?.request?.headers ?? context?.headers),
          endpoint: context?.path ?? null,
        });
      },
    },
  };
}
