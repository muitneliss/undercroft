/**
 * The Better Auth instance: Google, and a one-time code by email.
 *
 * Why a library at all, when the rest of this repo writes its own SQL: the parts of sign-in
 * that are easy to get subtly wrong -- OAuth state, PKCE, cookie signing, OTP attempt
 * limits, account linking -- are exactly the parts where a subtle mistake is a silent
 * authentication bypass rather than a failed test. See ADR 0010.
 *
 * Four things here are load-bearing and will look like noise to a future reader:
 *
 * 1. **`search_path`, not a schema prefix.** Better Auth emits unqualified table names, so
 *    it is handed a pool whose `search_path` is `app` and the model names below are bare.
 *    Its tables are still `app.auth_*`; nothing else in the codebase relies on an
 *    unqualified name resolving.
 *
 * 2. **Every field is mapped.** Better Auth's columns are camelCase and this database is
 *    snake_case. The mapping is mechanical but it is not optional -- a missed entry is a
 *    query against a column that does not exist, at login, in production.
 *
 * 3. **`cookieCache` is deliberately NOT enabled.** It would serve a session out of a
 *    signed cookie without reading the database, which means a revoked session keeps
 *    working until the cache expires. `trpc.ts` explains why that is unacceptable here:
 *    the buttons behind this cookie mint OAuth tokens into a customer's accounting system.
 *    Enabling it to save a query would reintroduce the stateless-token behaviour this
 *    design rejects.
 *
 * 4. **`disableSignUp` is NOT set on the OTP plugin.** It reads like the obvious way to
 *    enforce invite-only, and it is the wrong tool: Better Auth's send endpoint returns
 *    success *without mailing anything* to an address that has no account yet -- which is
 *    every invited person's first sign-in. Setting it would make sign-in by code silently
 *    impossible for exactly the people it is meant for.
 *
 * Invite-only is enforced in three independent places, because a single gate that fails
 * open is an open control plane:
 *
 *   * **`user.validateUserInfo`** -- refuses an uninvited identity before it is created,
 *     and again on every returning *Google* sign-in. Fails closed by the library's design.
 *   * **`sendVerificationOTP`** -- will not put a code in the post for an address that
 *     could not use it, so this platform cannot be made to email strangers.
 *   * **`resolveCaller` in `server.ts`** -- no `app.app_user` row, no `Context.user`, so
 *     even a validly-signed session for a removed account is unauthenticated on arrival.
 *     This is the layer that covers a returning sign-in by code.
 *
 * `databaseHooks.user.create.before` is the provisioning step, not a fourth gate: it is
 * where an invitation is actually redeemed into a membership.
 */

import { type EmailSender, type Locale, negotiateLocale } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { messages } from "../i18n/index.ts";
import { isAdmissible, recordRefusal, resolveInvitedUser } from "../services/invite.ts";

/**
 * Which language to answer a Better Auth hook in.
 *
 * `/trpc` resolves this once per request in `server.ts`; inside these hooks there is no
 * `Context`, because they are called from within the library. Better Auth hands each of them
 * the endpoint context, which carries the originating request -- and therefore the same
 * `Accept-Language` the browser sent, so the answer is the same one arrived at the same way.
 *
 * Structural rather than Better Auth's own `GenericEndpointContext`: the two hooks are given
 * slightly different shapes, and this depends on the one field both actually carry.
 *
 * Everything here is optional in the library's types, because a sign-in driven by something
 * other than an HTTP call has no request at all. That resolves to Vietnamese, which is the
 * product's default and not a guess -- `negotiateLocale` records why.
 */
interface HookContext {
  readonly request?: Request | undefined;
  readonly headers?: Headers | undefined;
}

function localeOf(context: HookContext | null | undefined): Locale {
  const asked =
    context?.request?.headers.get("accept-language") ??
    context?.headers?.get("accept-language") ??
    null;
  return negotiateLocale(asked);
}

/** How long a code is good for. Long enough to switch to a mail client, not to a new day. */
const OTP_EXPIRES_SECONDS = 600;

export interface GoogleCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Runs `fn` in one transaction.
 *
 * A seam rather than a `Pool`, because redeeming an invitation reads and then writes on what
 * it read, and that must be atomic under `pg` in production *and* under PGlite in the gate.
 * Production passes `(fn) => withTransaction(pool, fn)`; a test passes its own.
 */
export type Transactor = <T>(fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;

export interface AuthConfig {
  /**
   * Where Better Auth keeps its own four tables.
   *
   * Production passes a pool built with `createPool(dsn, { searchPath: "app" })` — without
   * the search path, every query fails on an unqualified table name. The gate passes
   * `memoryAdapter`, which is how the real handler boots with no Docker and no network.
   */
  readonly database: BetterAuthOptions["database"];
  /**
   * For reading `app.app_user` and `app.invitation`. Separate from `database` because the
   * gates query OUR tables, fully qualified, and must not depend on a `search_path` set for
   * somebody else's benefit.
   */
  readonly exec: SqlExecutor;
  readonly transactor: Transactor;
  /** `UNDERCROFT_SESSION_SECRET`. Signs session cookies; rotating it ends every session. */
  readonly secret: string;
  /** The origin the browser reaches this control plane on, e.g. `https://app.example.test`. */
  readonly baseUrl: string;
  readonly email: EmailSender;
  /** Omitted for an install that signs in by emailed code only. */
  readonly google?: GoogleCredentials;
  /** Where a failed OTP send is reported. Sending is not awaited, so this is the only trace. */
  readonly onEmailError?: (error: unknown) => void;
}

/** What a resolved session tells us. Everything else Better Auth returns is unused here. */
export interface AuthSession {
  readonly session: { readonly id: string };
  readonly user: { readonly email: string };
}

/**
 * The two things the HTTP layer needs from Better Auth, and nothing else.
 *
 * A narrow seam for the same reason `SqlExecutor` is one: the server depends on two
 * methods instead of the library's entire inferred surface, so a test can hand it a real
 * small implementation rather than mocking a framework -- and TypeScript can name the type
 * without reaching into a nested `node_modules`.
 */
export interface Auth {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(input: { headers: Headers }): Promise<AuthSession | null>;
    /** Revoke the caller's session. Better Auth deletes the row rather than flagging it. */
    signOut(input: { headers: Headers }): Promise<unknown>;
  };
}

