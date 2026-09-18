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
  type Credential,
  ConnectionRegistryError,
  readCredential,
  setStatus,
  writeCredential,
} from "../repos/connections.ts";

/** Refresh this far before the token actually expires -- a run takes minutes. */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Whether a credential is too close to expiry to start a run with.
 *
 * Pure, and separated from the SQL on purpose: this is the decision worth testing, with no
 * database and no clock to monkeypatch. A credential with no recorded expiry is fresh --
 * the HubSpot private-app case, where guessing an expiry would refresh a token that has no
 * refresh token and turn a working connection into a broken one.
 */
export function needsRefresh(credential: Credential, now: Date = new Date()): boolean {
  if (credential.expiresAt === null) return false;
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
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  });

  if (!needsRefresh(credential, opts.now)) return credential.accessToken;

  if (opts.refresher === undefined || credential.refreshToken === "") {
    await setStatus(exec, tenantId, source, "expired");
    throw new ConnectionRegistryError(
      `${source} credential for tenant ${JSON.stringify(tenantId)} expired and cannot be ` +
        "refreshed; the connection needs re-consent",
    );
  }

  const refreshed = await opts.refresher(credential.refreshToken);
  await writeCredential(exec, tenantId, source, refreshed, opts.env);
  return refreshed.accessToken;
}
