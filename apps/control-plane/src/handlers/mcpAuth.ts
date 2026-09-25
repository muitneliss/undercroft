/**
 * Better Auth as the authorization server for `/mcp`: the OAuth half of ADR 0060, decided in
 * ADR 0061.
 *
 * A connector such as claude.ai cannot be handed a personal token. It follows `/mcp`'s 401 to
 * the RFC 9728 document naming this control plane as its authorization server, registers itself
 * (RFC 7591), sends the person to `/sign-in` and `/consent`, and comes back with an access
 * token: a JWT, signed by `jwt()`, bound to the `/mcp` resource by `@better-auth/mcp`. This
 * module is everything that knows how: the plugins' configuration and the table mapping, and
 * {@link McpAuth}, the one narrow thing the rest of the control plane asks of it.
 *
 * Four decisions here look like noise and are not:
 *
 * 1. **The issuer is the public ORIGIN, not Better Auth's `/api/auth`.** With an issuer that has
 *    a path, RFC 8414 puts the metadata at `/.well-known/oauth-authorization-server/api/auth` and
 *    OIDC at `/api/auth/.well-known/openid-configuration`, and a client probes a third spelling
 *    nothing serves. At the origin, every document a client looks for is at the root, and
 *    `server.ts` hands `/.well-known/*` to Better Auth's own handler, which serves all three
 *    (the provider's and the MCP plugin's `onRequest` run before its base-path check).
 *
 * 2. **A token is verified in process, against the key set read through Better Auth's own
 *    `getJwks`**, checking signature, issuer, audience (the `/mcp` resource, never the base URL)
 *    and expiry with `jose`. Not an HTTP call to our own `/jwks`, which would be a request to
 *    ourselves on every tool call; and not `verifyJWT`, which only accepts the base URL as the
 *    audience and so would take a token issued for anything this server signs.
 *
 * 3. **The consent row is read on EVERY request.** A JWT cannot be withdrawn before it expires;
 *    the consent can. Deleting it ("Revoke" on the account page) stops the client at its next
 *    call, the same promise a personal token makes, and narrowing it narrows the grant at once.
 *
 * 4. **Nobody may manage clients or resources through Better Auth's own endpoints.** Both
 *    privilege callbacks answer `false`. Left unset, the provider lets ANY signed-in session
 *    create clients and rewrite a resource's token policy -- an invited viewer could lengthen
 *    every access token. Registration is the open RFC 7591 path, rate-limited in `auth.ts`.
 */

import { mcp } from "@better-auth/mcp";
import type { AuthContext, BetterAuthPlugin } from "better-auth";
import { jwt } from "better-auth/plugins";
import { createLocalJWKSet, errors, type JSONWebKeySet, type JWTPayload, jwtVerify } from "jose";
import { type AuthorizedApp, OFFERED_SCOPES, type OAuthApps } from "../services/connectedApps.ts";
import { JWKS_TABLE, OAUTH_TABLES } from "./authSchema.ts";
import { isLoopbackOrigin } from "./devSignIn.ts";

/**
 * How long an access token lives. Short because it is a bearer: whoever copies it out of a
 * client holds it until it expires. Revocation does not wait for it (decision 3); a refresh
 * token is what keeps a connector from sending its person through consent every quarter hour.
 */
const ACCESS_TOKEN_SECONDS = 15 * 60;

/** RFC 9068's `typ` for a JWT access token, which is what the provider signs them with. */
const ACCESS_TOKEN_TYPE = "at+jwt";

/** The path `/mcp` answers on, which is the resource every access token is bound to. */
const MCP_PATH = "/mcp";

/** What a live access token for `/mcp` says, once the consent behind it has been read. */
export interface OAuthAdmission {
  /** The person's address: the join to `app.app_user`, decided in `handlers/context.ts`. */
  readonly email: string;
  readonly clientId: string;
  /** What the token was issued with. */
  readonly tokenScopes: readonly string[];
  /** What the person's consent says now. */
  readonly consentScopes: readonly string[];
}

/** What the control plane asks of the authorization server, and nothing else. */
export interface McpAuth extends OAuthApps {
  /** `<public origin>/mcp`: the resource every access token here is bound to. */
  readonly resource: string;
  /**
   * The person and scopes behind an access token, or `null` for anything that is not a live
   * JWT issued here for `/mcp` whose consent still stands and whose person still exists. One
   * answer for all of them: the door answers each with the same 401.
   */
  readonly admit: (token: string) => Promise<OAuthAdmission | null>;
}

