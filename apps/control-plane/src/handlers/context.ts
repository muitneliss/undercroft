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
 * `server.ts` is now routing and static files. This file is the caller. What each credential
 * proves before it is anybody here -- a cookie, a bearer, or why a bearer proves nothing -- is
 * `identity.ts`.
 *
 * Both the locale and the caller are read from the request and carried on the context: two
 * concurrent requests in two languages must not answer each other's.
 */

import { type EmailSender, type Locale, type Logger, negotiateLocale } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import type { Grant } from "../services/accessTokens.ts";
import { recordTokenRefusal } from "../services/audit.ts";
import { appUserForEmail } from "../services/invite.ts";
import { type GoogleIngestConfig, type ProviderConfig, startConsent } from "../services/oauth.ts";
import { invitationMessage } from "../services/people.ts";
import { isSuperadmin, NO_SUPERADMINS, type Superadmins } from "../services/superadmin.ts";
import type { SpecReads } from "../services/connections.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import type { Assistant } from "../services/assistant/agent.ts";
import type { Judge } from "../services/assistant/judge.ts";
import type { Auth } from "./auth.ts";
import type { ImageFiles } from "./imageFiles.ts";
import { channelOf } from "./channel.ts";
import {
  type BearerRefusal,
  type Bearers,
  type Door,
  type Presented,
  resolveBearer,
  sessionIdentity,
} from "./identity.ts";
import type { Context, SessionUser, Via } from "./trpc.ts";

