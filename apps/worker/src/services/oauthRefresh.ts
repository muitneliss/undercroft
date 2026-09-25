/**
 * Spending a refresh token at a provider's token endpoint, and what its answer means.
 *
 * Google's refresher and Xero's differ in how the request is authenticated and in what they do
 * with the refresh token that comes back -- Google does not rotate, Xero always does -- and in
 * nothing else. What they share is decided here, once, because it was once decided in neither:
 *
 * **A 400 is the provider refusing the refresh token, and nothing else is.** RFC 6749 §5.2 gives
 * a refused grant (`invalid_grant`: revoked, lapsed, or issued to another client) a 400, and
 * that is what Google and Xero answer. It raises {@link RefreshRefused}, which `accessToken`
 * turns into an `expired` connection and a reconnect. Left as a bare `HttpError` it read as an
 * outage everywhere: the connection kept saying `connected` while every run and every browse
 * failed on a token that would never work again (issue 213).
 *
 * The decision is made on the STATUS alone and the body is never read on this path. A refusal
 * answers a request that carried the live refresh token, and the `error` field would only tell
 * `invalid_grant` from `invalid_request` -- both of which a reconnect repairs.
 *
 * A 401 is deliberately NOT a refusal. It is the endpoint rejecting OUR client (`invalid_client`:
 * a rotated secret, a deleted OAuth client), which is the deployment's fault, the same for every
 * connection, and not something a customer's reconnect can repair -- marking every connection
 * expired over it would send each of them through a consent that then fails too. It raises as
 * an `HttpError`, like a 5xx or a timeout, which are outages.
 *
 * Not retried, for either provider. `withRetry` exists for a listed set of transient statuses,
 * and a token endpoint answering `invalid_grant` is not one of them -- retrying a revoked grant
 * five times turns a clear "the customer disconnected us" into a slow one.
 */

import type { ByteFetcher, ByteRequest, Clock } from "@undercroft/core";
import { getPath, getStringPath, raiseForByteStatus } from "@undercroft/core";
import { RefreshRefused } from "@undercroft/db/services";

/** The token endpoint's answer to a refused grant (RFC 6749 §5.2). */
const GRANT_REFUSED = 400;
const MS_PER_SECOND = 1000;

/** What a token endpoint handed back, read but not yet judged by the provider's own rules. */
export interface TokenGrant {
  readonly accessToken: string;
  /** Absent from the response is `null`, never `""` -- the providers disagree on what it means. */
  readonly refreshToken: string | null;
  /** When the access token lapses; `null` when the response said nothing about it. */
  readonly expiresAt: string | null;
}

/**
 * Send a refresh request and read the grant it returns.
 *
 * `provider` names the endpoint in the one message this writes itself. Raises
 * {@link RefreshRefused} for a refused grant, `HttpError` for any other non-2xx, and refuses a
 * 200 with no access token rather than returning an empty one: the empty string would seal
 * cleanly, read as "connected", and 401 deep inside a sync where it looks like the source is
 * down.
 */
export async function exchangeRefreshToken(
  provider: string,
  deps: { readonly fetcher: ByteFetcher; readonly clock: Clock },
  request: ByteRequest,
): Promise<TokenGrant> {
  const response = await deps.fetcher.send(request);
  if (response.status === GRANT_REFUSED) {
    throw new RefreshRefused(request.url, response.status);
  }
  raiseForByteStatus(request, response);

  // Read field by field, never asserted into a shape: an empty string is as absent as a
  // missing field, and `getStringPath` answers `null` for both.
  const body: unknown = JSON.parse(new TextDecoder().decode(response.bytes));
  const accessToken = getStringPath(body, "access_token");
  if (accessToken === null) {
    throw new Error(`${provider} token endpoint returned 200 with no access_token`);
  }
  return {
    accessToken,
    refreshToken: getStringPath(body, "refresh_token"),
    expiresAt: expiryFrom(getPath(body, "expires_in"), deps.clock),
  };
}

/**
 * `expires_in` is a seconds count. A response without one is a credential with no recorded
 * expiry, which `needsRefresh` reads as fresh -- honest, and better than inventing an hour.
 */
function expiryFrom(expiresIn: unknown, clock: Clock): string | null {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) {
    return null;
  }
  return new Date(clock.now().getTime() + expiresIn * MS_PER_SECOND).toISOString();
}