/**
 * The issuer for a control plane served at `baseUrl`, or `null` where MCP's rules forbid one:
 * a resource must be HTTPS, or plain HTTP on loopback for development. A plain-HTTP deployment
 * on a LAN address still boots and signs people in; it offers personal tokens only.
 */
export function oauthIssuer(baseUrl: string): string | null {
  const url = new URL(baseUrl);
  return url.protocol === "https:" || isLoopbackOrigin(baseUrl) ? url.origin : null;
}

/** The two plugins, their models mapped onto `310_mcp_oauth.sql`'s tables by `authSchema.ts`. */
export function mcpPlugins(issuer: string): BetterAuthPlugin[] {
  return [
    jwt({
      jwt: { issuer },
      // The plugin would otherwise put a session JWT on every `get-session` response. Nothing
      // here reads one, and `/token` -- the endpoint minting them -- is disabled in `auth.ts`.
      disableSettingJwtHeader: true,
      schema: JWKS_TABLE,
    }),
    asPlugin(
      mcp({
        resource: `${issuer}${MCP_PATH}`,
        // Both render in the SPA. `App.tsx` shows the sign-in page to anyone signed out at any
        // path, so `/sign-in` needs no route of its own; `/consent` has one.
        loginPage: "/sign-in",
        consentPage: "/consent",
        scopes: [...OFFERED_SCOPES],
        accessTokenExpiresIn: ACCESS_TOKEN_SECONDS,
        // RFC 7591, open: a connector registers itself before any person is involved, and a
        // registered client can do nothing until a person signs in and consents.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // No `client_credentials`: a token with no person behind it is the service token ADR
        // 0044 rejected, and `/mcp` would refuse it anyway.
        grantTypes: ["authorization_code", "refresh_token"],
        clientPrivileges: () => false,
        resourcePrivileges: () => false,
        schema: OAUTH_TABLES,
      }),
    ),
  ];
}

/**
 * The provider plugin, as the plugin list's element type.
 *
 * A check rather than a declaration because `tsc` refuses the declaration: under this repo's
 * `exactOptionalPropertyTypes`, the OpenAPI metadata on the provider's `/oauth2/authorize`
 * (`items?: undefined`) is not assignable to Better Auth's own `Endpoint` type, which is a
 * mismatch between two of the library's declarations, not a property of the plugin. What the
 * list needs of an element at run time is what this checks.
 */
function asPlugin(candidate: unknown): BetterAuthPlugin {
  if (!isPlugin(candidate)) {
    throw new Error("the MCP authorization server plugin did not construct");
  }
  return candidate;
}

function isPlugin(candidate: unknown): candidate is BetterAuthPlugin {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "id" in candidate &&
    typeof candidate.id === "string"
  );
}

/** What {@link createMcpAuth} needs from a Better Auth instance built with {@link mcpPlugins}. */
export interface Issuing {
  readonly $context: Promise<Store>;
  readonly api: object;
}

/** Better Auth's own storage, which knows the model mapping in `authSchema.ts`. */
type Store = Pick<AuthContext, "adapter" | "internalAdapter">;

/** Reads the key set the access tokens are signed with. */
type KeySet = () => Promise<JSONWebKeySet>;

/** A consent as the adapter answers it: the fields read here, typed as what they must be. */
interface StoredConsent {
  readonly id: string;
  readonly clientId: string;
  readonly scopes: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
}

interface StoredClient {
  readonly name?: unknown;
  readonly redirectUris?: unknown;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function isoOf(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

/** The host a client sends its person back to: what identifies it better than its own name. */
function redirectHost(uris: unknown): string | null {
  const [first] = strings(uris);
  if (first === undefined) {
    return null;
  }
  try {
    return new URL(first).host;
  } catch {
    return null;
  }
}

function hasJwks(api: object): api is { getJwks: KeySet } {
  return "getJwks" in api && typeof api.getJwks === "function";
}

/** A token's scopes, from the space-separated claim the provider writes. */
function scopesOf(claims: JWTPayload): string[] {
  return typeof claims.scope === "string" ? claims.scope.split(" ").filter((s) => s !== "") : [];
}

/**
 * The claims of a genuine, unexpired access token issued by `issuer` for `resource`, or `null`.
 * A JOSE failure is a token that is not one; anything else -- the key set could not be read --
 * is the server's failure and is thrown, never answered as "not a token".
 */
async function verified(
  keys: KeySet,
  token: string,
  expected: { issuer: string; resource: string },
): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet(await keys()), {
      issuer: expected.issuer,
      audience: expected.resource,
      typ: ACCESS_TOKEN_TYPE,
      requiredClaims: ["exp", "sub"],
    });
    return payload;
  } catch (error) {
    if (error instanceof errors.JOSEError) {
      return null;
    }
    throw error;
  }
}

