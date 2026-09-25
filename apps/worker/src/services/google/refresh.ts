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
 * safely retried next run -- but only if nothing was written in between. A grant Google
 * refused outright is not retried at all: `../oauthRefresh.ts` makes it a reconnect.
 *
 * Google returns no `refresh_token` on a refresh response. Carrying the existing one
 * forward is therefore not an optimisation, it is the only correct reading: treating the
 * absent field as an empty string would store a credential that can never refresh again,
 * and the customer would have to re-consent for no reason.
 */

import type { ByteFetcher, Clock } from "@undercroft/core";
import { systemClock } from "@undercroft/core";
import type { Credential } from "@undercroft/db/repos";

import { exchangeRefreshToken } from "../oauthRefresh.ts";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetcher: ByteFetcher;
  readonly clock?: Clock;
  /** Overridable for tests; production never passes it. */
  readonly tokenUrl?: string;
}

/**
 * Build the refresher `accessToken` calls when a stored credential is close to expiry.
 *
 * What Google's answer MEANS -- a refused grant, an outage, a 200 with nothing in it -- is
 * `exchangeRefreshToken`'s to decide, for Xero's refresher as much as this one.
 */
export function googleRefresher(
  config: GoogleOAuthConfig,
): (refreshToken: string) => Promise<Credential> {
  const clock = config.clock ?? systemClock;
  const url = config.tokenUrl ?? GOOGLE_TOKEN_URL;

  return async (refreshToken: string): Promise<Credential> => {
    const grant = await exchangeRefreshToken(
      "google",
      { fetcher: config.fetcher, clock },
      {
        url,
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }).toString(),
      },
    );

    return {
      accessToken: grant.accessToken,
      // Absent means unchanged, not empty. See the module docstring.
      refreshToken: grant.refreshToken ?? refreshToken,
      expiresAt: grant.expiresAt,
    };
  };
}
