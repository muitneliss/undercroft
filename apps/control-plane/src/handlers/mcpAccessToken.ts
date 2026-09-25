/**
 * Whether a bearer is an access token this server signed for `/mcp`, and if not, why not.
 *
 * Decision 2 of `mcpAuth.ts`, and the only module that calls `jose`: the token is verified in
 * process, against the key set read through Better Auth's own `getJwks`, for signature, issuer
 * (the origin), audience (the `/mcp` resource, never the base URL), `typ` and expiry. What comes
 * out is the three facts `mcpAuth.ts` reads the consent with -- client, person, scopes -- and
 * never a claims object, so no caller learns a claim name.
 *
 * Whether the consent behind a genuine token still stands is not a question about the token.
 * `mcpAuth.ts` asks Better Auth's storage that, on every request.
 */

import { createLocalJWKSet, errors, type JSONWebKeySet, type JWTPayload, jwtVerify } from "jose";

/** RFC 9068's `typ` for a JWT access token, which is what the provider signs them with. */
const ACCESS_TOKEN_TYPE = "at+jwt";

/** Reads the key set the access tokens are signed with. */
export type KeySet = () => Promise<JSONWebKeySet>;

/** A genuine, unexpired access token for `/mcp`, as far as the token alone can say. */
export interface VerifiedToken {
  readonly ok: true;
  readonly clientId: string;
  /** Better Auth's user id: `sub`. */
  readonly userId: string;
  /** What the token was issued with. */
  readonly scopes: readonly string[];
}

/**
 * Why an access token admits nobody -- for the operator's log (ADR 0062), never for the client,
 * which is answered the same 401 for every one of them.
 *
 * - `malformed`: not a signed JWT at all, or a verified one naming no client.
 * - `unknown`: not ours for `/mcp` -- a signature our keys do not verify, another issuer,
 *   audience or type -- or a DPoP-bound one (a `cnf` claim), whose proof this door does not
 *   check, so honouring it as a plain bearer would undo the binding the client asked for.
 * - `expired`: past its `exp`.
 * - `revoked`: the consent behind it is gone -- "Revoke" on the account page (`mcpAuth.ts`).
 * - `no_person`: the person it was issued to has no account any more (`mcpAuth.ts`).
 *
 * `clientId` only where the signature verified, so it is a fact rather than a claim.
 */
export interface OAuthRefused {
  readonly ok: false;
  readonly reason: "malformed" | "unknown" | "expired" | "revoked" | "no_person";
  readonly clientId?: string;
}

/** The client a token was issued to, as the provider writes it, or `null` for none. */
function clientOf(claims: JWTPayload): string | null {
  const clientId = claims.client_id ?? claims.azp;
  return typeof clientId === "string" ? clientId : null;
}

/** A token's scopes, from the space-separated claim the provider writes. */
function scopesOf(claims: JWTPayload): string[] {
  return typeof claims.scope === "string" ? claims.scope.split(" ").filter((s) => s !== "") : [];
}

/**
 * A JOSE failure, as why the token is not one of ours. Anything else -- the key set could not
 * be read -- is the server's failure and is thrown, never answered as "not a token".
 *
 * Only an expired token names its client: it is the one failure of a token this server did
 * issue for `/mcp`, and its payload is proven. jose 6.2.12's `jwtVerify` checks the signature
 * (`verifyCompact`, which throws `JWSSignatureVerificationFailed`) before it validates a single
 * claim, and `validateClaimsSet` then checks `typ`, the required claims, the issuer and the
 * audience before it throws `JWTExpired` for `exp` (`dist/webapi/jwt/verify.js`,
 * `lib/jwt_claims_set.js`); the type declaration says the same: "token authentication precedes
 * claim validation". Every other failure is a token that was never ours for this door, and a
 * client read from it would name an app for a request it may not have made.
 */
function refusalOf(error: unknown): OAuthRefused {
  if (error instanceof errors.JWTExpired) {
    const clientId = clientOf(error.payload);
    return { ok: false, reason: "expired", ...(clientId === null ? {} : { clientId }) };
  }
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) {
    return { ok: false, reason: "malformed" };
  }
  if (error instanceof errors.JOSEError) {
    return { ok: false, reason: "unknown" };
  }
  throw error;
}

/** Verified claims, as a bearer this door honours or why they are not one. */
function bearerOf(claims: JWTPayload): VerifiedToken | OAuthRefused {
  const clientId = clientOf(claims);
  if (clientId === null) {
    return { ok: false, reason: "malformed" };
  }
  if (claims.cnf !== undefined) {
    return { ok: false, reason: "unknown", clientId };
  }
  return { ok: true, clientId, userId: String(claims.sub), scopes: scopesOf(claims) };
}

/** The client, person and scopes of a genuine access token issued by `issuer` for `resource`. */
export async function verifyAccessToken(
  keys: KeySet,
  token: string,
  expected: { readonly issuer: string; readonly resource: string },
): Promise<VerifiedToken | OAuthRefused> {
  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet(await keys()), {
      issuer: expected.issuer,
      audience: expected.resource,
      typ: ACCESS_TOKEN_TYPE,
      requiredClaims: ["exp", "sub"],
    });
    return bearerOf(payload);
  } catch (error) {
    return refusalOf(error);
  }
}
