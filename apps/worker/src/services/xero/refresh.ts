/**
 * Exchanging a Xero refresh token for a fresh pair.
 *
 * Xero ROTATES: every refresh issues a new refresh token and kills the one just spent.
 * That is the whole difference from Google's refresher beside this one, and it changes two
 * things. The response MUST carry a `refresh_token`, and a 200 without one is refused --
 * carrying the old one forward, which is the right reading for Google, would here store a
 * token Xero has already invalidated and the customer would have to consent again for no
 * visible reason. And the caller must write the new pair back under the row lock
 * `accessToken` already takes before the access token is used, which `credentials.ts` does.
 *
 * The client authenticates with a Basic header, as Xero's token endpoint expects for a
 * confidential client, rather than with `client_secret` in the body.
 */

import type { ByteFetcher, Clock } from "@undercroft/core";
import { systemClock } from "@undercroft/core";
import type { Credential } from "@undercroft/db/repos";

import { exchangeRefreshToken } from "../oauthRefresh.ts";

export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

export interface XeroOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetcher: ByteFetcher;
  readonly clock?: Clock;
  /** Overridable for tests; production never passes it. */
  readonly tokenUrl?: string;
}

/** The Basic credential Xero's identity endpoints take for a confidential client. */
export function xeroClientAuthorization(config: {
  readonly clientId: string;
  readonly clientSecret: string;
}): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
}

/**
 * Build the refresher `accessToken` calls when a stored Xero credential is close to expiry.
 *
 * What Xero's answer MEANS -- a refused grant, an outage, a 200 with no access token -- is
 * `exchangeRefreshToken`'s to decide, as it is for Google's. Only the rotation is Xero's own.
 */
export function xeroRefresher(
  config: XeroOAuthConfig,
): (refreshToken: string) => Promise<Credential> {
  const clock = config.clock ?? systemClock;
  const url = config.tokenUrl ?? XERO_TOKEN_URL;

  return async (refreshToken: string): Promise<Credential> => {
    const grant = await exchangeRefreshToken(
      "xero",
      { fetcher: config.fetcher, clock },
      {
        url,
        method: "POST",
        headers: {
          authorization: xeroClientAuthorization(config),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).toString(),
      },
    );
    if (grant.refreshToken === null) {
      // The one just spent is dead. Storing it would seal a credential that cannot refresh
      // and reads as "connected" until the next run 401s.
      throw new Error("xero token endpoint returned 200 with no rotated refresh_token");
    }

    return {
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      expiresAt: grant.expiresAt,
    };
  };
}
