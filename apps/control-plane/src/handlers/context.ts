/**
 * Who is calling, what they may be told, and in which language -- resolved ONCE per request.
 *
 * This used to be an object literal inside the `/trpc` route's closure. It moved here when the
 * assistant arrived, because the assistant is a second transport reaching the SAME procedures,
 * and two routes building a context each would be two definitions of who the caller is -- the
 * kind of drift where a role check is right in one place and stale in the other. `ServerDeps`,
 * `resolveCaller` and `sendInvitation` came with it: they are all the same concern, and leaving
 * them in `server.ts` while `createContext` lived here would have made the two files import each
 * other.
 *
 * `server.ts` is now routing and static files. This file is the caller.
 *
 * Both the locale and the caller are read from the request and carried on the context: two
 * concurrent requests in two languages must not answer each other's.
 */

import { type EmailSender, type Locale, negotiateLocale } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { appUserForEmail } from "../services/invite.ts";
import { type GoogleIngestConfig, type ProviderConfig, startConsent } from "../services/oauth.ts";
import { invitationMessage } from "../services/people.ts";
import { isSuperadmin, NO_SUPERADMINS, type Superadmins } from "../services/superadmin.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import type { Assistant } from "../services/assistant/agent.ts";
import type { Judge } from "../services/assistant/judge.ts";
import type { Auth } from "./auth.ts";
import type { Context, SessionUser } from "./trpc.ts";

export interface ServerDeps {
  readonly exec: SqlExecutor;
  /**
   * Sign-in. When unset — a test of static serving, or a process deliberately started with
   * no way in — `/api/auth/*` does not exist and every request is unauthenticated.
   */
  readonly auth?: Auth;
  /**
   * Tells an invited person they have access. Optional: with no mail configured an
   * invitation is still created and still valid, and the admin is told it was not sent.
   */
  readonly email?: EmailSender;
  /** The origin to put in an invitation email. Without it, no invitation mail is sent. */
  readonly publicUrl?: string;
  /**
   * The addresses from `UNDERCROFT_SUPERADMINS`, which hold `admin` in every tenant.
   *
   * Absent means none, and an install that names none behaves exactly as it did before
   * ADR 0013. Passed in rather than read here: this is a layer, and `layer-injected-deps`
   * keeps configuration substitutable by the composition root that owns it.
   */
  readonly superadmins?: Superadmins;
  /**
   * Absolute path to the built SPA (`apps/ui/dist`). When set, the app serves those files
   * and falls back to `index.html` for client-side routes. When unset — a test, or a
   * process with no UI baked in — only `/api` and `/trpc` exist, and everything else 404s.
   */
  readonly uiDist?: string;
  /**
   * The INGESTION Google client, a different client from the sign-in one. Absent means the
   * per-tenant consent does not exist: `startOAuth` keeps its placeholder and every Google
   * source reads "not connected", which is better than a button ending at a Google error
   * page while verification is still pending.
   */
  readonly googleIngest?: GoogleIngestConfig;
  /** The Xero client. Absent means Xero reads "not connected" and its button says why. */
  readonly xero?: ProviderConfig;
  /**
   * The worker: the only process holding the master key, and so the only one that can seal
   * a credential. Absent disables the consent flow with it. ADR 0016.
   */
  readonly worker?: WorkerClient;
  /**
   * The assistant. Absent -- no model key configured -- means `/api/assistant/*` refuses in
   * the caller's language and the interleaf says it is unavailable, rather than a panel that
   * opens and then fails at the first question. The same degrade-and-log shape as `worker`.
   */
  readonly assistant?: Assistant;
  /**
   * The assistant's injection gate. Absent means the write tier refuses -- see
   * `services/assistant/judge.ts`; a gate that fails open is not a gate.
   */
  readonly judge?: Judge;
}

/**
 * Tell an invited person they have access, and say whether it went.
 *
 * The wording is `people.invitationMessage`, shared with `bun run invite` so the two ways of
 * inviting cannot drift into saying different things. What is left here is the transport:
 * which sender, and what a failure means.
 *
 * A failed send is reported as `false`, never raised. The invitation is already written and
 * already valid; turning a mail outage into a failed invitation would throw away work the
 * admin would have to repeat.
 */
