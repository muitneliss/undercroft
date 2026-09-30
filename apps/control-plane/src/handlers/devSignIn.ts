/**
 * The loopback sign-in method: `POST /api/auth/sign-in/dev`, and the browser holds a session for
 * `UNDERCROFT_DEV_SIGN_IN_AS`, with no Google client and no mail key. A developer's stack uses it,
 * and so does a desktop install, whose sign-in page takes it without a click when it is the only
 * way in (ADR 0094). The name is the variable's, kept so one door keeps one switch.
 *
 * A Better Auth plugin rather than a bypass around the library, and that is the whole design.
 * It ends the way the library's own email-OTP endpoint ends -- `createSession`, then
 * `setSessionCookie` -- so what it yields is an ordinary session: the same cookie, the same
 * `auth_session` row, the same `resolveCaller`, the same sign-out. Nothing downstream has a
 * second kind of caller to know about.
 *
 * It skips proving the address and nothing else:
 *
 *   - **The invite-only gate is asked first**, as the code-by-email path asks it, so an address
 *     that is neither invited nor a superadmin gets a refusal and no session.
 *   - **A first sign-in is provisioned like any other.** `internalAdapter.createUser` runs
 *     `validateUserInfo` and the `user.create.before` hook in `auth.ts`, which is where an
 *     invitation is redeemed into a membership.
 *   - **The address is fixed by configuration**, never taken from the request. An endpoint
 *     that proves nothing must not also let its caller choose who to be.
 *
 * And it exists only on loopback: `devSignIn` throws when asked to build it behind any other
 * origin, so a `.env` copied to a server stops the process at boot with the reason, instead of
 * starting with a door that proves nothing.
 *
 * **Loopback is not the whole of it, because a name can be rebound to loopback.** A web page on
 * `attacker.example` can point its own name at `127.0.0.1` (DNS rebinding) and then POST here
 * as a same-origin request: no cookie yet, so Better Auth's origin check never runs, and the
 * session it would get is for the attacker's host -- with every procedure behind it. So the
 * request must be addressed to the public URL's own host, which a rebound page cannot fake
 * because the browser writes `Host` from the name the page was loaded by. It mattered less while
 * only a developer ran this; a desktop install puts it on the machine of somebody who browses
 * the web (ADR 0094). A page opened on `127.0.0.1` when the public URL says `localhost` is
 * refused by the same line, and told which address to use.
 */

import { isLoopbackOrigin } from "@undercroft/core/loopback";
import type { SqlExecutor } from "@undercroft/db";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { messages } from "../i18n/index.ts";
import { isAdmissible } from "../services/invite.ts";
import type { Superadmins } from "../services/superadmin.ts";
import { localeOf } from "./authLocale.ts";

export interface DevSignInConfig {
  readonly exec: SqlExecutor;
  /** `UNDERCROFT_DEV_SIGN_IN_AS`: who every caller of this endpoint becomes. */
  readonly address: string;
  /** Better Auth's `baseURL`. Must be loopback, or construction throws. */
  readonly baseUrl: string;
  readonly superadmins: Superadmins;
}

export function devSignIn(config: DevSignInConfig): BetterAuthPlugin {
  if (!isLoopbackOrigin(config.baseUrl)) {
    throw new Error(
      "UNDERCROFT_DEV_SIGN_IN_AS signs in without proof; it is honoured only when " +
        `UNDERCROFT_PUBLIC_URL is a loopback origin, and it is ${config.baseUrl}`,
    );
  }
  // Normalised as `services/invite.ts` normalises, so the gate and the identity agree.
  const email = config.address.trim().toLowerCase();
  const { host, origin } = new URL(config.baseUrl);

  return {
    id: "undercroft-dev-sign-in",
    endpoints: {
      signInDev: createAuthEndpoint("/sign-in/dev", { method: "POST" }, async (ctx) => {
        // `request.url` is built from the `Host` the request arrived with. No request at all is
        // an in-process call, which nothing makes; refused all the same.
        if (ctx.request === undefined || new URL(ctx.request.url).host !== host) {
          throw new APIError("FORBIDDEN", {
            message: messages(localeOf(ctx))("error.localSignInElsewhere", { origin }),
          });
        }
        if (!(await isAdmissible(config.exec, email, config.superadmins))) {
          throw new APIError("FORBIDDEN", {
            message: messages(localeOf(ctx))("error.notInvited"),
          });
        }
        const found = await ctx.context.internalAdapter.findUserByEmail(email);
        const user =
          found?.user ??
          (await ctx.context.internalAdapter.createUser(
            { email, emailVerified: true, name: "" },
            { method: "dev" },
          ));
        const session = await ctx.context.internalAdapter.createSession(user.id);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ email: user.email });
      }),
    },
  };
}
