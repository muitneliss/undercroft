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

import { type EmailSender, type Locale, type Logger, negotiateLocale } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import {
  admit,
  type Grant,
  isPersonalToken,
  type Refused as TokenRefused,
} from "../services/accessTokens.ts";
import { grantFor } from "../services/connectedApps.ts";
import { appUserForEmail } from "../services/invite.ts";
import { type GoogleIngestConfig, type ProviderConfig, startConsent } from "../services/oauth.ts";
import { invitationMessage } from "../services/people.ts";
import { isSuperadmin, NO_SUPERADMINS, type Superadmins } from "../services/superadmin.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import type { Assistant } from "../services/assistant/agent.ts";
import type { Judge } from "../services/assistant/judge.ts";
import type { Auth } from "./auth.ts";
import type { OAuthRefused } from "./mcpAccessToken.ts";
import type { Widgets } from "./mcpWidgets.ts";
import type { Context, SessionUser, Via } from "./trpc.ts";

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
   * The model-context door's widgets, built once at boot (`widgets.ts`). Absent -- a build that
   * failed, or a suite that does not draw -- and `/mcp` answers exactly as before, text and
   * structured content, which every host shows. ADR 0061.
   */
  readonly widgets?: Widgets;
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

/**
 * Which credential a door reads. `/trpc` and the assistant read the session cookie a browser
 * holds; `/mcp` reads `Authorization: Bearer` and NEVER the cookie, so a page open in the same
 * browser cannot lend its session to a model-context client, and a bearer cannot ride on one.
 */
export type Door = "cookie" | "bearer";

/**
 * An authenticated address and what it presented, before it is anybody here.
 *
 * Both doors produce one of these and nothing else, so everything after -- who the address is
 * on this platform, whether it holds platform authority -- is decided once, in `callerFor`,
 * for every kind of credential there is and will be.
 */
interface Presented {
  readonly email: string;
  readonly credentialId: string;
  readonly grant: Grant;
}

/**
 * The cookie door. Better Auth verifies the signed cookie and reads its session row -- the
 * database read that makes a revoked session stop working at once. A browser session is its
 * owner at their own screen, so it always holds `write`.
 */
async function sessionIdentity(deps: ServerDeps, headers: Headers): Promise<Presented | null> {
  if (deps.auth === undefined) {
    return null;
  }
  const resolved = await deps.auth.api.getSession({ headers });
  if (resolved === null) {
    return null;
  }
  return { email: resolved.user.email, credentialId: resolved.session.id, grant: "write" };
}

/** RFC 6750's `Authorization: Bearer <token>`, the scheme matched case-insensitively. */
const BEARER = /^Bearer[ \t]+(?<token>\S+)[ \t]*$/iu;

/**
 * Why the bearer door let nobody in -- for the operator's log, never for the client.
 *
 * - `missing`: no `Authorization: Bearer` at all. A client's first contact, before it has
 *   signed in, is exactly this.
 * - `malformed`, `unknown`: not a credential this server issued for this door (`OAuthRefused`
 *   in `mcpAccessToken.ts` and `Refused` in `accessTokens.ts` say which cases each covers).
 * - `expired`, `revoked`: a real credential that has died, by its clock or by its person.
 * - `no_person`: a live credential whose person is nobody here any more.
 * - `insufficient_scope`: a live OAuth token whose person granted neither of our scopes.
 *
 * The client is told only what RFC 6750 lets it act on, decided in one place (`mcp.ts`):
 * `insufficient_scope` is a 403 naming the scope to ask for, and every other reason is the
 * same 401 -- a caller holding a dead credential is owed no account of how it died.
 */
export type RefusalReason =
  | "missing"
  | TokenRefused["reason"]
  | OAuthRefused["reason"]
  | "no_person"
  | "insufficient_scope";

/**
 * A refused bearer: why, and whose it was when that is proven -- `upat_<id>` for a personal
 * token whose row was found, `oauth:<clientId>` for a JWT whose signature verified. Never the
 * token, nor any part of its secret.
 */
export interface BearerRefusal {
  readonly reason: RefusalReason;
  readonly credentialId?: string;
}

function refusedAs(reason: RefusalReason, credentialId: string | undefined): BearerRefusal {
  return credentialId === undefined ? { reason } : { reason, credentialId };
}

/**
 * The id an OAuth credential is logged by: its client, not the token. A token is renewed while
 * the app stays the same app, and which app acted is what an operator follows through the
 * `mcp_call` and `mcp_refused` lines.
 */