/** What the server is built from: its configuration, plus what the image carries. */
export interface ServerDeps extends ImageFiles {
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
  /**
   * `UNDERCROFT_PUBLIC_URL`: the origin to put in an invitation email, and the origin `/mcp`
   * names in its `WWW-Authenticate` challenge. Without it, no invitation mail is sent, and the
   * challenge names the origin the request itself arrived on.
   */
  readonly publicUrl?: string;
  /**
   * `UNDERCROFT_RELEASE`, the tag this image was built from, which `/mcp` reports as its
   * version. Absent on a process started from a checkout, and then it says so.
   */
  readonly release?: string;
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
  /**
   * Where a failed procedure is recorded, with the request's trace id. Absent in a suite that
   * does not read it; the process always passes one, because an internal error the browser is
   * only told `internal_error` about has no other trace than this line.
   */
  readonly log?: Logger;
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

/** Who is calling, as every door answers it. */
export interface Caller {
  readonly user: SessionUser | null;
  readonly credentialId: string;
  readonly via: Via;
  readonly grant: Grant;
  readonly superadmin: boolean;
}

/**
 * The shared tail every credential passes through.
 *
 * `appUserForEmail` turns the authenticated address into the `app_user` uuid that memberships
 * are keyed by, which is the only id a procedure may act on. An address with no `app_user`
 * resolves to nobody, not to a session: that is the case where someone's account was removed
 * while they still hold a valid cookie or token -- they are who they say they are, and they
 * are nobody here. Read on every request, so a removal takes effect at the next one.
 *
 * Platform authority is decided here too, and only here, off the environment list against the
 * address -- so removal from `UNDERCROFT_SUPERADMINS` also takes effect at the next request.
 * `superadmin` is false whenever `user` is null, because a caller the platform cannot identify
 * must not carry authority over it.
 *
 * Nobody holds `write`, at either door, so an anonymous call -- a revoked token at `/trpc`
 * included -- is refused by `authedProcedure` as UNAUTHORIZED, which is what it is, rather than
 * by the grant guard as a write it may not make. That lends nobody anything: every procedure but
 * the public ones refuses them first, and a public one is open to a request with no credential.
 */
async function callerFor(
  deps: ServerDeps,
  presented: Presented | null,
  door: Door,
): Promise<Caller> {
  if (presented === null) {
    return nobodyAt(door);
  }
  const appUser = await appUserForEmail(deps.exec, presented.email);
  if (appUser === null) {
    return nobodyAt(door);
  }
  return {
    user: { userId: appUser.appUserId, email: appUser.email },
    credentialId: presented.credentialId,
    via: viaOf(door),
    grant: presented.grant,
    superadmin: isSuperadmin(deps.superadmins ?? NO_SUPERADMINS, appUser.email),
  };
}

function viaOf(door: Door): Via {
  return door === "cookie" ? "session" : "token";
}

/** The caller who is nobody here: see `callerFor` for why their grant is `write`. */
function nobodyAt(door: Door): Caller {
  return { user: null, credentialId: "", via: viaOf(door), grant: "write", superadmin: false };
}

/** Who is calling through `door`: its identity step, then the shared tail. */
export async function resolveCaller(
  deps: ServerDeps,
  headers: Headers,
  door: Door,
): Promise<Caller> {
  if (door === "cookie") {
    return callerFor(deps, await sessionIdentity(deps, headers), door);
  }
  const presented = await resolveBearer(deps, headers, "any");
  return callerFor(deps, "reason" in presented ? null : presented, door);
}

/**
 * The one context a request gets, whichever transport asked for it and whichever credential
 * it presented at that `door`. A caller who is nobody gets a context too, with `user` null,
 * and the router's own gates refuse them.
 */
export async function createContext(
  deps: ServerDeps,
  headers: Headers,
  door: Door,
): Promise<Context> {
  return contextFor(deps, headers, door, await resolveCaller(deps, headers, door));
}

/**
 * The bearer door's context, or why there is none.
 *
 * What every door that reads a bearer asks -- `/mcp`, an export's download and `/trpc` sent with
 * one -- rather than `createContext`: a model-context client that is nobody is answered before
 * any MCP message is read, and HOW it is answered depends on why (`RefusalReason`, `identity.ts`).
 *
 * And the one place a refused bearer reaches the audit log (ADR 0120), so a door added tomorrow
 * that admits through here records its refusals without knowing it does.
 */
export async function bearerContext(
  deps: ServerDeps,
  headers: Headers,
  bearers: Bearers,
): Promise<Context | BearerRefusal> {
  const presented = await resolveBearer(deps, headers, bearers);
  if ("reason" in presented) {
    return await recorded(deps, presented);
  }
  const caller = await callerFor(deps, presented, "bearer");
  // A live credential, and nobody here: the shared tail found no `app_user` for its address.
  return caller.user === null
    ? await recorded(deps, {
        reason: "no_person",
        credentialId: presented.credentialId,
        owner: presented.email,
      })
    : contextFor(deps, headers, "bearer", caller);
}

/**
 * `/trpc`'s caller (ADR 0134): the browser's session cookie, or -- for the CLI signed in with a
 * personal access token -- `Authorization: Bearer`, chosen by the request.
 *
 * A request carrying `Authorization` is the bearer door's and ONLY its, as at an export's
 * download: a cookie that came with a bearer that failed does not rescue it, so a revoked token
 * stops at its next call whatever else the request carries. A bearer refused here is nobody, and
 * the router answers nobody UNAUTHORIZED like any anonymous call -- the client is owed no account
 * of how the credential died, and the operator has its row from `bearerContext`.
 *
 * The header chooses, which a page elsewhere cannot use: a cross-origin request carrying
 * `Authorization` needs a CORS preflight this server never answers, so it is never sent.
 */
export async function apiContext(deps: ServerDeps, headers: Headers): Promise<Context> {
  if (!headers.has("authorization")) {
    return createContext(deps, headers, "cookie");
  }
  const admitted = await bearerContext(deps, headers, "personal");
  return "reason" in admitted ? contextFor(deps, headers, "bearer", nobodyAt("bearer")) : admitted;
}

/**
 * A refused bearer, written to the audit log and handed back.
 *
 * Every reason but `missing`. No header at all is every OAuth client's first contact -- the
 * challenge is how it learns to sign in -- so a row for it would be one per connector per session
 * with nobody behind it.
 */
async function recorded(deps: ServerDeps, refusal: BearerRefusal): Promise<BearerRefusal> {
  if (refusal.reason !== "missing") {
    await recordTokenRefusal(deps.exec, refusal);
  }
  return refusal;
}

/**
 * The context for a caller already resolved.
 *
 * Every refusal this request produces and every email it causes to be sent is worded in the
 * locale resolved here -- including the invitation, which goes to somebody whose own language
 * nobody here knows. See `../i18n`.
 */
/** No spec read: every grant is judged whole, as it was before ADR 0073. */
const NO_SPECS: SpecReads = new Map();

function contextFor(deps: ServerDeps, headers: Headers, door: Door, caller: Caller): Context {
  const { user, credentialId, via, grant, superadmin } = caller;
  const { auth } = deps;
  const locale = negotiateLocale(headers.get("accept-language"));

  return {
    exec: deps.exec,
    user,
    credentialId,
    via,
    channel: channelOf(door, headers),
    grant,
    superadmin,
    locale,
    // Only at the cookie door. A bearer request that happened to carry a cookie as well must
    // not be able to end the browser session it did not authenticate with.
    endSession: async (): Promise<void> => {
      if (auth !== undefined && door === "cookie") {
        await auth.api.signOut({ headers });
      }
    },
    notifyInvitation: (to, tenantId): Promise<boolean> =>
      sendInvitation(deps, to, tenantId, locale),
    apps: auth?.mcp ?? null,
    signInMethods: auth?.methods ?? [],
    publicUrl: deps.publicUrl ?? null,
    // Not held until a door says so (`holdOpen.ts`): `/trpc` and `/mcp` hold their own request.
    holdOpen: () => undefined,
    worker: deps.worker ?? null,
    specReads: deps.specReads ?? NO_SPECS,
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