/** The person and scopes behind verified `claims`, read against the consent as it stands. */
async function admitted(store: Store, claims: JWTPayload): Promise<OAuthAdmission | null> {
  const clientId = claims.client_id ?? claims.azp;
  // A `cnf` claim binds the token to a DPoP key whose proof this door does not check, so
  // honouring it as a plain bearer would undo the binding the client asked for.
  if (typeof clientId !== "string" || claims.cnf !== undefined) {
    return null;
  }
  const userId = String(claims.sub);
  const [consent, user] = await Promise.all([
    store.adapter.findOne<StoredConsent>({
      model: "oauthConsent",
      where: [
        { field: "clientId", value: clientId },
        { field: "userId", value: userId },
      ],
    }),
    store.internalAdapter.findUserById(userId),
  ]);
  if (consent === null || user === null) {
    return null;
  }
  return {
    email: user.email,
    clientId,
    tokenScopes: scopesOf(claims),
    consentScopes: strings(consent.scopes),
  };
}

async function authUserId(store: Store, email: string): Promise<string | null> {
  return (await store.internalAdapter.findUserByEmail(email.toLowerCase()))?.user.id ?? null;
}

async function appsOf(store: Store, email: string): Promise<AuthorizedApp[]> {
  const userId = await authUserId(store, email);
  if (userId === null) {
    return [];
  }
  const consents = await store.adapter.findMany<StoredConsent>({
    model: "oauthConsent",
    where: [{ field: "userId", value: userId }],
    sortBy: { field: "updatedAt", direction: "desc" },
  });
  return Promise.all(
    consents.map(async (consent): Promise<AuthorizedApp> => {
      const client = await store.adapter.findOne<StoredClient>({
        model: "oauthClient",
        where: [{ field: "clientId", value: consent.clientId }],
      });
      return {
        id: consent.id,
        clientName: typeof client?.name === "string" ? client.name : null,
        redirectHost: redirectHost(client?.redirectUris),
        scopes: strings(consent.scopes),
        grantedAt: isoOf(consent.updatedAt) ?? isoOf(consent.createdAt),
      };
    }),
  );
}

async function revokeApp(store: Store, email: string, id: string): Promise<boolean> {
  const userId = await authUserId(store, email);
  const consent =
    userId === null
      ? null
      : await store.adapter.findOne<StoredConsent>({
          model: "oauthConsent",
          where: [
            { field: "id", value: id },
            { field: "userId", value: userId },
          ],
        });
  if (userId === null || consent === null) {
    return false;
  }
  // Refresh tokens first, then the consent: if the second write fails the person is told so
  // and retries, and in between the app can already mint nothing new.
  await store.adapter.updateMany({
    model: "oauthRefreshToken",
    where: [
      { field: "clientId", value: consent.clientId },
      { field: "userId", value: userId },
    ],
    update: { revoked: new Date() },
  });
  await store.adapter.delete({ model: "oauthConsent", where: [{ field: "id", value: id }] });
  return true;
}

export function createMcpAuth(issuing: Issuing, issuer: string): McpAuth {
  const { api } = issuing;
  if (!hasJwks(api)) {
    throw new Error("the jwt() plugin is not installed, so no access token could be verified");
  }
  const keys: KeySet = () => api.getJwks();
  const resource = `${issuer}${MCP_PATH}`;
  return {
    resource,
    admit: async (token: string): Promise<OAuthAdmission | null> => {
      const claims = await verified(keys, token, { issuer, resource });
      return claims === null ? null : admitted(await issuing.$context, claims);
    },
    listFor: async (email: string): Promise<AuthorizedApp[]> =>
      appsOf(await issuing.$context, email),
    revokeFor: async (email: string, id: string): Promise<boolean> =>
      revokeApp(await issuing.$context, email, id),
  };
}