function oauthCredential(clientId: string): string {
  return `oauth:${clientId}`;
}

/** Nothing to verify a JWT with: no authorization server runs here (plain HTTP off loopback). */
const NO_ISSUER: OAuthRefused = { ok: false, reason: "unknown" };

/**
 * The bearer door: `Authorization: Bearer` and nothing else.
 *
 * A personal access token (`upat_…`) is admitted by digest, and holds the grant its owner chose
 * when minting it. Anything else is an OAuth access token or nothing: a JWT a model-context
 * client obtained by signing its person in (ADR 0061), verified by the authorization server
 * against the consent as it stands NOW, and granted the lesser of what the token and the
 * consent say (`grantFor`). Both kinds yield the same `Presented`, so nothing after this
 * function learns which kind of bearer it was.
 */
async function resolveBearer(
  deps: ServerDeps,
  headers: Headers,
): Promise<Presented | BearerRefusal> {
  const bearer = BEARER.exec(headers.get("authorization") ?? "")?.groups?.token;
  if (bearer === undefined) {
    return { reason: "missing" };
  }
  if (isPersonalToken(bearer)) {
    const admitted = await admit(deps.exec, bearer);
    return admitted.ok
      ? { email: admitted.email, credentialId: admitted.id, grant: admitted.grant }
      : refusedAs(admitted.reason, admitted.id);
  }
  const admission = (await deps.auth?.mcp?.admit(bearer)) ?? NO_ISSUER;
  if (!admission.ok) {
    const { clientId } = admission;
    return refusedAs(
      admission.reason,
      clientId === undefined ? undefined : oauthCredential(clientId),
    );
  }
  const credentialId = oauthCredential(admission.clientId);
  const grant = grantFor(admission.tokenScopes, admission.consentScopes);
  if (grant === null) {
    return { reason: "insufficient_scope", credentialId };
  }
  return { email: admission.email, credentialId, grant };
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
 * Nobody's grant is the door's own: `write` at the cookie door, so an anonymous call to `/trpc`
 * is refused by `authedProcedure` as UNAUTHORIZED -- what it is -- rather than by the grant
 * guard as a write it may not make. At the bearer door nobody reaches a procedure at all.
 */
async function callerFor(
  deps: ServerDeps,
  presented: Presented | null,
  door: Door,
): Promise<Caller> {
  const via: Via = door === "cookie" ? "session" : "token";
  const nobody: Caller = {
    user: null,
    credentialId: "",
    via,
    grant: door === "cookie" ? "write" : "read",
    superadmin: false,
  };
  if (presented === null) {
    return nobody;
  }
  const appUser = await appUserForEmail(deps.exec, presented.email);
  if (appUser === null) {
    return nobody;
  }
  return {
    user: { userId: appUser.appUserId, email: appUser.email },
    credentialId: presented.credentialId,
    via,
    grant: presented.grant,
    superadmin: isSuperadmin(deps.superadmins ?? NO_SUPERADMINS, appUser.email),
  };
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
  const presented = await resolveBearer(deps, headers);
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
 * What `/mcp` asks, rather than `createContext`: a model-context client that is nobody is
 * answered before any MCP message is read, and HOW it is answered depends on why -- see
 * {@link RefusalReason}.
 */
export async function bearerContext(
  deps: ServerDeps,
  headers: Headers,
): Promise<Context | BearerRefusal> {
  const presented = await resolveBearer(deps, headers);
  if ("reason" in presented) {
    return presented;
  }
  const caller = await callerFor(deps, presented, "bearer");
  // A live credential, and nobody here: the shared tail found no `app_user` for its address.
  return caller.user === null
    ? { reason: "no_person", credentialId: presented.credentialId }
    : contextFor(deps, headers, "bearer", caller);
}

/**
 * The context for a caller already resolved.
 *
 * Every refusal this request produces and every email it causes to be sent is worded in the
 * locale resolved here -- including the invitation, which goes to somebody whose own language
 * nobody here knows. See `../i18n`.
 */
function contextFor(deps: ServerDeps, headers: Headers, door: Door, caller: Caller): Context {
  const { user, credentialId, via, grant, superadmin } = caller;
  const { auth } = deps;
  const locale = negotiateLocale(headers.get("accept-language"));

  return {
    exec: deps.exec,
    user,
    credentialId,
    via,
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
