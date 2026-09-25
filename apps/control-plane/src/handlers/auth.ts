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
 *    query against a column that does not exist, at login, in production. It is all in
 *    `authSchema.ts`, and `authSchema.test.ts` holds it to the migrated schema.
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
 *   - **`user.validateUserInfo`** -- refuses an uninvited identity before it is created,
 *     and again on every returning *Google* sign-in. Fails closed by the library's design.
 *   - **`sendVerificationOTP`** -- will not put a code in the post for an address that
 *     could not use it, so this platform cannot be made to email strangers.
 *   - **`resolveCaller` in `server.ts`** -- no `app.app_user` row, no `Context.user`, so
 *     even a validly-signed session for a removed account is unauthenticated on arrival.
 *     This is the layer that covers a returning sign-in by code.
 *
 * `databaseHooks.user.create.before` is the provisioning step, not a fourth gate: it is
 * where an invitation is actually redeemed into a membership.
 *
 * All three consult the same superadmin list, resolved once in `createAuth`. An address in
 * `UNDERCROFT_SUPERADMINS` passes all three with no invitation -- it is the one way in that
 * does not require somebody already inside, which is what makes a fresh deployment usable.
 * It weakens none of them: the address still has to prove it controls the mailbox or the
 * Google account, and three gates reading one list cannot disagree about who is on it.
 * ADR 0013.
 *
 * A third method exists on a local stack only: `POST /api/auth/sign-in/dev` signs the browser
 * in as `UNDERCROFT_DEV_SIGN_IN_AS` without proving the address. It is a Better Auth method
 * like the other two rather than a bypass around the library, so what it yields is an
 * ordinary session -- the same cookie, the same row, the same `resolveCaller`, the same
 * sign-out -- and a first sign-in passes the same provisioning hook. `createAuth` refuses to
 * build it behind a `baseUrl` that is not loopback. See `devSignIn.ts`.
 */

import { type EmailMessage, type EmailSender, type Locale, postEmailLeaf } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { messages } from "../i18n/index.ts";
import { isAdmissible, recordRefusal, resolveInvitedUser } from "../services/invite.ts";
import { setLocale } from "../services/preferences.ts";
import { NO_SUPERADMINS, type Superadmins } from "../services/superadmin.ts";
import { localeOf } from "./authLocale.ts";
import { coreModels, USER_TABLE } from "./authSchema.ts";
import { devSignIn } from "./devSignIn.ts";
import { createMcpAuth, type McpAuth, mcpPlugins, oauthIssuer } from "./mcpAuth.ts";

/** How long a code is good for. Long enough to switch to a mail client, not to a new day. */
const OTP_EXPIRES_SECONDS = 600;

/**
 * What somebody signing in is sent.
 *
 * A pure value, like `invitationMessage` and the three alert composers -- composing the
 * words is a decision, sending them is transport. It is named and exported rather than
 * built inline inside the hook so that `task dev:email-preview` renders the message this
 * platform actually sends, instead of a copy of it that drifts the first time one is edited
 * and the other is not.
 */