export function createAuth(config: AuthConfig): Auth {
  return betterAuth({
    database: config.database,
    secret: config.secret,
    baseURL: config.baseUrl,
    // Same-origin: the SPA is served by this process, so the only trusted origin is itself.
    trustedOrigins: [config.baseUrl],

    user: {
      modelName: "auth_user",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      /**
       * The identity gate, and the outermost of the three.
       *
       * Better Auth calls this before creating a user, before linking an account, and --
       * the part that matters -- on every OAuth *sign-in*, including a returning one. So
       * withdrawing someone's access takes effect on their next Google sign-in rather than
       * whenever their session happens to expire.
       *
       * It is read-only by construction (`isAdmissible`, not `resolveInvitedUser`) because
       * it runs on paths where nothing should be provisioned. The library fails this hook
       * CLOSED: if it throws, the sign-in is refused rather than allowed.
       */
      validateUserInfo: async ({ user }) => {
        // An identity with no address cannot be matched to an invitation, so it is refused:
        // `isAdmissible("")` is false. Failing closed on a missing email is the point.
        if (await isAdmissible(config.exec, user.email ?? "")) return;

        // Recorded, because the person on the other side sees only "No access" and the
        // operator needs to know WHICH address was turned away -- usually a typo or the
        // wrong Google account.
        await recordRefusal(config.exec, { email: user.email ?? "", via: "google" });

        return {
          error: "not_invited",
          errorDescription:
            "That address has not been invited. Ask an administrator for an invitation, " +
            "and sign in with the exact address it was sent to.",
        };
      },
    },

    session: {
      modelName: "auth_session",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    account: {
      modelName: "auth_account",
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        idToken: "id_token",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      // These are login tokens, not ingestion credentials -- but they are still Google
      // tokens in a database this repo goes to lengths to keep credentials out of.
      encryptOAuthTokens: true,
    },

    verification: {
      modelName: "auth_verification",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    ...(config.google === undefined
      ? {}
      : {
          socialProviders: {
            google: {
              clientId: config.google.clientId,
              clientSecret: config.google.clientSecret,
              // Identity only. Gmail and Drive scopes are a separate, per-tenant consent
              // that lands in the sealed app.connection_secret registry -- logging in must
              // not require handing over a mailbox.
              scope: ["openid", "email", "profile"],
            },
          },
        }),

    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: OTP_EXPIRES_SECONDS,
        allowedAttempts: 3,
        // Hashed at rest, the same stance app.invitation takes with token_sha256: a
        // database read must not yield something replayable.
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp }, context) => {
          // Do not put a code in the post for an address that could never use it. Without
          // this, anyone could make this platform email an arbitrary stranger on demand --
          // our mail reputation spending itself on someone else's spam.
          //
          // It returns normally instead of raising, so the caller cannot tell "not invited"
          // from "sent". Answering honestly here would turn the sign-in form into an
          // oracle for which addresses have access, which is the same enumeration argument
          // `trpc.ts` makes for answering 404 rather than 403 to a non-member.
          if (!(await isAdmissible(config.exec, email))) {
            // Silent to the caller, not to the operator: the response must not reveal that
            // this address has no access, but the trail must say so.
            await recordRefusal(config.exec, { email, via: "email-otp" });
            return;
          }

          // In the language the browser asked for. This is the one email whose recipient
          // IS the person at the keyboard, so their choice of language is known exactly --
          // `apps/ui/src/auth.ts` sends `accept-language` on this very call.
          const t = messages(localeOf(context));

          // Deliberately not awaited: how long the send takes is a signal for whether the
          // address exists, and the response should not carry it.
          void config.email
            .send({
              to: email,
              subject: t("signInCode.subject"),
              text: t("signInCode.body", {
                otp,
                minutes: String(OTP_EXPIRES_SECONDS / 60),
              }),
            })
            .catch((error: unknown) => config.onEmailError?.(error));
        },
      }),
    ],

    databaseHooks: {
      user: {
        create: {
          /**
           * Redeem the invitation. Fires once, when a new authentication identity is about
           * to exist, which is the moment the `app_user` and its memberships must.
           *
           * It re-checks admission rather than trusting `validateUserInfo` to have run:
           * this is the only path that WRITES, so it is the one place where being wrong
           * grants access rather than merely failing to refuse it. Throwing `APIError`
           * aborts the sign-in, and its message is the one kind of error text Better Auth
           * passes to the client verbatim.
           */
          before: async (user, context) => {
            const invited = await config.transactor((tx) => resolveInvitedUser(tx, user.email));
            if (invited === null) {
              throw new APIError("FORBIDDEN", {
                message: messages(localeOf(context))("error.notInvited"),
              });
            }
            return { data: user };
          },
        },
      },
    },
  });
}
