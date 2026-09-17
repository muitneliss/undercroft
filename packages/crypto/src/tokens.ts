/**
 * Token hashing and PKCE.
 *
 * Ingest keys, invitation tokens and session identifiers are stored as a SHA-256 digest,
 * never in the clear: a database read then yields something that cannot be replayed. PKCE
 * S256 is the only challenge method generated -- `plain` defeats the purpose.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A URL-safe random token, for an ingest key or an invitation. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** The digest stored for a token. Compare digests, never the token itself. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
export function tokenMatches(token: string, storedDigest: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(storedDigest, "hex");
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: "S256";
}

/** Generate a PKCE verifier and its S256 challenge. */
export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, method: "S256" };
}