export function signInCodeMessage(to: string, otp: string, locale: Locale): EmailMessage {
  const t = messages(locale);
  return postEmailLeaf(to, {
    locale,
    subject: t("signInCode.subject"),
    // No running head: a sign-in code belongs to a person, not to a customer. Naming one
    // would also tell whoever is holding the inbox which customers this address can reach,
    // before they have proved they are it.
    heading: t("signInCode.heading"),
    lead: t("signInCode.lead"),
    colophon: t("email.colophon"),
    blocks: [
      { kind: "token", value: otp },
      { kind: "note", text: t("signInCode.expiry", { minutes: String(OTP_EXPIRES_SECONDS / 60) }) },
      { kind: "note", text: t("signInCode.ignore") },
    ],
  });
}

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
  /**
   * Sends the one-time codes. Absent means there is no sign-in by code; `main.ts` builds no
   * auth at all without it unless `devSignInAs` is set, so a deployment never lacks it.
   */
  readonly email?: EmailSender;
  /**
   * The addresses from `UNDERCROFT_SUPERADMINS`, which are admissible with no invitation.
   *
   * Optional, and absent means "none": an install that names no superadmin is invite-only
   * exactly as it was before ADR 0013. It is here rather than read from the environment
   * inside the gate because this is a layer, and `layer-injected-deps` is the rule that
   * keeps a configuration substitutable by its caller.
   */
  readonly superadmins?: Superadmins;
  /** Omitted for an install that signs in by emailed code only. */
  readonly google?: GoogleCredentials;
  /**
   * `UNDERCROFT_DEV_SIGN_IN_AS`: adds `POST /api/auth/sign-in/dev`, which signs the caller in
   * as this address with no proof. Only for a `baseUrl` on loopback; `createAuth` throws
   * otherwise. The address must still be admissible -- see `devSignIn.ts`.
   */
  readonly devSignInAs?: string;
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
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (input: { headers: Headers }) => Promise<AuthSession | null>;
    /** Revoke the caller's session. Better Auth deletes the row rather than flagging it. */
    signOut: (input: { headers: Headers }) => Promise<unknown>;
  };
  /**
   * The authorization server for `/mcp` (ADR 0061), or `null` where the public URL cannot carry
   * one -- plain HTTP off loopback -- and model-context clients connect with personal tokens
   * only. `handler` serves its endpoints and discovery documents either way.
   */
  mcp: McpAuth | null;
}

/**
 * The `user` model, and the outermost of the three invite-only gates.
 *
 * Lifted out of `createAuth` so the gate has a name: the reasoning on `validateUserInfo` is
 * the load-bearing part of this file and was forty lines deep inside a config literal.
 */
function userModel(config: AuthConfig, superadmins: Superadmins): BetterAuthOptions["user"] {
  return {
    ...USER_TABLE,
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
    validateUserInfo: async ({
      user,
    }): Promise<{ error: string; errorDescription: string } | undefined> => {
      // An identity with no address cannot be matched to an invitation, so it is refused:
      // `isAdmissible("")` is false. Failing closed on a missing email is the point.
      if (await isAdmissible(config.exec, user.email ?? "", superadmins)) {
        return;
      }

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
  };
}

/**
 * The plugins, which carry the second gate: `sendVerificationOTP` will not put a code in the
 * post for an address that could not use it, so this platform cannot be made to email
 * strangers. A security decision does not belong seventy lines inside a config literal.
 */
function authPlugins(
  config: AuthConfig,
  superadmins: Superadmins,
): NonNullable<BetterAuthOptions["plugins"]> {
  const issuer = oauthIssuer(config.baseUrl);
  return [
    ...(issuer === null ? [] : mcpPlugins(issuer)),
    ...(config.email === undefined ? [] : [otpSignIn(config, config.email, superadmins)]),
    ...(config.devSignInAs === undefined
      ? []
      : [
          devSignIn({
            exec: config.exec,
            address: config.devSignInAs,
            baseUrl: config.baseUrl,
            superadmins,
          }),
        ]),
  ];
}

function otpSignIn(
  config: AuthConfig,
  sender: EmailSender,
  superadmins: Superadmins,
): BetterAuthPlugin {
  return emailOTP({
    otpLength: 6,
    expiresIn: OTP_EXPIRES_SECONDS,
    allowedAttempts: 3,
    // Hashed at rest, the same stance app.invitation takes with token_sha256: a
    // database read must not yield something replayable.
    storeOTP: "hashed",
    sendVerificationOTP: async ({ email, otp }, context): Promise<void> => {
      // Do not put a code in the post for an address that could never use it. Without
      // this, anyone could make this platform email an arbitrary stranger on demand --
      // our mail reputation spending itself on someone else's spam.
      //
      // It returns normally instead of raising, so the caller cannot tell "not invited"
      // from "sent". Answering honestly here would turn the sign-in form into an
      // oracle for which addresses have access, which is the same enumeration argument
      // `trpc.ts` makes for answering 404 rather than 403 to a non-member.
      if (!(await isAdmissible(config.exec, email, superadmins))) {
        // Silent to the caller, not to the operator: the response must not reveal that
        // this address has no access, but the trail must say so.
        await recordRefusal(config.exec, { email, via: "email-otp" });
        return;
      }

      // In the language the browser asked for. This is the one email whose recipient
      // IS the person at the keyboard, so their choice of language is known exactly --
      // `apps/ui/src/auth.ts` sends `accept-language` on this very call.
      const locale = localeOf(context);

      // Deliberately not awaited: how long the send takes is a signal for whether the
      // address exists, and the response should not carry it.
      void sender
        .send(signInCodeMessage(email, otp, locale))
        .catch((error: unknown) => config.onEmailError?.(error));
    },
  });
}

/** The hooks that admit a platform superadmin on a fresh install. ADR 0013. */
function bootstrapHooks(
  config: AuthConfig,
  superadmins: Superadmins,
): BetterAuthOptions["databaseHooks"] {
  return {
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
        before: async (user, context): Promise<{ data: typeof user }> => {
          const locale = localeOf(context);
          const invited = await config.transactor(async (tx) => {
            const resolved = await resolveInvitedUser(tx, user.email, superadmins);
            // The language of the request that signed them in is the best guess the
            // platform has for the emails it will send while no browser is open; the
            // switcher on any page corrects it (`session.setLocale`).
            if (resolved !== null) {
              await setLocale(tx, resolved.appUserId, locale);
            }
            return resolved;
          });
          if (invited === null) {
            throw new APIError("FORBIDDEN", {
              message: messages(locale)("error.notInvited"),
            });
          }
          return { data: user };
        },
      },
    },
  };
}

