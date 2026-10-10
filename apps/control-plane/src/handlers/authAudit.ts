/**
 * What sign-in writes to the audit log (ADR 0113, ADR 0120), as Better Auth's hooks: a session
 * begun, a session ended, a code turned away, a consent given.
 *
 * Here, at the library's own hooks, rather than at our routes, because each of these has more
 * than one way to happen and the hook is the one place all of them pass. A session is what every
 * way in ends with -- a code, a Google account, the CLI's sign-in, a development install -- and
 * its deletion is what both ways out do: the `session.signOut` procedure, which asks Better Auth
 * to sign out, and Better Auth's own `/sign-out`, which the browser may call directly. Recording
 * sign-out at the deletion is what makes one sign-out one row whichever way it went.
 *
 * One plugin (`auditPlugin`) rather than hooks threaded through `auth.ts`'s configuration, so the
 * configuration says that sign-in is audited in one line and this module says how. Which request
 * grants a consent, and how to read one, is `mcpConsent.ts`'s; what is recorded of it is here.
 */

import type { SqlExecutor } from "@undercroft/db";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { type Channel, recordEvent } from "../services/audit.ts";
import {
  isAdmissible,
  type RefusedVia,
  recordRefusal,
  type SignInRefusal,
} from "../services/invite.ts";
import type { Superadmins } from "../services/superadmin.ts";
import type { HookContext } from "./authLocale.ts";
import { channelOf } from "./channel.ts";
import { type AfterHook, consentHook, type OnConsent } from "./mcpConsent.ts";

type SessionHooks = NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["session"]>;

/**
 * The door a Better Auth request came through: the CLI names itself, anything else is the web.
 * Read off the hook's context the way `localeOf` reads the language, for the same reason: inside
 * Better Auth there is no `Context`, only the request it was handed.
 */
function channelIn(context: HookContext | null | undefined): Channel {
  return channelOf("cookie", context?.request?.headers ?? context?.headers);
}

/** Better Auth's sign-out endpoint, the one deletion of a session that is somebody signing out. */
const SIGN_OUT_PATH = "/sign-out";

/**
 * A session begun is `auth.signIn`, naming the Better Auth path that made it -- which way in it
 * was. A session deleted by `/sign-out` is `auth.signOut`, however that endpoint was reached.
 * Other deletions are not sign-outs and are not recorded as one: `/get-session` clearing an
 * expired session, a person's removal taking their sessions with it.
 *
 * The address comes from Better Auth's own adapter, not a query of ours: the session names only
 * its `auth_user`, and that table is Better Auth's, wherever it is kept. Better Auth keeps it
 * lowercased, which is how `app.app_user` keys it.
 */
function sessionHooks(exec: SqlExecutor): SessionHooks {
  return {
    create: {
      after: async (session, context): Promise<void> => {
        const user = await context?.context.internalAdapter.findUserById(session.userId);
        if (user === null || user === undefined) {
          return;
        }
        await recordEvent(exec, {
          action: "auth.signIn",
          email: user.email,
          channel: channelIn(context),
          detail: { endpoint: context?.path ?? null },
        });
      },
    },
    delete: {
      after: async (session, context): Promise<void> => {
        if (context?.path !== SIGN_OUT_PATH) {
          return;
        }
        const user = await context.context.internalAdapter.findUserById(session.userId);
        if (user === null) {
          return;
        }
        await recordEvent(exec, {
          action: "auth.signOut",
          email: user.email,
          channel: channelIn(context),
        });
      },
    },
  };
}

/**
 * Record an address turned away because it may not hold a session at all (`NOT_INVITED`), through
 * the door the request that tried came in by.
 */
export function refuseUninvited(
  exec: SqlExecutor,
  attempt: { email: string; via: RefusedVia },
  context: HookContext | null | undefined,
): Promise<void> {
  return recordRefusal(exec, { ...attempt, channel: channelIn(context), reason: "NOT_INVITED" });
}

/** The endpoint a one-time code is offered to. */
const CODE_SIGN_IN_PATH = "/sign-in/email-otp";

/**
 * The email-OTP plugin's refusals of a code (`better-auth/plugins/email-otp`'s
 * `EMAIL_OTP_ERROR_CODES`, 1.7.5), as the reasons this log owns. A code it refuses for any other
 * reason is not one of these and is not recorded as one.
 */
const CODE_REFUSALS: ReadonlyMap<unknown, SignInRefusal> = new Map([
  ["INVALID_OTP", "WRONG_CODE"],
  ["OTP_EXPIRED", "CODE_EXPIRED"],
  ["TOO_MANY_ATTEMPTS", "TOO_MANY_ATTEMPTS"],
] as const);

/** The address a code was offered for, as the form sent it, or `""` for none. */
function offeredFor(body: unknown): string {
  return typeof body === "object" &&
    body !== null &&
    "email" in body &&
    typeof body.email === "string"
    ? body.email
    : "";
}

/**
 * An after-hook that records a one-time code turned away for an address that may sign in, as
 * `auth.refused`.
 *
 * Only for an admissible address. One that is not was never sent a code and was recorded as
 * `NOT_INVITED` when it asked for one; a code offered for it is somebody typing at a form that
 * can only refuse them, and a row for each attempt would be the log filling itself on a
 * stranger's behalf. A wrong code for an address that IS somebody's is what that person, and an
 * operator, want to see.
 */
function codeRefusalHook(exec: SqlExecutor, superadmins: Superadmins): AfterHook {
  return {
    matcher: (context): boolean => context.path === CODE_SIGN_IN_PATH,
    handler: createAuthMiddleware(async (ctx) => {
      const { returned } = ctx.context;
      const reason = isAPIError(returned) ? CODE_REFUSALS.get(returned.body?.code) : undefined;
      const email = offeredFor(ctx.body);
      if (reason === undefined || !(await isAdmissible(exec, email, superadmins))) {
        return;
      }
      await recordRefusal(exec, { email, via: "email-otp", channel: channelIn(ctx), reason });
    }),
  };
}

/**
 * A consent given to a model-context app (ADR 0061), as `auth.consentGranted`: the app by the id
 * its calls are audited under, and the scopes the stored consent grants. Never the app's own name,
 * which whoever registered it chose.
 */
function recordConsent(exec: SqlExecutor): OnConsent {
  return async (consented, request): Promise<void> => {
    await recordEvent(exec, {
      action: "auth.consentGranted",
      email: consented.email,
      channel: channelIn(request),
      detail: { client: consented.credential, scopes: consented.scopes.join(" ") },
    });
  };
}

/**
 * Everything sign-in writes to the audit log, as one plugin: the session hooks it contributes
 * through `init` -- which Better Auth runs beside the configuration's own -- and the after-hooks
 * for what no database hook sees, a code turned away and a consent given. An after-hook whose
 * endpoint this install does not have -- no code by email, no authorization server -- never runs.
 */
export function auditPlugin(exec: SqlExecutor, superadmins: Superadmins): BetterAuthPlugin {
  return {
    id: "undercroft-audit",
    init: () => ({ options: { databaseHooks: { session: sessionHooks(exec) } } }),
    hooks: { after: [codeRefusalHook(exec, superadmins), consentHook(recordConsent(exec))] },
  };
}