async function sendInvitation(
  deps: ServerDeps,
  to: string,
  tenantId: string,
  locale: Locale,
): Promise<boolean> {
  const { email, publicUrl } = deps;
  if (email === undefined || publicUrl === undefined) {
    return false;
  }

  try {
    await email.send(invitationMessage(to, tenantId, publicUrl, locale));
    return true;
  } catch {
    return false;
  }
}

/**
 * Who is calling, in the two steps that sign-in is made of.
 *
 * Better Auth verifies the signed cookie and reads its session row — the database read that
 * makes a revoked session stop working at once. That yields an *authenticated address*.
 * `appUserForEmail` then turns the address into the `app_user` uuid that memberships are
 * keyed by, which is the only id a procedure may act on.
 *
 * An authenticated address with no `app_user` resolves to `null`, not to a session. That is
 * the case where someone's account was removed while they still hold a valid cookie: they
 * are who they say they are, and they are nobody here.
 *
 * Platform authority is decided here too, and only here. It is read off the environment
 * list against the address in the session on **every request**, which is what makes removal
 * from `UNDERCROFT_SUPERADMINS` take effect at the next request rather than whenever a
 * session happens to expire. `superadmin` is false whenever `user` is null -- including for
 * a superadmin whose `app_user` row is missing -- because a caller the platform cannot
 * identify must not carry authority over it.
 */
export async function resolveCaller(
  deps: ServerDeps,
  headers: Headers,
): Promise<{ user: SessionUser | null; sessionId: string; superadmin: boolean }> {
  if (deps.auth === undefined) {
    return { user: null, sessionId: "", superadmin: false };
  }

  const resolved = await deps.auth.api.getSession({ headers });
  if (resolved === null) {
    return { user: null, sessionId: "", superadmin: false };
  }

  const appUser = await appUserForEmail(deps.exec, resolved.user.email);
  if (appUser === null) {
    return { user: null, sessionId: "", superadmin: false };
  }

  return {
    superadmin: isSuperadmin(deps.superadmins ?? NO_SUPERADMINS, appUser.email),
    user: { userId: appUser.appUserId, email: appUser.email },
    sessionId: resolved.session.id,
  };
}

/**
 * The one context a request gets, whichever transport asked for it.
 *
 * Every refusal this request produces and every email it causes to be sent is worded in the
 * locale resolved here -- including the invitation, which goes to somebody whose own language
 * nobody here knows. See `../i18n`.
 */
export async function createContext(deps: ServerDeps, headers: Headers): Promise<Context> {
  const { user, sessionId, superadmin } = await resolveCaller(deps, headers);
  const { auth } = deps;
  const locale = negotiateLocale(headers.get("accept-language"));

  return {
    exec: deps.exec,
    user,
    sessionId,
    superadmin,
    locale,
    endSession: async (): Promise<void> => {
      if (auth !== undefined) {
        await auth.api.signOut({ headers });
      }
    },
    notifyInvitation: (to, tenantId): Promise<boolean> =>
      sendInvitation(deps, to, tenantId, locale),
    worker: deps.worker ?? null,
    // The id and key only. `clientSecret` is deliberately not spread in here; the
    // browser never needs it and this object is serialised straight to it.
    googlePicker:
      deps.googleIngest === undefined
        ? null
        : {
            clientId: deps.googleIngest.clientId,
            apiKey: deps.googleIngest.pickerApiKey ?? "",
            appId: deps.googleIngest.projectNumber ?? "",
          },
    // The outcome is passed through whole, refusal reason included. It used to be
    // narrowed to a bare `{ ok: false }`, and the procedure then had nothing to say
    // except a URL it invented -- see `router.ts`.
    startConsent: (start) =>
      startConsent(
        {
          exec: deps.exec,
          ...(deps.googleIngest === undefined ? {} : { google: deps.googleIngest }),
          ...(deps.xero === undefined ? {} : { xero: deps.xero }),
        },
        start,
      ),
  };
}