/**
 * Open client registration is the one endpoint rate-limited here: `/oauth2/register` writes a
 * row for anyone who asks, so it is held to a few a minute per address.
 *
 * Every other path is exempted explicitly, which keeps them exactly as they were. Better Auth's
 * limiter is on only when `NODE_ENV` is `production` and the deployment sets none, so it has
 * never run here; turning it on for everything at once would also turn on its sign-in limits,
 * which key on a forwarded address this change has no way to verify behind the proxy.
 */
const RATE_LIMITS: NonNullable<BetterAuthOptions["rateLimit"]> = {
  enabled: true,
  customRules: {
    "/oauth2/register": { window: 60, max: 5 },
    "/**": false,
  },
};

/**
 * Everything Better Auth is configured with.
 *
 * Exported for `authSchema.test.ts`, which walks the tables these options make Better Auth
 * write against the migrated schema -- so a plugin upgrade that adds a field fails the gate,
 * not the first sign-in or consent in production.
 */
export function authOptions(config: AuthConfig): BetterAuthOptions {
  // Resolved once, so the three gates below cannot end up consulting different lists.
  const superadmins = config.superadmins ?? NO_SUPERADMINS;

  return {
    database: config.database,
    secret: config.secret,
    baseURL: config.baseUrl,
    // Same-origin: the SPA is served by this process, so the only trusted origin is itself.
    trustedOrigins: [config.baseUrl],
    // Explicit, although `false` is already Better Auth's production default: left unset,
    // Better Auth SKIPS its Origin/CSRF check whenever NODE_ENV is `test`, so every suite ran
    // a laxer server than production does. That hid a real defect -- the CLI's sign-in was
    // refused in production and accepted in the gate (ADR 0044) -- and a check the suite does
    // not run is a check nothing proves.
    advanced: { disableOriginCheck: false },
    // `jwt()`'s session-token endpoint. Nothing here reads a session as a JWT, and a second
    // kind of token signed with the access tokens' keys is surface for no caller (`mcpAuth.ts`).
    disabledPaths: ["/token"],
    rateLimit: RATE_LIMITS,

    user: userModel(config, superadmins),

    ...coreModels(),

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

    plugins: authPlugins(config, superadmins),

    databaseHooks: bootstrapHooks(config, superadmins),
  };
}

export function createAuth(config: AuthConfig): Auth {
  const instance = betterAuth(authOptions(config));
  const issuer = oauthIssuer(config.baseUrl);
  return {
    handler: (request) => instance.handler(request),
    api: {
      getSession: (input) => instance.api.getSession(input),
      signOut: (input) => instance.api.signOut(input),
    },
    mcp: issuer === null ? null : createMcpAuth(instance, issuer),
  };
}
