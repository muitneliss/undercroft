/**
 * Exchanging a Google refresh token for a fresh access token.
 *
 * This is the function `accessToken` has always taken and never been given. Until now the
 * worker called it with no `refresher`, so a credential close to expiry marked the
 * connection `expired` and raised -- correct behaviour for HubSpot's private app, which has
 * nothing to refresh with, and a permanent outage for anything that does.
 *
 * Two properties are load-bearing and both are the caller's to provide:
 *
 * **It must run inside a transaction.** `accessToken` reads the credential `FOR UPDATE`,
 * and a row lock only holds inside one. On autocommit the lock lasts for the statement, so
 * two concurrent runs can both read the same refresh token and both spend it.
 *
 * **A failure must roll the transaction back rather than write a partial credential.**
 * Google does not rotate the refresh token on an ordinary refresh, so a failed exchange is
 * safely retried next run -- but only if nothing was written in between.
 *
 * Google returns no `refresh_token` on a refresh response. Carrying the existing one
 * forward is therefore not an optimisation, it is the only correct reading: treating the
 * absent field as an empty string would store a credential that can never refresh again,
 * and the customer would have to re-consent for no reason.
 */

import type { ByteFetcher, Clock } from "@undercroft/core";
import { raiseForByteStatus, systemClock } from "@undercroft/core";
import type { Credential } from "@undercroft/db/repos";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetcher: ByteFetcher;
  readonly clock?: Clock;
  /** Overridable for tests; production never passes it. */
  readonly tokenUrl?: string;
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
}

const MS_PER_SECOND = 1000;

/**
 * Build the refresher `accessToken` calls when a stored credential is close to expiry.
 *
 * Not retried. `withRetry` exists for a listed set of transient statuses, and a token
 * endpoint answering `invalid_grant` is not one of them -- retrying a revoked grant five
 * times turns a clear "the customer disconnected us" into a slow one.
 */
export function googleRefresher(
  config: GoogleOAuthConfig,
): (refreshToken: string) => Promise<Credential> {
  const clock = config.clock ?? systemClock;
  const url = config.tokenUrl ?? GOOGLE_TOKEN_URL;

  return async (refreshToken: string): Promise<Credential> => {
    const request = {
      url,
      method: "POST" as const,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    };

    const response = await config.fetcher.send(request);
    raiseForByteStatus(request, response);

    const body = JSON.parse(new TextDecoder().decode(response.bytes)) as TokenResponse;
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    if (accessToken === "") {
      // A 200 with no token is not a token. Refusing here keeps the empty string out of the
      // sealed credential, where it would read as "connected" and 401 deep inside a sync.
      throw new Error("google token endpoint returned 200 with no access_token");
    }

    return {
      accessToken,
      // Absent means unchanged, not empty. See the module docstring.
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : refreshToken,
      expiresAt: expiryFrom(body.expires_in, clock),
    };
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
