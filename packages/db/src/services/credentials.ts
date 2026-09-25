/**
 * When a stored credential is too old to start a run with, and what to do about it.
 *
 * The decision, kept away from the SQL that stores it (`../repos/connections.ts`). Two
 * reasons, both learned the hard way:
 *
 * - `needsRefresh` is pure, so the rule that decides whether a customer's sync runs is
 *   tested with no database and no clock to monkeypatch;
 * - the refresh itself is an orchestration -- read under a lock, call the provider, write
 *   the rotated token back -- and every step of it is a repo call, so nothing here composes
 *   SQL and nothing in the repo decides policy.
 *
 * This is a *service* and not part of the registry's own module for the layering rule in
 * `.claude/rules/layering.md`: repos read and write, services decide.
 */

import type { SqlExecutor } from "../executor.ts";
import {
  ConnectionRegistryError,
  type Credential,
  readCredential,
  setStatus,
  writeCredential,
} from "../repos/connections.ts";
import { grantExpiryFor } from "./grantExpiry.ts";

/** Refresh this far before the token actually expires -- a run takes minutes. */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * What a refresher throws when the provider refused the refresh token ITSELF.
 *
 * Part of the refresher's contract with {@link accessToken}, which is why it is declared here
 * and not beside the refreshers: this is the one failure `accessToken` reads as a dead
 * credential -- the connection is marked `expired` and the caller is told it needs re-consent.
 * Anything else a refresher throws (a 5xx, a timeout, a malformed 200) is an outage, and is
 * left to raise as itself so a working connection is never sent to re-consent over a provider
 * hiccup.
 *
 * It deliberately carries no response body. A token endpoint's refusal is answered to a request
 * that held the live refresh token, and an error is exactly the thing that gets logged; the
 * status is all a caller needs, and all this keeps.
 */
export class RefreshRefused extends Error {
  readonly tokenUrl: string;
  readonly status: number;

  constructor(tokenUrl: string, status: number) {
    super(`the token endpoint ${tokenUrl} refused the refresh token (HTTP ${status})`);
    this.name = "RefreshRefused";
    this.tokenUrl = tokenUrl;
    this.status = status;
  }
}

/**
 * Whether a credential is too close to expiry to start a run with.
 *
 * Pure, and separated from the SQL on purpose: this is the decision worth testing, with no
 * database and no clock to monkeypatch. A credential with no recorded expiry is fresh --
 * the HubSpot private-app case, where guessing an expiry would refresh a token that has no
 * refresh token and turn a working connection into a broken one.
 */
export function needsRefresh(credential: Credential, now: Date = new Date()): boolean {
  if (credential.expiresAt === null) {
    return false;
  }
  return new Date(credential.expiresAt).getTime() - REFRESH_SKEW_MS <= now.getTime();
}

/**
 * A usable access token, refreshing first if the stored one is close to expiry.
 *
 * Must run inside `withTransaction`: it reads the credential FOR UPDATE and, on Xero,
 * writes the rotated token back before returning it -- the token just spent is already
 * dead, so losing the replacement would cost the connection. A connection with no refresh
 * capability and an expired token raises rather than returning a stale value that would
 * 401 deep inside a sync and read as "the source is down".
 *
 * A refresh the provider refused ({@link RefreshRefused}) is the same fact arrived at later --
 * the grant was revoked, or has lapsed -- and gets the same answer: `expired`, and a
 * `ConnectionRegistryError`. Before it did, Google's `invalid_grant` escaped as a bare HTTP 400
 * that every caller read as an outage, and the connection kept reading `connected` while every
 * run and every browse failed on it (issue 213).
 */
export async function accessToken(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
  opts: {
    refresher?: (refreshToken: string) => Promise<Credential>;
    now?: Date;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<string> {
  const credential = await readCredential(exec, tenantId, source, {
    forUpdate: true,
    ...(opts.env === undefined ? {} : { env: opts.env }),
  });

  if (!needsRefresh(credential, opts.now)) {
    return credential.accessToken;
  }

  const at = { tenantId, source };
  if (opts.refresher === undefined || credential.refreshToken === "") {
    return await expire(exec, at, "expired and cannot be refreshed");
  }

  let refreshed: Credential;
  try {
    refreshed = await opts.refresher(credential.refreshToken);
  } catch (error) {
    if (error instanceof RefreshRefused) {
      return await expire(exec, at, "was refused by the provider when refreshed", error);
    }
    throw error;
  }
  // A refresh renews the grant too, where the provider dates one: Xero's sixty days count
  // from the last use, so every successful refresh moves the warning further away.
  await writeCredential(exec, tenantId, source, refreshed, {
    ...(opts.env === undefined ? {} : { env: opts.env }),
    grantExpiresAt: grantExpiryFor(source, opts.now),
  });
  return refreshed.accessToken;
}

/**
 * Record that a connection needs re-consent, and say so.
 *
 * The status is written BEFORE the throw, inside the caller's transaction -- which rolls it back
 * with everything else. `resolveToken` in the worker re-applies it outside for exactly that
 * reason; this write is what a caller running on autocommit keeps.
 */
async function expire(
  exec: SqlExecutor,
  at: { readonly tenantId: string; readonly source: string },
  why: string,
  cause?: unknown,
): Promise<never> {
  await setStatus(exec, at.tenantId, at.source, "expired");
  throw new ConnectionRegistryError(
    `${at.source} credential for tenant ${JSON.stringify(at.tenantId)} ${why}; the connection ` +
      "needs re-consent",
    cause === undefined ? undefined : { cause },
  );
}
