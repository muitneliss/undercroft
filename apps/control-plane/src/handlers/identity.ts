/**
 * What a credential proves, before it is anybody here: the address it authenticates, its id and
 * its grant -- or, for a bearer, why it proves nothing.
 *
 * One function per kind of credential a door reads, each yielding the same `Presented`, so that
 * `context.ts` decides everything after -- who the address is on this platform, whether it holds
 * platform authority, the context a request gets -- once, for every credential there is. Moved
 * out of `context.ts` when `/trpc` began reading a bearer (ADR 0134): the doors and what each
 * credential proves are one concern, and who that makes the caller is another.
 */

import type { SqlExecutor } from "@undercroft/db";
import {
  admit,
  type Grant,
  isPersonalToken,
  type Refused as TokenRefused,
} from "../services/accessTokens.ts";
import { grantFor } from "../services/connectedApps.ts";
import type { Auth } from "./auth.ts";
import { type OAuthRefused, oauthCredential } from "./mcpAccessToken.ts";

/** What reading a credential needs: the database a token's row is in, and sign-in, if built. */
export interface IdentityDeps {
  readonly exec: SqlExecutor;
  readonly auth?: Auth;
}

/**
 * Which credential a door reads. The assistant reads the session cookie a browser holds; `/mcp`
 * reads `Authorization: Bearer` and NEVER the cookie, so a page open in the same browser cannot
 * lend its session to a model-context client, and a bearer cannot ride on one. `/trpc` and an
 * export's download are either, chosen by whether the request carries `Authorization`, never both.
 */
export type Door = "cookie" | "bearer";

/**
 * Which bearers a door honours: `any` -- a personal access token, or an OAuth access token a
 * model-context client obtained (ADR 0061) -- or a `personal` token alone.
 *
 * `/trpc` takes a personal token only (ADR 0134). An OAuth access token is issued FOR `/mcp`:
 * its audience is that resource, which `mcpAccessToken.ts` checks, and a token honoured at a
 * resource it was not issued for is exactly what audience-binding exists to stop. A personal
 * token names no resource; it is the person's own, for any door that admits a bearer.
 */
export type Bearers = "any" | "personal";

/**
 * An authenticated address and what it presented, before it is anybody here.
 *
 * Both doors produce one of these and nothing else, so everything after -- who the address is
 * on this platform, whether it holds platform authority -- is decided once, in `context.ts`,
 * for every kind of credential there is and will be.
 */
export interface Presented {
  readonly email: string;
  readonly credentialId: string;
  readonly grant: Grant;
}

/**
 * The cookie door. Better Auth verifies the signed cookie and reads its session row -- the
 * database read that makes a revoked session stop working at once. A browser session is its
 * owner at their own screen, so it always holds `write`.
 */
export async function sessionIdentity(
  deps: IdentityDeps,
  headers: Headers,
): Promise<Presented | null> {
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
 * token whose row was found, `oauth:<clientId>` for a JWT whose signature verified, and `owner`,
 * the address of the person it belongs to, where an account was read for it. Never the token,
 * nor any part of its secret.
 */
export interface BearerRefusal {
  readonly reason: RefusalReason;
  readonly credentialId?: string | undefined;
  readonly owner?: string | undefined;
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
 * function learns which kind of bearer it was. A door that takes a `personal` token alone
 * (`Bearers`) refuses the second kind unread.
 */
export async function resolveBearer(
  deps: IdentityDeps,
  headers: Headers,
  bearers: Bearers,
): Promise<Presented | BearerRefusal> {
  const bearer = BEARER.exec(headers.get("authorization") ?? "")?.groups?.token;
  if (bearer === undefined) {
    return { reason: "missing" };
  }
  if (isPersonalToken(bearer)) {
    const admitted = await admit(deps.exec, bearer);
    return admitted.ok
      ? { email: admitted.email, credentialId: admitted.id, grant: admitted.grant }
      : { reason: admitted.reason, credentialId: admitted.id, owner: admitted.email };
  }
  // Not ours for this door, as a token for another audience is `unknown` at `/mcp`. Refused
  // before it is verified, so nothing is learnt about it -- not even whose it is.
  if (bearers === "personal") {
    return { reason: "unknown" };
  }
  const admission = (await deps.auth?.mcp?.admit(bearer)) ?? NO_ISSUER;
  if (!admission.ok) {
    const { clientId } = admission;
    const credentialId = clientId === undefined ? undefined : oauthCredential(clientId);
    return { reason: admission.reason, credentialId, owner: admission.email };
  }
  const credentialId = oauthCredential(admission.clientId);
  const grant = grantFor(admission.tokenScopes, admission.consentScopes);
  if (grant === null) {
    return { reason: "insufficient_scope", credentialId, owner: admission.email };
  }
  return { email: admission.email, credentialId, grant };
}
